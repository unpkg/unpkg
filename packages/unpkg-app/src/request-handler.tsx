import { type VNode } from "preact";
import { render } from "preact-render-to-string";
import { getFile, getPackageInfo, listFiles, parsePackagePathname, resolvePackageVersion } from "unpkg-tools";

import { AssetsContext } from "./assets-context.ts";
import { loadAssetsManifest } from "./assets-manifest.ts";
import { devLogger } from "./dev-logging.ts";
import { env } from "./env.ts";
import { findPublicAsset } from "./public-assets.ts";
import { Document } from "./components/document.tsx";
import { FileDetail } from "./components/file-detail.tsx";
import { FileListing } from "./components/file-listing.tsx";
import { NotFound } from "./components/not-found.tsx";

const publicNpmRegistry = "https://registry.npmjs.org";

export async function handleRequest(request: Request): Promise<Response> {
  try {
    let response: Response;
    if (env.DEV) {
      let start = Date.now();
      response = await handleRequest_(request);
      devLogger(request, response, Date.now() - start);
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
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`Invalid request method: ${request.method}`, { status: 405 });
  }

  let assetFile = await findPublicAsset(request);
  if (assetFile != null) {
    return new Response(assetFile, {
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=31536000",
        "Content-Type": assetFile.type,
      },
    });
  }

  let url = new URL(request.url);

  if (url.pathname === "/_health") {
    return new Response("OK");
  }
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
  let packageInfo = await getPackageInfo(publicNpmRegistry, packageName);
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

  let files = await listFiles(publicNpmRegistry, packageName, version, "/");
  let filename = parsed.filename ?? "/";

  if (filename === "/") {
    return renderPage(<FileListing packageInfo={packageInfo} version={version} dirname="/" files={files} />, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
      },
    });
  }

  if (filename.startsWith("/files/")) {
    let remainingFilename = filename.slice(6);
    let matchingFile = files.find((file) => file.path === remainingFilename);

    if (matchingFile != null) {
      let file = await getFile(publicNpmRegistry, packageName, version, remainingFilename);

      return renderPage(
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
      <FileListing packageInfo={packageInfo} version={version} dirname={dirname} files={matchingFiles} />,
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  }

  return renderPage(<NotFound message={`Not Found: ${url.pathname}`} />, {
    status: 404,
  });
}

function notFound(message?: string, init?: ResponseInit): Response {
  return new Response(message ?? "Not Found", { status: 404, ...init });
}

function redirect(location: string | URL, status = 302): Response {
  return new Response(`Redirecting to ${location}`, {
    status,
    headers: { Location: location.toString() },
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
