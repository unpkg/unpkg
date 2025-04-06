import { type VNode } from "preact";
import { render } from "preact-render-to-string";
import { getFile, getPackageInfo, listFiles, parsePackagePathname, resolvePackageVersion } from "unpkg-worker";

import { AssetsContext } from "./assets-context.ts";
import { loadAssetsManifest } from "./assets-manifest.ts";
import { Document } from "./components/document.tsx";
import { FileDetail } from "./components/file-detail.tsx";
import { FileListing } from "./components/file-listing.tsx";
import { NotFound } from "./components/not-found.tsx";
import type { Env } from "./env.ts";
import { HrefBuilder } from "./href-builder.ts";
import { HrefsContext } from "./hrefs-context.ts";

const publicNpmRegistry = "https://registry.npmjs.org";

export async function handleRequest(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: { Allow: "GET, HEAD, OPTIONS" },
    });
  }
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
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return redirect(env.WWW_ORIGIN, 301);
  }

  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid package pathname: ${url.pathname}`);
  }

  let packageName = parsed.package.toLowerCase();
  let packageInfo = await getPackageInfo(context, publicNpmRegistry, packageName);
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
    return redirect(`/${packageName}@${version}${noTrailingSlash}`, 301);
  }
  if (parsed.filename === "/files") {
    return redirect(`/${packageName}@${version}`, 301);
  }
  if (version !== parsed.version) {
    return redirect(`/${packageName}@${version}${parsed.filename ?? ""}`, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }

  let files = await listFiles(context, env.FILES_ORIGIN, packageName, version, "/");
  let filename = parsed.filename ?? "/";

  if (filename === "/") {
    return renderPage(env, <FileListing packageInfo={packageInfo} version={version} dirname="/" files={files} />, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }

  if (filename.startsWith("/files/")) {
    let remainingFilename = filename.slice(6);
    let matchingFile = files.find((file) => file.path === remainingFilename);

    if (matchingFile != null) {
      let file = await getFile(context, env.FILES_ORIGIN, packageName, version, remainingFilename);

      return renderPage(
        env,
        <FileDetail packageInfo={packageInfo} version={version} filename={remainingFilename} file={file!} />,
        {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=300",
          },
        }
      );
    }

    let dirname = remainingFilename.replace(/\/*$/, "/");
    let matchingFiles = files.filter((file) => file.path.startsWith(dirname));

    return renderPage(
      env,
      <FileListing packageInfo={packageInfo} version={version} dirname={dirname} files={matchingFiles} />,
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  }

  return renderPage(env, <NotFound message={`Not Found: ${url.pathname}`} />, {
    status: 404,
  });
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

async function renderPage(env: Env, node: VNode, init?: ResponseInit): Promise<Response> {
  let assetsManifest = await loadAssetsManifest(env);
  let hrefBuilder = new HrefBuilder(env);

  let html = render(
    <AssetsContext.Provider value={assetsManifest}>
      <HrefsContext.Provider value={hrefBuilder}>
        <Document wwwOrigin={env.WWW_ORIGIN}>{node}</Document>
      </HrefsContext.Provider>
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
