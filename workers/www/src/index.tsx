import { type VNode } from "preact";
import { render } from "preact-render-to-string";
import {
  UnpkgClient,
  parsePackagePathname,
  resolvePackageExport,
  resolvePackageVersion,
  rewriteImports,
} from "unpkg-core";

import { AssetsContext, loadAssetsManifest } from "./assets.ts";
import { Document } from "./components/document.tsx";
import { Home } from "./components/home.tsx";
import { ContextProvider } from "./context.ts";
import { type Env } from "./env.ts";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(`Invalid request method: ${request.method}`, {
        status: 405,
      });
    }

    try {
      let response = await handleRequest(request, env, ctx);

      if (request.method === "HEAD") {
        return new Response(null, response);
      }

      return response;
    } catch (error) {
      console.error(error);

      return new Response("Internal Server Error", { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;

const publicNpmRegistry = "https://registry.npmjs.org";

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let unpkg = new UnpkgClient({ executionContext: ctx, mode: env.MODE, npmRegistry: publicNpmRegistry });
  let url = new URL(request.url);

  if (url.pathname === "/favicon.ico") {
    return notFound();
  }
  if (url.pathname === "/index.html") {
    return redirect("/", 301);
  }
  if (url.pathname === "/") {
    return renderPage(<Home />, env, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  // Redirect legacy /browse/* URLs to the app worker's /files view
  if (url.pathname.startsWith("/browse/")) {
    let parsed = parsePackagePathname(url.pathname.slice(7));
    if (parsed) {
      url.host = env.APP_HOST;
      url.pathname = createFilesPathname(parsed.package, parsed.version, parsed.filename);
      return redirect(url /*, 301*/);
    }
  }

  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid URL pathname: ${url.pathname}`);
  }

  let packageName = parsed.package;
  let packageInfo = await unpkg.getPackageInfo(packageName);
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

    if (version !== parsed.version || prefix !== parsed.filename) {
      return redirect(`${url.origin}/${packageName}@${version}${prefix}${url.search}`);
    }

    let files = await unpkg.listFiles(packageName, version, prefix);
    let fileListing = {
      package: packageName,
      version,
      prefix,
      files,
    };

    return new Response(JSON.stringify(fileListing), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000",
        "Content-Type": "application/json",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Support "append a /" behavior for viewing file listings that are handled the app worker
  if (filename != null && filename.endsWith("/")) {
    url.host = env.APP_HOST;
    url.pathname = createFilesPathname(packageName, version, filename);
    return redirect(url);
  }

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

  if (resolvedFilename != null && resolvedFilename !== filename) {
    return redirect(`${url.origin}/${packageName}@${version}${resolvedFilename}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Maximize cache hits by redirecting to the correct version if the resolved version
  // is different from the one that was requested in the URL
  if (version !== parsed.version) {
    return redirect(`${url.origin}/${packageName}@${version}${filename ?? ""}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  if (filename != null) {
    let file = await unpkg.getFile(packageName, version, filename);

    if (file != null) {
      // Rewrite imports for JavaScript modules when ?module is used
      if (file.type === "text/javascript" && url.searchParams.has("module")) {
        let code = new TextDecoder().decode(file.body);
        let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies);
        let newCode = rewriteImports(code, url.origin, deps);

        return new Response(newCode, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "*",
            "Content-Type": file.type,
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }

      let [algorithm, hash] = file.integrity.split("-", 2);
      let contentType = file.type === "text/javascript" ? "text/javascript; charset=utf-8" : file.type;

      return new Response(file.body, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "*",
          "Cache-Control": "public, max-age=31536000",
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
  let files = await unpkg.listFiles(packageName, version, "/");
  let basename = filename == null || filename === "/" ? "" : filename.replace(/\/+$/, "");
  let matchingFile =
    files.find((file) => file.path === `${basename}.js`) || files.find((file) => file.path === `${basename}/index.js`);
  if (matchingFile != null) {
    return redirect(`${url.origin}/${packageName}@${version}${matchingFile.path}${url.search}`, {
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

async function renderPage(node: VNode, env: Env, init?: ResponseInit): Promise<Response> {
  let context = new ContextProvider([
    [
      AssetsContext,
      await loadAssetsManifest({
        origin: env.ASSETS_ORIGIN,
        dev: env.MODE === "development",
      }),
    ],
  ]);

  let html = render(<Document context={context}>{node}</Document>);

  return new Response("<!DOCTYPE html>" + html, {
    ...init,
    headers: {
      "Content-Type": "text/html",
      ...init?.headers,
    },
  });
}

function createFilesPathname(packageName: string, version?: string, filename?: string): string {
  // The /files prefix is not needed for the root of the file browser.
  let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
  return `/${packageName}${version ? `@${version}` : ""}${path}`;
}
