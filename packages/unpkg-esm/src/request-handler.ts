import {
  getEsmPackageSubpath,
  getPackageInfo,
  normalizeEsmRequestUrl,
  normalizeSearchParams,
  resolvePackageExport,
  resolvePackageVersion,
} from "unpkg-worker";
import type { EsmRequestError, PackageJson } from "unpkg-worker";

import { createHomePage } from "./components/home-page.tsx";
import type { Env } from "./env.ts";

const publicNpmRegistry = "https://registry.npmjs.org";
// Redirects, metadata, and errors stay short-lived so resolution changes roll out
// quickly; artifacts at exact-version canonical URLs are immutable.
const shortCacheControl = "public, max-age=60, s-maxage=300";
const immutableCacheControl = "public, max-age=31536000, immutable";

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

  if (url.pathname === "/transform" && request.method === "POST") {
    return handleInlineTransformRequest(request, env);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(`Invalid request method: ${request.method}`, {
      status: 405,
    });
  }

  if (url.pathname === "/_health") {
    return new Response("OK");
  }

  if (url.pathname === "/index.html") {
    return redirect("/", 301);
  }

  if (url.pathname === "/") {
    return new Response(createHomePage(env), {
      headers: {
        "Cache-Control": shortCacheControl,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  let normalized = normalizeEsmRequestUrl(request.url);
  if ("code" in normalized) {
    return jsonError(normalized);
  }

  let packagePath = normalized.packagePath;
  let packageInfo = await getPackageInfo(context, publicNpmRegistry, packagePath.package);
  if (packageInfo == null) {
    return jsonError({
      code: "PACKAGE_NOT_FOUND",
      message: `Package not found: ${packagePath.package}`,
      status: 404,
    });
  }

  // Canonical name from the registry; may differ from the request in case.
  // Only trust it when it is a case variant of what was requested, so a
  // malformed registry document cannot produce foreign redirects or loops.
  let packageName =
    typeof packageInfo.name === "string" && packageInfo.name.toLowerCase() === packagePath.package.toLowerCase()
      ? packageInfo.name
      : packagePath.package;

  let version = resolvePackageVersion(packageInfo, packagePath.version ?? "latest");
  if (version == null || packageInfo.versions == null || packageInfo.versions[version] == null) {
    return jsonError({
      code: "PACKAGE_VERSION_NOT_FOUND",
      message: `Package version not found: ${packageName}@${packagePath.version ?? "latest"}`,
      status: 404,
    });
  }

  let searchParams = new URLSearchParams(normalized.searchParams);
  if (packagePath.externalAll && !searchParams.has("external")) {
    searchParams.set("external", "*");
  }

  let search = normalizeSearchParams(searchParams);
  let pathname = `/${packageName}@${version}${packagePath.filename ?? ""}`;
  let shouldRedirect =
    packagePath.externalAll ||
    packageName !== packagePath.package ||
    packagePath.version !== version ||
    url.pathname !== normalized.url.pathname ||
    url.search !== normalized.url.search ||
    normalized.url.pathname !== pathname ||
    normalized.url.search !== search;

  if (shouldRedirect) {
    return redirect(`${pathname}${search}`, {
      status: packagePath.version === version ? 301 : 302,
      headers: corsHeaders({
        "Cache-Control": shortCacheControl,
      }),
    });
  }

  let packageJson = packageInfo.versions[version];

  if (isTypeDeclarationPath(packagePath.filename)) {
    return serveRawFile(env, packageName, version, packagePath.filename);
  }

  if (isTypesOnlyPackage(packageName) && packagePath.filename == null) {
    let typesPath = getPackageTypesUrl(normalized.url.origin, packageName, version, packagePath.filename, packageJson);
    if (typesPath != null) {
      return redirect(new URL(typesPath).pathname, {
        status: 301,
        headers: corsHeaders({
          "Cache-Control": shortCacheControl,
        }),
      });
    }
  }

  if (searchParams.has("meta")) {
    let metadata = await createMetadata(
      env,
      context,
      normalized.url.origin,
      packageName,
      version,
      packagePath.filename,
      packageJson,
      searchParams
    );
    if ("response" in metadata) {
      return metadata.response;
    }

    return Response.json(metadata, {
      headers: corsHeaders({
        "Cache-Control": shortCacheControl,
        "Content-Type": "application/json",
      }),
    });
  }

  if (searchParams.has("worker")) {
    let workerSearchParams = new URLSearchParams(searchParams);
    workerSearchParams.delete("worker");
    let workerUrl = new URL(
      `/${packageName}@${version}${packagePath.filename ?? ""}${normalizeSearchParams(workerSearchParams)}`,
      normalized.url.origin
    );
    let code = `export default function createWorker(options) {\n  return new Worker(${JSON.stringify(workerUrl.toString())}, { type: "module", ...options });\n}\n`;

    return new Response(code, {
      headers: corsHeaders({
        "Cache-Control": immutableCacheControl,
        "Content-Type": "application/javascript; charset=utf-8",
      }),
    });
  }

  if (searchParams.has("raw")) {
    let rawPath = await resolveRawPath(env, packageName, version, packageJson, packagePath.filename);
    if (packagePath.filename !== rawPath) {
      let rawSearch = isCssPath(rawPath) ? "" : search;
      return redirect(`/${packageName}@${version}${rawPath}${rawSearch}`, {
        status: 301,
        headers: corsHeaders({
          "Cache-Control": shortCacheControl,
        }),
      });
    }

    return serveRawFile(env, packageName, version, rawPath);
  }

  let cssPath = resolveCssPath(packageJson, packagePath.filename);
  if (cssPath != null) {
    if (packagePath.filename !== cssPath) {
      let cssSearchParams = new URLSearchParams();
      if (searchParams.has("module")) {
        cssSearchParams.set("module", searchParams.get("module") ?? "");
      }

      return redirect(`/${packageName}@${version}${cssPath}${normalizeSearchParams(cssSearchParams)}`, {
        status: 301,
        headers: corsHeaders({
          "Cache-Control": shortCacheControl,
        }),
      });
    }

    return searchParams.has("module")
      ? serveCssModule(env, packageName, version, cssPath)
      : serveRawFile(env, packageName, version, cssPath);
  }

  if (searchParams.has("css")) {
    return jsonError({
      code: "CSS_NOT_FOUND",
      message: `Package CSS not found: ${packageName}@${version}${packagePath.filename ?? ""}`,
      status: 404,
    });
  }

  return createBuildResponse(env, normalized.url.origin, packageName, version, packagePath.filename, packageJson, searchParams);
}

/**
 * Fetches a build artifact from the files origin and wraps it as the module
 * response served to browsers. Both the module route and ?meta integrity use
 * this, so the hashed bytes always match the bytes a browser receives.
 */
async function createBuildResponse(
  env: Env,
  origin: string,
  packageName: string,
  version: string,
  filename: string | undefined,
  packageJson: PackageJson,
  searchParams: URLSearchParams
): Promise<Response> {
  let buildSearchParams = new URLSearchParams(searchParams);
  buildSearchParams.set("origin", origin);
  let buildResponse = await fetch(
    new URL(`/build/${packageName}@${version}${filename ?? ""}${normalizeSearchParams(buildSearchParams)}`, env.FILES_ORIGIN)
  );
  if (!buildResponse.ok) {
    return jsonError({
      code: "BUILD_FAILED",
      message: await buildResponse.text(),
      status: buildResponse.status,
    });
  }

  let headers = new Headers(buildResponse.headers);
  for (let [name, value] of Object.entries(corsHeaders())) {
    headers.set(name, value);
  }
  let types = getPackageTypesUrl(origin, packageName, version, filename, packageJson);
  if (types != null && !searchParams.has("no-dts")) {
    headers.set("X-TypeScript-Types", types);
  }

  return new Response(buildResponse.body, {
    status: buildResponse.status,
    statusText: buildResponse.statusText,
    headers,
  });
}

interface Metadata {
  build: {
    minify: boolean;
    sourcemap: boolean;
  };
  dependencies: Record<string, string>;
  exports: string[];
  integrity: string | null;
  module: string;
  name: string;
  peerDependencies: Record<string, string>;
  specifier: string;
  subpath: string;
  target: string;
  types: string | null;
  version: string;
}

async function createMetadata(
  env: Env,
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string | undefined,
  packageJson: PackageJson,
  searchParams: URLSearchParams
): Promise<Metadata | { response: Response }> {
  let subpath = getEsmPackageSubpath(filename);
  let target = searchParams.get("target") ?? "es2022";
  let artifactSearchParams = new URLSearchParams(searchParams);
  artifactSearchParams.delete("meta");
  let artifactSearch = normalizeSearchParams(artifactSearchParams);
  let modulePath = `/${packageName}@${version}${filename ?? ""}${artifactSearch}`;
  let module = new URL(modulePath, origin).toString();
  let types = getPackageTypesUrl(origin, packageName, version, filename, packageJson);
  let integrity = await getBuildIntegrity(env, context, origin, packageName, version, filename, packageJson, artifactSearchParams);
  if ("response" in integrity) {
    return integrity;
  }

  return {
    name: packageName,
    version,
    specifier: `${packageName}@${version}`,
    subpath,
    target,
    module,
    types,
    integrity: integrity.value,
    dependencies: packageJson.dependencies ?? {},
    peerDependencies: packageJson.peerDependencies ?? {},
    exports: listExportSubpaths(packageJson),
    build: {
      minify: searchParams.has("min"),
      sourcemap: searchParams.has("sourcemap"),
    },
  };
}

async function getBuildIntegrity(
  env: Env,
  context: ExecutionContext,
  origin: string,
  packageName: string,
  version: string,
  filename: string | undefined,
  packageJson: PackageJson,
  searchParams: URLSearchParams
): Promise<{ response: Response } | { value: string | null }> {
  if (searchParams.has("raw")) {
    return { value: null };
  }

  // Hash the same bytes the module URL serves: prefer the edge-cached artifact,
  // and cache what we build here under the module URL so the subsequent module
  // request in this colo serves exactly the hashed bytes.
  let moduleRequest = new Request(
    new URL(`/${packageName}@${version}${filename ?? ""}${normalizeSearchParams(searchParams)}`, origin)
  );
  let cache = env.MODE === "development" || env.MODE === "test" ? undefined : getDefaultCache();
  let response = cache != null ? await cache.match(moduleRequest) : undefined;

  if (response == null) {
    try {
      response = await createBuildResponse(env, origin, packageName, version, filename, packageJson, searchParams);
    } catch {
      return { value: null };
    }

    if (response.ok && cache != null) {
      context.waitUntil(cache.put(moduleRequest, response.clone()));
    }
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        response: jsonError({
          code: "BUILD_NOT_FOUND",
          message: `Build not found: ${packageName}@${version}${filename ?? ""}`,
          status: 404,
        }),
      };
    }

    return { value: null };
  }

  let bytes = await response.arrayBuffer();
  let digest = await crypto.subtle.digest("SHA-384", bytes);
  return { value: `sha384-${base64Encode(new Uint8Array(digest))}` };
}

function getDefaultCache(): Cache | undefined {
  return (globalThis.caches as unknown as { default?: Cache } | undefined)?.default;
}

async function serveRawFile(env: Env, packageName: string, version: string, filename: string): Promise<Response> {
  let rawResponse = await fetch(new URL(`/file/${packageName}@${version}${filename}`, env.FILES_ORIGIN));
  if (!rawResponse.ok) {
    return jsonError({
      code: "RAW_FILE_NOT_FOUND",
      message: await rawResponse.text(),
      status: rawResponse.status,
    });
  }

  let headers = new Headers(rawResponse.headers);
  if (isTypeDeclarationPath(filename)) {
    headers.set("Content-Type", "application/typescript; charset=utf-8");
  } else if (isCssPath(filename)) {
    headers.set("Content-Type", "text/css; charset=utf-8");
  }
  for (let [name, value] of Object.entries(corsHeaders())) {
    headers.set(name, value);
  }

  return new Response(rawResponse.body, {
    status: rawResponse.status,
    statusText: rawResponse.statusText,
    headers,
  });
}

async function serveCssModule(env: Env, packageName: string, version: string, filename: string): Promise<Response> {
  let response = await serveRawFile(env, packageName, version, filename);
  if (!response.ok) {
    return response;
  }

  let css = await response.text();
  let code = [
    "/* esm.unpkg.com - css module */",
    "const stylesheet = new CSSStyleSheet();",
    `stylesheet.replaceSync(${JSON.stringify(css)});`,
    "export default stylesheet;",
    "",
  ].join("\n");

  return new Response(code, {
    headers: corsHeaders({
      "Cache-Control": immutableCacheControl,
      "Content-Type": "application/javascript; charset=utf-8",
    }),
  });
}

function resolveCssPath(packageJson: PackageJson, filename: string | undefined): string | null {
  if (filename != null && filename !== "/") {
    if (isCssPath(filename)) {
      return filename;
    }

    let resolved = resolvePackageExport(packageJson, filename, {
      conditions: ["style", "css", "browser", "import", "default"],
      useBrowserField: true,
      useModuleField: false,
    });
    return resolved != null && isCssPath(resolved) ? resolved : null;
  }

  for (let candidate of [
    getPackageJsonString(packageJson, "style"),
    getPackageJsonString(packageJson, "css"),
    getPackageJsonString(packageJson, "unpkg"),
    resolvePackageExport(packageJson, "/", {
      conditions: ["style", "css", "browser", "import", "default"],
      useBrowserField: true,
      useModuleField: false,
    }),
    packageJson.main,
  ]) {
    if (candidate != null && isCssPath(candidate)) {
      return normalizePackageFilename(candidate);
    }
  }

  return null;
}

async function resolveRawPath(
  env: Env,
  packageName: string,
  version: string,
  packageJson: PackageJson,
  filename: string | undefined
): Promise<string> {
  let resolved: string;
  if (filename != null && filename !== "/") {
    resolved =
      resolvePackageExport(packageJson, filename, {
        conditions: ["import", "module", "default"],
        useBrowserField: false,
        useModuleField: packageJson.exports == null,
      }) ?? filename;
  } else {
    resolved =
      resolvePackageExport(packageJson, "/", {
        conditions: ["import", "module", "default"],
        useBrowserField: false,
        useModuleField: packageJson.exports == null,
      }) ?? "/index.js";
  }

  if (hasFileExtension(resolved)) {
    return resolved;
  }

  for (let candidate of [`${resolved}.js`, `${resolved}.mjs`, `${resolved}.cjs`, `${resolved.replace(/\/+$/, "")}/index.js`]) {
    if (await rawFileExists(env, packageName, version, candidate)) {
      return candidate;
    }
  }

  return resolved;
}

async function rawFileExists(env: Env, packageName: string, version: string, filename: string): Promise<boolean> {
  let response = await fetch(new URL(`/file/${packageName}@${version}${filename}`, env.FILES_ORIGIN));
  return response.ok;
}

function hasFileExtension(filename: string): boolean {
  return /\.[^/]+$/.test(filename);
}

function getPackageJsonString(packageJson: PackageJson, key: string): string | undefined {
  let value = (packageJson as PackageJson & Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function normalizePackageFilename(filename: string): string {
  return filename.replace(/^\.?\/*/, "/");
}

function isCssPath(filename: string): boolean {
  return filename.endsWith(".css");
}

function getPackageTypesUrl(
  origin: string,
  packageName: string,
  version: string,
  filename: string | undefined,
  packageJson: PackageJson
): string | null {
  let types = resolveTypesPath(packageJson, getEsmPackageSubpath(filename));
  return types == null ? null : new URL(`/${packageName}@${version}/${types.replace(/^\.?\/*/, "")}`, origin).toString();
}

function isTypesOnlyPackage(packageName: string): boolean {
  return packageName.startsWith("@types/");
}

function isTypeDeclarationPath(filename: string | undefined): filename is string {
  return filename?.endsWith(".d.ts") || filename?.endsWith(".d.mts") || filename?.endsWith(".d.cts") || false;
}

export function resolveTypesPath(packageJson: PackageJson, subpath: string): string | null {
  let exports = packageJson.exports;
  if (typeof exports === "object" && exports != null) {
    let exportValue = exports[subpath];
    let resolved = findTypesExport(exportValue);
    if (resolved != null) {
      return resolved;
    }
  }

  if (subpath === ".") {
    return packageJson.types ?? packageJson.typings ?? null;
  }

  let typesVersionsPath = resolveTypesVersionsPath(packageJson, subpath);
  if (typesVersionsPath != null) {
    return typesVersionsPath;
  }

  return packageJson.types ?? packageJson.typings ?? null;
}

function resolveTypesVersionsPath(packageJson: PackageJson, subpath: string): string | null {
  let typesVersions = packageJson.typesVersions;
  if (typesVersions == null) {
    return null;
  }

  let requestedPath = subpath === "." ? "" : subpath.replace(/^\.\//, "");
  for (let mappings of Object.values(typesVersions)) {
    let match = resolveTypesVersionMapping(mappings, requestedPath);
    if (match != null) {
      return match;
    }
  }

  return null;
}

function resolveTypesVersionMapping(mappings: Record<string, string[]>, requestedPath: string): string | null {
  let exact = mappings[requestedPath];
  if (exact?.[0] != null) {
    return exact[0];
  }

  for (let [pattern, targets] of Object.entries(mappings)) {
    if (!pattern.includes("*") || targets[0] == null) {
      continue;
    }

    let [prefix, suffix] = pattern.split("*", 2);
    if (requestedPath.startsWith(prefix) && requestedPath.endsWith(suffix)) {
      let matched = requestedPath.slice(prefix.length, requestedPath.length - suffix.length);
      return targets[0].replace("*", matched);
    }
  }

  return null;
}

function findTypesExport(value: unknown): string | null {
  if (typeof value === "string") {
    return null;
  }
  if (typeof value !== "object" || value == null) {
    return null;
  }

  let conditions = value as Record<string, unknown>;
  let types = conditions.types;
  if (typeof types === "string") {
    return types;
  }
  if (typeof types === "object" && types != null) {
    let resolved = findConditionalExport(types);
    if (resolved != null) {
      return resolved;
    }
  }

  for (let [name, nested] of Object.entries(conditions)) {
    if (name === "types" || name.startsWith("types@")) {
      continue;
    }

    let resolved = findTypesExport(nested);
    if (resolved != null) {
      return resolved;
    }
  }

  return null;
}

function findConditionalExport(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value !== "object" || value == null) {
    return null;
  }

  let conditions = value as Record<string, unknown>;
  if (typeof conditions.default === "string") {
    return conditions.default;
  }

  for (let nested of Object.values(conditions)) {
    let resolved = findConditionalExport(nested);
    if (resolved != null) {
      return resolved;
    }
  }

  return null;
}

function listExportSubpaths(packageJson: PackageJson): string[] {
  if (typeof packageJson.exports !== "object" || packageJson.exports == null) {
    return [];
  }

  return Object.keys(packageJson.exports).filter((key) => key.startsWith("."));
}

function jsonError(error: EsmRequestError | { code: string; message: string; status: number }): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    {
      status: error.status,
      headers: corsHeaders({
        "Cache-Control": shortCacheControl,
        "Content-Type": "application/json",
      }),
    }
  );
}

function corsHeaders(headers?: HeadersInit): HeadersInit {
  return {
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    ...headers,
  };
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

async function handleInlineTransformRequest(request: Request, env: Env): Promise<Response> {
  let sourceResponse = await fetch(new URL(`/transform${new URL(request.url).search}`, env.FILES_ORIGIN), {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("Content-Type") ?? "application/json",
    },
    body: await request.arrayBuffer(),
  });

  let headers = new Headers(sourceResponse.headers);
  for (let [name, value] of Object.entries(corsHeaders())) {
    headers.set(name, value);
  }

  return new Response(sourceResponse.body, {
    status: sourceResponse.status,
    statusText: sourceResponse.statusText,
    headers,
  });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
