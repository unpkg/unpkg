import type { VNode } from "preact";
import { render } from "preact-render-to-string";
import {
  fetchFile,
  createInlineRunner,
  getPackageInfo,
  listFiles,
  parsePackagePathname,
  resolvePackageExport,
  resolvePackageVersion,
  rewriteImports,
} from "unpkg-worker";

import { getRequestCacheGeneration } from "./cache-generations.ts";
import { AssetsContext } from "./assets-context.ts";
import { loadAssetsManifest } from "./assets-manifest.ts";
import type { Env } from "./env.ts";
import { withUtf8Charset } from "./response.ts";
import { llmsFullTxt, llmsTxt, robotsTxt, sitemapXml } from "./seo.ts";
import { Document } from "./components/document.tsx";
import { Home } from "./components/home.tsx";
import {
  BrowserModulesGuide,
  CachePerformanceGuide,
  GUIDES,
  InlineScriptsGuide,
  LoadingFilesGuide,
  MetadataApiGuide,
  NobuildAppsGuide,
  SupplyChainSecurityGuide,
} from "./components/guide-pages.tsx";
import { AboutPage, GuidesPage, NetworkPage, StatusPage } from "./components/marketing-pages.tsx";

const publicNpmRegistry = "https://registry.npmjs.org";
const runtimeCacheControl = "public, max-age=60, s-maxage=300";

export async function handleRequest(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  let url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        Allow: "GET, HEAD, OPTIONS, POST",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS, POST",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`Invalid request method: ${request.method}`, {
      status: 405,
    });
  }

  if (url.pathname === "/_health") {
    return new Response("OK");
  }

  if (url.pathname === "/run") {
    return new Response(createInlineRunner({ transformOrigin: env.ESM_ORIGIN }), {
      headers: {
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "*",
        "Cache-Control": runtimeCacheControl,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  if (url.pathname === "/favicon.ico") {
    return redirect("/favicon.png", 301);
  }
  if (url.pathname === "/index.html") {
    return redirect("/", 301);
  }
  if (url.pathname === "/") {
    return renderPage(env, <Home esmOrigin={env.ESM_ORIGIN} origin={env.ORIGIN} />, {
      page: {
        path: "/",
        title: "UNPKG — The CDN for everything on npm",
        description:
          "UNPKG is a fast, global content delivery network for everything on npm. Load any file from any package with a URL — no build step, served from the edge, with supply-chain defense built in.",
      },
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=60, s-maxage=300",
      },
    });
  }

  // Marketing pages. Exact paths only, like the crawler files below: a
  // small accepted shadowing list (checked 2026-10-23 — `network`,
  // `status`, `guides`, `about` are tail npm packages, 16k/2.6k/0.3k/0.6k
  // downloads per month; genuinely popular names such as `documentation`
  // and `platform` were deliberately not used). Versioned lookalikes
  // (/network@1.0.0/…) still fall through to package parsing.
  const marketingPages: Record<string, { node: VNode; page: PageMeta }> = {
    "/network": {
      node: <NetworkPage origin={env.ORIGIN} />,
      page: {
        path: "/network",
        title: "Network & Architecture — UNPKG",
        description:
          "How UNPKG serves npm files: Cloudflare's global edge, digest-verified origin fetches from 11 regions worldwide, self-healing caches, and Shield supply-chain defense.",
      },
    },
    "/status": {
      node: <StatusPage appOrigin={env.APP_ORIGIN} esmOrigin={env.ESM_ORIGIN} />,
      page: {
        path: "/status",
        title: "Status & Reliability — UNPKG",
        description:
          "The surfaces behind UNPKG, how changes ship safely to production, and how to check the service's health yourself.",
      },
    },
    "/guides": {
      node: <GuidesPage origin={env.ORIGIN} />,
      page: {
        path: "/guides",
        title: "Guides — UNPKG",
        description:
          "UNPKG guides: loading files from npm, nobuild apps, inline scripts, browser modules with ?module, the ?meta metadata API, cache performance, and supply-chain security.",
      },
    },
    "/about": {
      node: <AboutPage />,
      page: {
        path: "/about",
        title: "About & Trust — UNPKG",
        description:
          "About the UNPKG open source project: who maintains it, how to report abuse or security issues, and the plain-language terms of the free service.",
      },
    },
  };
  const guideNodes: Record<string, VNode> = {
    "loading-files": <LoadingFilesGuide />,
    "nobuild-apps": <NobuildAppsGuide />,
    "inline-scripts": <InlineScriptsGuide origin={env.ORIGIN} />,
    "browser-modules": <BrowserModulesGuide esmOrigin={env.ESM_ORIGIN} />,
    "metadata-api": <MetadataApiGuide />,
    "cache-performance": <CachePerformanceGuide />,
    "supply-chain-security": <SupplyChainSecurityGuide />,
  };
  let guideMatch = /^\/guides\/([a-z-]+)$/.exec(url.pathname);
  let guide = guideMatch ? GUIDES.find((entry) => entry.slug === guideMatch[1]) : undefined;
  if (guide && guideNodes[guide.slug]) {
    return renderPage(env, guideNodes[guide.slug], {
      page: {
        path: `/guides/${guide.slug}`,
        title: guide.title,
        description: guide.description,
        breadcrumbs: [
          { name: "UNPKG", path: "/" },
          { name: "Guides", path: "/guides" },
          { name: guide.heading, path: `/guides/${guide.slug}` },
        ],
      },
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=60, s-maxage=300",
      },
    });
  }

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    let trimmed = url.pathname.replace(/\/+$/, "");
    let guideSlug = /^\/guides\/([a-z-]+)$/.exec(trimmed)?.[1];
    if (marketingPages[trimmed] || trimmed === "/guides" || (guideSlug && GUIDES.some((entry) => entry.slug === guideSlug))) {
      return new Response(null, {
        status: 301,
        headers: { Location: `${env.ORIGIN}${trimmed}${url.search}` },
      });
    }
  }

  let marketingPage = marketingPages[url.pathname];
  if (marketingPage) {
    return renderPage(env, marketingPage.node, {
      page: marketingPage.page,
      headers: {
        "Cache-Control": env.DEV ? "no-store" : "public, max-age=60, s-maxage=300",
      },
    });
  }

  // Crawler and agent files. Exact paths only — everything else (including
  // versioned lookalikes like /robots.txt@1.0.0/index.js) still falls through
  // to package parsing below, unchanged.
  if (url.pathname === "/robots.txt") {
    return new Response(robotsTxt(env.ORIGIN), {
      headers: {
        "Cache-Control": runtimeCacheControl,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
  if (url.pathname === "/sitemap.xml") {
    return new Response(sitemapXml(env.ORIGIN), {
      headers: {
        "Cache-Control": runtimeCacheControl,
        "Content-Type": "application/xml; charset=utf-8",
      },
    });
  }
  if (url.pathname === "/llms.txt") {
    return new Response(llmsTxt(env.ORIGIN), {
      headers: {
        "Cache-Control": runtimeCacheControl,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }
  if (url.pathname === "/llms-full.txt") {
    return new Response(llmsFullTxt(env.ORIGIN), {
      headers: {
        "Cache-Control": runtimeCacheControl,
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  // Redirect legacy /browse/* URLs to the app's /files view
  if (url.pathname.startsWith("/browse/")) {
    let parsed = parsePackagePathname(url.pathname.slice(7));
    if (parsed) {
      return redirect(new URL(filesPathname(parsed.package, parsed.version, parsed.filename), env.APP_ORIGIN), 301);
    }
  }

  // Parse and validate the package path
  let parsed = parsePackagePathname(url.pathname);
  if (parsed == null) {
    return notFound(`Invalid URL pathname: ${url.pathname}`);
  }

  let packageName = parsed.package.toLowerCase();
  let packageInfo = await getPackageInfo(context, publicNpmRegistry, packageName);
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
      return redirect(`/${packageName}@${version}${prefix}${url.search}`, {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      });
    }

    let files = await listFiles(context, env.FILES_ORIGIN, packageName, version, prefix, {
      cacheGeneration: getRequestCacheGeneration(request),
    });
    let fileListing = {
      package: packageName,
      version,
      prefix,
      files,
    };

    return Response.json(fileListing, {
      headers: {
        "Cache-Control": "public, max-age=31536000",
        "Cache-Tag": "meta", // This allows us to purge the cache if ?meta behavior ever changes
        "Content-Type": "application/json",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  // Support "append a /" behavior for viewing file listings in the app
  if (filename != null && filename.endsWith("/")) {
    // If the version number is already resolved, we can issue a permanent redirect (301)
    if (version === parsed.version) {
      return redirect(new URL(filesPathname(packageName, version, filename), env.APP_ORIGIN), 301);
    }

    // Otherwise it should be temporary (302)
    return redirect(new URL(filesPathname(packageName, version, filename), env.APP_ORIGIN), {
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

  let resolutionTrace: { usedBrowserField?: boolean; usedCondition?: boolean } = {};
  let resolveOptions = {
    useBrowserField: wantsBrowser,
    useModuleField: wantsModule,
    conditions,
    trace: resolutionTrace,
  };
  let resolvedFilename = resolvePackageExport(packageJson, filename ?? "/", resolveOptions);
  let usedExplicitCondition = conditions != null && resolutionTrace.usedCondition === true;
  let usesExplicitExportMapping = resolutionTrace.usedBrowserField === true || usedExplicitCondition;

  // Export targets are physical package files, so they must not be fed back through
  // package export resolution after a redirect. When an explicit request matches an
  // export, use the file listing to distinguish a real file from an export subpath.
  let files = filename != null && resolvedFilename != null && resolvedFilename !== filename
    ? await listFiles(context, env.FILES_ORIGIN, packageName, version, "/", {
        cacheGeneration: getRequestCacheGeneration(request),
      })
    : undefined;

  if (files != null && resolvedFilename != null && filename != null) {
    let requestedFilename = filename;
    let resolvedTargetFilename = resolvedFilename;
    let requestedFile = files.find(
      (file) => file.path.toLowerCase() === requestedFilename.toLowerCase(),
    );
    let resolvedFile = files.find(
      (file) => file.path.toLowerCase() === resolvedTargetFilename.toLowerCase(),
    );

    if (requestedFile != null && !usesExplicitExportMapping) {
      // The request already names the physical export target. Serve it directly.
      resolvedFilename = filename;
    } else if (resolvedFile == null) {
      if (version !== parsed.version) {
        // Pin the original request before deciding how to handle a missing target.
        return redirect(`/${packageName}@${version}${requestedFilename}${url.search}`, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60, s-maxage=300",
            "Cross-Origin-Resource-Policy": "cross-origin",
          },
        });
      }

      // A bad permanent redirect that repeatedly appended a suffix may already be
      // cached by clients. Recover only that exact shape: X -> X+suffix ->
      // X+suffix+suffix. Broader reverse export lookup is ambiguous and could serve
      // the wrong physical file for a legitimate export subpath.
      let appendedSuffix = !usesExplicitExportMapping && resolvedTargetFilename.startsWith(requestedFilename)
        ? resolvedTargetFilename.slice(requestedFilename.length)
        : "";
      let predecessorPath =
        appendedSuffix !== "" && requestedFilename.endsWith(appendedSuffix)
          ? requestedFilename.slice(0, -appendedSuffix.length)
          : null;
      let predecessorFiles =
        predecessorPath == null
          ? []
          : files.filter((file) => file.path.toLowerCase() === predecessorPath.toLowerCase());
      let predecessorFile = predecessorFiles.length === 1 ? predecessorFiles[0] : undefined;

      if (
        predecessorFile == null ||
        resolvePackageExport(packageJson, predecessorFile.path, resolveOptions) !== requestedFilename
      ) {
        return notFound(`Not found: ${url.pathname}${url.search}`);
      }

      filename = predecessorFile.path;
      resolvedFilename = filename;
    }
  }

  // If the resolved filename is different from the original filename, redirect to the new URL
  if (resolvedFilename != null && resolvedFilename !== filename) {
    let redirectSearchParams = new URLSearchParams(url.search);
    // Browser and condition selectors resolve the logical subpath. Do not carry
    // either one onto the physical target where an initially unused selector could
    // become active and resolve the target again. `module` remains because it also
    // controls import rewriting when the physical file is served.
    redirectSearchParams.delete("browser");
    redirectSearchParams.delete("conditions");
    let redirectSearch = redirectSearchParams.size === 0 ? "" : `?${redirectSearchParams}`;
    let location = `/${packageName}@${version}${resolvedFilename}${redirectSearch}`;

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
    return redirect(`/${packageName}@${version}${filename ?? ""}${url.search}`, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  }

  files ??= await listFiles(context, env.FILES_ORIGIN, packageName, version, "/", {
    cacheGeneration: getRequestCacheGeneration(request),
  });

  if (filename != null && files.some((file) => file.path.toLowerCase() === filename.toLowerCase())) {
    let response = await fetchFile(context, env.FILES_ORIGIN, packageName, version, filename, {
      cacheGeneration: getRequestCacheGeneration(request),
    });

    if (response != null) {
      // In ?module requests, rewrite imports to unpkg.com/* URLs in JavaScript modules
      if (
        response.headers.has("Content-Type") &&
        response.headers.get("Content-Type")!.startsWith("text/javascript") &&
        url.searchParams.has("module")
      ) {
        let code = new TextDecoder().decode(await response.arrayBuffer());
        let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies);
        let newCode = rewriteImports(code, url.origin, deps);

        return new Response(newCode, {
          headers: {
            "Cache-Control": "public, max-age=31536000",
            "Cache-Tag": "js-module", // This allows us to purge the cache if ?module behavior ever changes
            "Content-Type": "text/javascript; charset=utf-8",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "*",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "X-Robots-Tag": "noindex",
          },
        });
      }

      // In all other requests adjust some headers and pass the response straight through
      let headers = new Headers(response.headers);

      // Cache the response for 1 year if it isn't already set
      if (!headers.has("Cache-Control")) {
        headers.set("Cache-Control", "public, max-age=31536000");
      }

      // Everything served from a package path is package content, not
      // our site: HTML apps, READMEs, type definitions, all of it gets
      // indexed under unpkg.com today. Keep all of it out of search
      // indexes so the marketing site is what search engines associate
      // with this domain. Crawling/loading is unaffected — noindex only
      // removes these URLs from search results.
      headers.set("X-Robots-Tag", "noindex");

      // Add CORS headers
      headers.set("Access-Control-Allow-Headers", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Expose-Headers", "*");
      headers.set("Cross-Origin-Resource-Policy", "cross-origin");

      if (response.body == null) {
        headers.delete("Content-Length");
      }

      // Pass the body through as a stream. The shared fetch helper has
      // already verified it (or is verifying it incrementally), so there
      // is no need to buffer the whole file in this worker.
      return withUtf8Charset(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
      );
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
  let basename = filename == null || filename === "/" ? "" : filename.replace(/\/+$/, "");
  let match =
    files.find((file) => file.path === `${basename}.js`) || files.find((file) => file.path === `${basename}/index.js`);
  if (match != null) {
    return redirect(`/${packageName}@${version}${match.path}${url.search}`, {
      status: 301, // Version number in the URL is already resolved, so this is a permanent redirect
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

interface PageMeta {
  title: string;
  description: string;
  path: string;
  breadcrumbs?: { name: string; path: string }[];
}

async function renderPage(
  env: Env,
  node: VNode,
  init?: ResponseInit & { page?: PageMeta }
): Promise<Response> {
  let assetsManifest = await loadAssetsManifest(env);
  let { page, ...responseInit } = init ?? {};

  let html = render(
    <AssetsContext.Provider value={assetsManifest}>
      <Document
        origin={env.ORIGIN}
        gaId={env.GA_MEASUREMENT_ID}
        title={page?.title}
        description={page?.description}
        path={page?.path}
        breadcrumbs={page?.breadcrumbs}
      >
        {node}
      </Document>
    </AssetsContext.Provider>
  );

  return new Response("<!DOCTYPE html>" + html, {
    ...responseInit,
    headers: {
      "Content-Type": "text/html",
      ...responseInit.headers,
    },
  });
}

function filesPathname(packageName: string, version?: string, filename?: string): string {
  // The /files prefix is not needed for the root of the file browser.
  let path = filename == null || filename === "/" ? "" : `/files${filename.replace(/\/+$/, "")}`;
  return `/${packageName}${version ? `@${version}` : ""}${path}`;
}
