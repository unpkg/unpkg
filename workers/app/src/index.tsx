import { type VNode } from "preact";
import { render } from "preact-render-to-string";

import { AssetsContext, loadAssetsManifest } from "./assets.ts";
import { Document } from "./components/document.tsx";
import { FileDetail } from "./components/file-detail.tsx";
import { FileListing } from "./components/file-listing.tsx";
import { NotFound } from "./components/not-found.tsx";
import { ContextProvider } from "./context.ts";
import { type Env } from "./env.ts";
import { HrefsContext, HrefBuilder } from "./hrefs.ts";
import { fetchPackageInfo } from "./pkg-info.js";
import { resolvePackageVersion } from "./pkg-version.ts";
import { WwwWorkerProxy } from "./www-worker.ts";

export default {
  async fetch(request, env, ctx) {
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

    let packageInfo = await fetchPackageInfo(parsed, env, ctx);
    if (packageInfo == null) {
      return notFound(`Package not found: "${parsed.package}"`);
    }

    let requestedVersion = parsed.version ?? "latest";
    let version = resolvePackageVersion(packageInfo, requestedVersion);
    if (version == null || packageInfo.versions == null || packageInfo.versions[version] == null) {
      return notFound(`Package version not found: ${parsed.package}@${requestedVersion}`);
    }

    if (parsed.filename != null && parsed.filename.endsWith("/")) {
      let noTrailingSlash = parsed.filename.replace(/\/+$/, "");
      return redirect(`${url.origin}/${parsed.package}@${version}${noTrailingSlash}`, 301);
    }
    if (parsed.filename === "/files") {
      return redirect(`${url.origin}/${parsed.package}@${version}`);
    }
    if (version !== parsed.version) {
      return redirect(`${url.origin}/${parsed.package}@${version}${parsed.filename ?? ""}`);
    }

    let wwwProxy = new WwwWorkerProxy(env.WWW, env.WWW_ORIGIN);
    let fileListing = await wwwProxy.getFileListing(packageInfo.name, version, "/");

    let filename = parsed.filename ?? "/";

    if (filename === "/") {
      return renderPage(
        <FileListing packageInfo={packageInfo} version={version} dirname="/" files={fileListing.files} />,
        env,
      );
    }

    if (filename.startsWith("/files/")) {
      let remainingFilename = filename.slice(6);
      let matchingFile = fileListing.files.find((file) => file.path === remainingFilename);

      if (matchingFile != null) {
        let file = await wwwProxy.getFile(packageInfo.name, version, remainingFilename);

        return renderPage(
          <FileDetail packageInfo={packageInfo} version={version} filename={remainingFilename} file={file!} />,
          env,
        );
      }

      let dirname = remainingFilename.replace(/\/*$/, "/");
      let matchingFiles = fileListing.files.filter((file) => file.path.startsWith(dirname));

      return renderPage(
        <FileListing packageInfo={packageInfo} version={version} dirname={dirname} files={matchingFiles} />,
        env,
      );
    }

    return renderPage(<NotFound message={`Not Found: ${filename}`} />, env, {
      status: 404,
    });
  },
} satisfies ExportedHandler<Env>;

function parsePackagePathname(pathname: string): {
  package: string;
  scope?: string;
  version?: string;
  filename?: string;
} | null {
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    console.error(`Failed to decode pathname: ${pathname}`);
  }

  let match = /^\/((?:(@[^/@]+)\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(pathname);

  if (match == null) return null;

  return {
    package: match[1],
    scope: match[2],
    version: match[3],
    filename: match[4],
  };
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
  let context = new ContextProvider([
    [
      AssetsContext,
      await loadAssetsManifest({
        origin: env.ASSETS_ORIGIN,
        dev: env.MODE === "development",
      }),
    ],
    [HrefsContext, new HrefBuilder(env)],
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
