import { type VNode } from "preact";
import { render } from "preact-render-to-string";
import { parsePackagePathname, resolvePackageVersion, RegistryClient } from "unpkg-core";

import { AssetsContext, loadAssetsManifest } from "./assets.ts";
import { Document } from "./components/document.tsx";
import { FileDetail } from "./components/file-detail.tsx";
import { FileListing } from "./components/file-listing.tsx";
import { NotFound } from "./components/not-found.tsx";
import { type Env } from "./env.ts";
import { HrefsContext, HrefBuilder } from "./hrefs.ts";

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(`Invalid request method: ${request.method}`, {
        status: 405,
      });
    }

    try {
      // @ts-expect-error - `caches.default` is missing in @cloudflare/workers-types
      let cache = caches.default;
      let response = await cache.match(request);

      if (!response) {
        response = await handleRequest(request, env, ctx);

        if (response.status === 200 && response.headers.has("Cache-Control")) {
          ctx.waitUntil(cache.put(request, response.clone()));
        }
      }

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

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let unpkg = new RegistryClient({ executionContext: ctx, mode: env.MODE });
  let url = new URL(request.url);

  if (url.pathname === "/favicon.ico") {
    return notFound();
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return redirect(env.WWW_ORIGIN);
  }

  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid package pathname: ${url.pathname}`);
  }

  let packageName = parsed.package;
  let packageInfo = await unpkg.getPackageInfo(packageName);
  if (packageInfo == null) {
    return notFound(`Package not found: "${packageName}"`);
  }

  let requestedVersion = parsed.version ?? "latest";
  let version = resolvePackageVersion(packageInfo, requestedVersion);
  if (version == null || packageInfo.versions == null || packageInfo.versions[version] == null) {
    return notFound(`Package version not found: ${packageName}@${requestedVersion}`);
  }

  if (parsed.filename != null && parsed.filename.endsWith("/")) {
    let noTrailingSlash = parsed.filename.replace(/\/+$/, "");
    return redirect(`${url.origin}/${packageName}@${version}${noTrailingSlash}`, 301);
  }
  if (parsed.filename === "/files") {
    return redirect(`${url.origin}/${packageName}@${version}`);
  }
  if (version !== parsed.version) {
    return redirect(`${url.origin}/${packageName}@${version}${parsed.filename ?? ""}`);
  }

  let files = await unpkg.listFiles(packageName, version, "/");
  let filename = parsed.filename ?? "/";

  if (filename === "/") {
    return renderPage(<FileListing packageInfo={packageInfo} version={version} dirname="/" files={files} />, env, {
      headers: {
        "Cache-Control": "public, max-age=180",
      },
    });
  }

  if (filename.startsWith("/files/")) {
    let remainingFilename = filename.slice(6);
    let matchingFile = files.find((file) => file.path === remainingFilename);

    if (matchingFile != null) {
      let file = await unpkg.getFile(packageName, version, remainingFilename);

      return renderPage(
        <FileDetail packageInfo={packageInfo} version={version} filename={remainingFilename} file={file!} />,
        env,
        {
          headers: {
            "Cache-Control": "public, max-age=180",
          },
        },
      );
    }

    let dirname = remainingFilename.replace(/\/*$/, "/");
    let matchingFiles = files.filter((file) => file.path.startsWith(dirname));

    return renderPage(
      <FileListing packageInfo={packageInfo} version={version} dirname={dirname} files={matchingFiles} />,
      env,
      {
        headers: {
          "Cache-Control": "public, max-age=180",
        },
      },
    );
  }

  return renderPage(<NotFound message={`Not Found: ${url.pathname}`} />, env, {
    status: 404,
  });
}

function notFound(message?: string, init?: ResponseInit): Response {
  return new Response(message ?? "Not found", { status: 404, ...init });
}

function redirect(location: string | URL, status = 302): Response {
  return new Response(`Redirecting to ${location}`, {
    status,
    headers: { Location: location.toString() },
  });
}

async function renderPage(node: VNode, env: Env, init?: ResponseInit): Promise<Response> {
  let assetsManifest = await loadAssetsManifest({
    origin: env.ASSETS_ORIGIN,
    dev: env.MODE === "development",
  });
  let hrefs = new HrefBuilder(env);

  let html = render(
    <AssetsContext.Provider value={assetsManifest}>
      <HrefsContext.Provider value={hrefs}>
        <Document>{node}</Document>
      </HrefsContext.Provider>
    </AssetsContext.Provider>,
  );

  return new Response("<!DOCTYPE html>" + html, {
    ...init,
    headers: {
      "Content-Type": "text/html",
      ...init?.headers,
    },
  });
}
