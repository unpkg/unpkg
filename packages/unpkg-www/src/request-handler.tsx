import { type VNode } from "preact";
import { render } from "preact-render-to-string";
import {
  getFile,
  getPackageInfo,
  listFiles,
  parsePackagePathname,
  resolvePackageExport,
  resolvePackageVersion,
  rewriteImports,
} from "unpkg-tools";

import { AssetsContext } from "./assets-context.ts";
import { loadAssetsManifest } from "./assets-manifest.ts";
import { logRequest } from "./request-logging.ts";
import { env } from "./env.ts";
import * as hrefs from "./hrefs.ts";
import { findPublicAsset } from "./public-assets.ts";
import { Document } from "./components/document.tsx";
import { Home } from "./components/home.tsx";

const publicNpmRegistry = "https://registry.npmjs.org";

export async function handleRequest(request: Request): Promise<Response> {
  try {
    let response: Response;
    if (env.DEBUG) {
      let start = Date.now();
      response = await handleRequest_(request);
      logRequest(request, response, Date.now() - start);
    } else {
      response = await handleRequest_(request);
    }

    if (request.method === "HEAD") {
      return new Response(null, response);
    }

    return response;
  } catch (error) {
    console.error(error);

    return new Response("Internal Server Error", { status: 500 });
  }
}

async function handleRequest_(request: Request): Promise<Response> {
  // Validate the request method
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`Invalid request method: ${request.method}`, { status: 405 });
  }

  let url = new URL(request.url);

  if (url.pathname === "/_health") {
    return new Response("OK");
  }
  if (url.pathname === "/favicon.ico") {
    return notFound();
  }
  if (url.pathname === "/index.html") {
    return redirect("/", 301);
  }
  if (url.pathname === "/") {
    return renderPage(<Home />, {
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=60, s-maxage=300",
      },
    });
  }

  // Serve static assets from the public directory
  let file = await findPublicAsset(url.pathname);
  if (file != null) {
    return new Response(file, {
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=31536000",
      },
    });
  }

  // Redirect legacy /browse/* URLs to the app's /files view
  if (url.pathname.startsWith("/browse/")) {
    let parsed = parsePackagePathname(url.pathname.slice(7));
    if (parsed) {
      return redirect(hrefs.files(parsed.package, parsed.version, parsed.filename), 301);
    }
  }

  // Parse and validate the package path
  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid URL pathname: ${url.pathname}`);
  }

  let packageName = parsed.package;
  let packageInfo = await getPackageInfo(publicNpmRegistry, packageName);
  if (packageInfo == null) {
    return notFound(`Package not found: ${parsed.package}`);
  }

  let version = resolvePackageVersion(packageInfo, parsed.version ?? "latest");
  if (version == null || packageInfo.versions == null || packageInfo.versions[version] == null) {
    return notFound(`Package version not found: ${packageName}@${parsed.version}`);
  }

  let packageJson = packageInfo.versions[version];
  let filename = parsed.filename;

  // Handle ?meta requests
  if (url.searchParams.has("meta")) {
    let prefix = filename == null ? "/" : filename.replace(/\/*$/, "/");

    // If the version number is not already resolved, redirect to a permanent URL
    if (version !== parsed.version) {
      return redirect(new URL(`/${packageName}@${version}${prefix}${url.search}`, env.WWW_ORIGIN), {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      });
    }

    let files = await listFiles(publicNpmRegistry, packageName, version, prefix);
    let fileListing = {
      package: packageName,
      version,
      prefix,
      files,
    };

    return Response.json(fileListing, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000",
        "Cache-Tag": "meta", // This allows us to purge the cache if ?meta behavior ever changes
        "Content-Type": "application/json",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Support "append a /" behavior for viewing file listings in the app
  if (filename != null && filename.endsWith("/")) {
    // If the version number is already resolved, we can issue a permanent redirect (301)
    if (version === parsed.version) {
      return redirect(hrefs.files(packageName, version, filename), 301);
    }

    // Otherwise it should be temporary (302)
    return redirect(hrefs.files(packageName, version, filename), {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }

  // Try to resolve the filename using package.json exports, main, etc.
  let conditions = url.searchParams.has("conditions")
    ? url.searchParams.getAll("conditions").flatMap((condition) => condition.split(","))
    : undefined;
  let wantsBrowser = url.searchParams.has("browser");
  let wantsModule = url.searchParams.has("module");

  let resolvedFilename = resolvePackageExport(packageJson, filename ?? "/", {
    useBrowserField: wantsBrowser,
    useModuleField: wantsModule,
    conditions,
  });

  // If the resolved filename is different from the original filename, redirect to the new URL
  if (resolvedFilename != null && resolvedFilename !== filename) {
    let location = new URL(`/${packageName}@${version}${resolvedFilename}${url.search}`, env.WWW_ORIGIN);

    // If the version number is already resolved, we can issue a permanent redirect (301)
    if (version === parsed.version) {
      return redirect(location, {
        status: 301,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    // Otherwise it should be temporary (302)
    return redirect(location, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Maximize cache hits by redirecting to the permanent URL if the version
  // number is different from the one that was used in the request
  if (version !== parsed.version) {
    return redirect(new URL(`/${packageName}@${version}${filename ?? ""}${url.search}`, env.WWW_ORIGIN), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // From here on out we are most likely going to be doing some CPU-heavy work.
  // If we are in production, we want this operation running on unpkg-www-worker.
  if (process.env.FLY_APP_NAME && process.env.FLY_APP_NAME !== "unpkg-www-worker") {
    return new Response("Replay to unpkg-www-worker", {
      headers: {
        "Fly-Replay": "app=unpkg-www-worker",
      },
    });
  }

  if (filename != null) {
    let file = await getFile(publicNpmRegistry, packageName, version, filename);

    if (file != null) {
      // In ?module requests, rewrite imports to unpkg.com/* URLs in JavaScript modules
      if (file.type === "text/javascript" && url.searchParams.has("module")) {
        let code = new TextDecoder().decode(file.body);
        let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies);
        let newCode = rewriteImports(code, url.origin, deps);

        return new Response(newCode, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "*",
            "Cache-Control": "public, max-age=31536000",
            "Cache-Tag": "js-module", // This allows us to purge the cache if ?module behavior ever changes
            "Content-Type": file.type,
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }

      let [algorithm, hash] = file.integrity.split("-", 2);
      let [type, subtype] = file.type.split("/");
      let contentType = file.type === "text/javascript" ? "text/javascript; charset=utf-8" : file.type;

      return new Response(file.body, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "*",
          "Cache-Control": "public, max-age=31536000",
          "Cache-Tag": `type-${type},subtype-${subtype}`, // This allows us to purge the cache for any type/subtype
          "Content-Digest": `${algorithm}=:${hash}:`,
          "Content-Type": contentType,
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }
  }

  // We were unable to find a file based on either the original filename in the URL,
  // or the resolved filename from package.json (exports, main, etc.). Try to find a
  // matching file based on some legacy Node.js heuristics.
  // Redirect
  // - /path/to/file => /path/to/file.js
  // - /path/to/file => /path/to/file/index.js
  // if either of those files exist. This is to support legacy Node.js behavior where a
  // request for files without an extension will resolve to a .js file or a directory with
  // an index.js file.
  // See https://nodejs.org/api/modules.html#file-modules and
  // https://nodejs.org/api/modules.html#folders-as-modules
  let files = await listFiles(publicNpmRegistry, packageName, version);
  let basename = filename == null || filename === "/" ? "" : filename.replace(/\/+$/, "");
  let match =
    files.find((file) => file.path === `${basename}.js`) || files.find((file) => file.path === `${basename}/index.js`);
  if (match != null) {
    return redirect(new URL(`/${packageName}@${version}${match.path}${url.search}`, env.WWW_ORIGIN), {
      status: 301,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  return notFound(`Not found: ${url.pathname}${url.search}`);
}

function notFound(message?: string, init?: ResponseInit): Response {
  return new Response(message ?? "Not Found", { status: 404, ...init });
}

function redirect(location: string | URL, init?: ResponseInit | number): Response {
  if (typeof init === "number") {
    return new Response(`Redirecting to ${location}`, {
      status: init,
      headers: {
        Location: location.toString(),
      },
    });
  }

  return new Response(`Redirecting to ${location}`, {
    status: 302,
    ...init,
    headers: {
      Location: location.toString(),
      ...init?.headers,
    },
  });
}

async function renderPage(node: VNode, init?: ResponseInit): Promise<Response> {
  let assetsManifest = await loadAssetsManifest();

  let html = render(
    <AssetsContext.Provider value={assetsManifest}>
      <Document>{node}</Document>
    </AssetsContext.Provider>
  );

  return new Response("<!DOCTYPE html>" + html, {
    ...init,
    headers: {
      "Content-Type": "text/html",
      ...init?.headers,
    },
  });
}
