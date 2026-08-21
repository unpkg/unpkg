import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as esbuild from "esbuild";
import { parse } from "es-module-lexer/js";
import {
  resolvePackageExport,
  resolvePackageVersion,
} from "unpkg-worker";
import type { PackageInfo } from "unpkg-worker";

import { getFile, withPackageFileDirectory } from "./npm-files.ts";

const defaultEsmOrigin = "https://esm.unpkg.com";
const moduleCacheControl = "public, max-age=60, s-maxage=300";
const hardNodeBuiltins = new Set([
  "child_process",
  "cluster",
  "dgram",
  "dns",
  "fs",
  "module",
  "net",
  "node:child_process",
  "node:cluster",
  "node:dgram",
  "node:dns",
  "node:fs",
  "node:module",
  "node:net",
  "node:readline",
  "node:tls",
  "node:worker_threads",
  "readline",
  "tls",
  "worker_threads",
]);
const browserBuiltinPolyfills: Record<string, string> = {
  "node:assert": "@jspm/core@2/nodelibs/browser/assert",
  "node:buffer": "@jspm/core@2/nodelibs/browser/buffer",
  "node:child_process": "@jspm/core@2/nodelibs/browser/child_process",
  "node:cluster": "@jspm/core@2/nodelibs/browser/cluster",
  "node:crypto": "@jspm/core@2/nodelibs/browser/crypto",
  "node:dgram": "@jspm/core@2/nodelibs/browser/dgram",
  "node:dns": "@jspm/core@2/nodelibs/browser/dns",
  "node:events": "@jspm/core@2/nodelibs/browser/events",
  "node:fs": "@jspm/core@2/nodelibs/browser/fs",
  "node:http": "@jspm/core@2/nodelibs/browser/http",
  "node:https": "@jspm/core@2/nodelibs/browser/https",
  "node:module": "@jspm/core@2/nodelibs/browser/module",
  "node:net": "@jspm/core@2/nodelibs/browser/net",
  "node:os": "@jspm/core@2/nodelibs/browser/os",
  "node:path": "@jspm/core@2/nodelibs/browser/path",
  "node:punycode": "@jspm/core@2/nodelibs/browser/punycode",
  "node:process": "@jspm/core@2/nodelibs/browser/process",
  "node:readline": "@jspm/core@2/nodelibs/browser/readline",
  "node:stream": "@jspm/core@2/nodelibs/browser/stream",
  "node:string_decoder": "@jspm/core@2/nodelibs/browser/string_decoder",
  "node:timers": "@jspm/core@2/nodelibs/browser/timers",
  "node:tls": "@jspm/core@2/nodelibs/browser/tls",
  "node:url": "@jspm/core@2/nodelibs/browser/url",
  "node:util": "@jspm/core@2/nodelibs/browser/util",
  "node:worker_threads": "@jspm/core@2/nodelibs/browser/worker_threads",
  "node:zlib": "@jspm/core@2/nodelibs/browser/zlib",
  assert: "@jspm/core@2/nodelibs/browser/assert",
  buffer: "@jspm/core@2/nodelibs/browser/buffer",
  child_process: "@jspm/core@2/nodelibs/browser/child_process",
  cluster: "@jspm/core@2/nodelibs/browser/cluster",
  crypto: "@jspm/core@2/nodelibs/browser/crypto",
  dgram: "@jspm/core@2/nodelibs/browser/dgram",
  dns: "@jspm/core@2/nodelibs/browser/dns",
  events: "@jspm/core@2/nodelibs/browser/events",
  fs: "@jspm/core@2/nodelibs/browser/fs",
  http: "@jspm/core@2/nodelibs/browser/http",
  https: "@jspm/core@2/nodelibs/browser/https",
  module: "@jspm/core@2/nodelibs/browser/module",
  net: "@jspm/core@2/nodelibs/browser/net",
  os: "@jspm/core@2/nodelibs/browser/os",
  path: "@jspm/core@2/nodelibs/browser/path",
  punycode: "@jspm/core@2/nodelibs/browser/punycode",
  process: "@jspm/core@2/nodelibs/browser/process",
  readline: "@jspm/core@2/nodelibs/browser/readline",
  stream: "@jspm/core@2/nodelibs/browser/stream",
  string_decoder: "@jspm/core@2/nodelibs/browser/string_decoder",
  timers: "@jspm/core@2/nodelibs/browser/timers",
  tls: "@jspm/core@2/nodelibs/browser/tls",
  url: "@jspm/core@2/nodelibs/browser/url",
  util: "@jspm/core@2/nodelibs/browser/util",
  worker_threads: "@jspm/core@2/nodelibs/browser/worker_threads",
  zlib: "@jspm/core@2/nodelibs/browser/zlib",
};

export interface BuildRequest {
  packageName: string;
  version: string;
  filename?: string;
  options: NormalizedBuildOptions;
}

export interface NormalizedBuildOptions {
  aliases: Record<string, string>;
  bundleMode: "smart" | "bundle" | "standalone" | "none";
  conditions: string[];
  dependencyOverrides: Record<string, string>;
  env: "development" | "production";
  external: string[];
  ignoreAnnotations: boolean;
  jsx?: "react" | "preact" | "automatic";
  jsxImportSource?: string;
  keepNames: boolean;
  minify: boolean;
  origin: string;
  sourcemap: boolean;
  target: string;
}

export interface BuildMetadata {
  buildKey: string;
  input: string;
  output: string;
  packageName: string;
  target: string;
  version: string;
}

export interface BuildResult {
  code: string;
  headers: Record<string, string>;
  metadata: BuildMetadata;
}

export interface InlineTransformRequest {
  filename: string;
  options: NormalizedBuildOptions;
  source: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  exports?: string | Record<string, unknown>;
  main?: string;
  module?: string;
  name?: string;
  peerDependencies?: Record<string, string>;
  version?: string;
}

export class UnsupportedNodeBuiltinError extends Error {
  builtin: string;

  constructor(builtin: string) {
    super(`Node builtin is not available in browser builds: ${builtin}`);
    this.name = "UnsupportedNodeBuiltinError";
    this.builtin = builtin;
  }
}

export class UnsupportedSourceTypeError extends Error {
  filename: string;

  constructor(filename: string) {
    super(`Unsupported source type: ${filename}`);
    this.name = "UnsupportedSourceTypeError";
    this.filename = filename;
  }
}

export class UnsupportedDynamicRequireError extends Error {
  filename: string;

  constructor(filename: string) {
    super(`Dynamic require is not supported in browser ESM builds: ${filename}`);
    this.name = "UnsupportedDynamicRequireError";
    this.filename = filename;
  }
}

export async function buildEsmModule(registry: string, request: BuildRequest): Promise<BuildResult | null> {
  let packageJsonFile = await getFile(registry, request.packageName, request.version, "/package.json");
  if (packageJsonFile == null) {
    return null;
  }

  let packageJson = JSON.parse(new TextDecoder().decode(packageJsonFile.body)) as PackageJson;
  let filename = resolveBuildFilename(packageJson, request.filename, request.options);
  if (filename == null) {
    return null;
  }
  if (isUnsupportedSourceFile(filename)) {
    throw new UnsupportedSourceTypeError(filename);
  }

  filename = await resolveExistingSourceFilename(registry, request.packageName, request.version, filename);
  if (filename == null) {
    return null;
  }

  let file = await getFile(registry, request.packageName, request.version, filename);
  if (file == null || !isSupportedSourceFile(filename)) {
    return null;
  }

  let code = new TextDecoder().decode(file.body);
  let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies);
  let transformed =
    request.options.bundleMode === "none"
      ? await transformSource(code, filename, request.options)
      : await withPackageFileDirectory(registry, request.packageName, request.version, (packageDirectory) =>
          bundleSource(packageDirectory, packageJson, request.packageName, request.version, filename, code, request.options)
        );
  let rewritten = await rewriteEsmImports(transformed.code, registry, request.options.origin, deps, request.options);
  let buildKey = createBuildKey(request, filename);
  let metadata: BuildMetadata = {
    buildKey,
    input: filename,
    output: `/${request.packageName}@${request.version}${request.filename ?? ""}`,
    packageName: request.packageName,
    target: request.options.target,
    version: request.version,
  };

  return {
    code: rewritten,
    headers: {
      "Cache-Control": moduleCacheControl,
      "Content-Type": "application/javascript; charset=utf-8",
      "X-UNPKG-Bundle-Mode": request.options.bundleMode,
      "X-UNPKG-Build-Key": buildKey,
      "X-UNPKG-Build-Input": filename,
      "X-UNPKG-Transformer": "esbuild",
    },
    metadata,
  };
}

async function resolveExistingSourceFilename(
  registry: string,
  packageName: string,
  version: string,
  filename: string
): Promise<string | null> {
  if ((await getFile(registry, packageName, version, filename)) != null) {
    return filename;
  }

  if (path.posix.extname(filename) !== "") {
    return null;
  }

  for (let candidate of [`${filename}.js`, `${filename}.mjs`, `${filename}.cjs`, path.posix.join(filename, "index.js")]) {
    if ((await getFile(registry, packageName, version, candidate)) != null) {
      return candidate;
    }
  }

  return null;
}

export async function transformInlineEsmModule(registry: string, request: InlineTransformRequest): Promise<BuildResult> {
  if (isUnsupportedSourceFile(request.filename)) {
    throw new UnsupportedSourceTypeError(request.filename);
  }
  if (!isSupportedSourceFile(request.filename)) {
    throw new UnsupportedSourceTypeError(request.filename);
  }

  let transformed = await transformSource(request.source, request.filename, request.options);
  let rewritten = await rewriteEsmImports(transformed.code, registry, request.options.origin, {}, request.options);
  let buildKey = createInlineBuildKey(request);

  return {
    code: rewritten,
    headers: {
      "Cache-Control": moduleCacheControl,
      "Content-Type": "application/javascript; charset=utf-8",
      "X-UNPKG-Bundle-Mode": request.options.bundleMode,
      "X-UNPKG-Build-Key": buildKey,
      "X-UNPKG-Build-Input": request.filename,
      "X-UNPKG-Transformer": "esbuild",
    },
    metadata: {
      buildKey,
      input: request.filename,
      output: request.filename,
      packageName: "<inline>",
      target: request.options.target,
      version: "0.0.0",
    },
  };
}

export function normalizeBuildOptions(searchParams: URLSearchParams): NormalizedBuildOptions {
  return {
    aliases: parseAliases(searchParams.get("alias")),
    bundleMode: parseBundleMode(searchParams),
    conditions: parseConditions(searchParams),
    dependencyOverrides: parseDependencyOverrides(searchParams.get("deps")),
    env: searchParams.has("dev") || searchParams.get("env") === "development" ? "development" : "production",
    external: searchParams.get("external")?.split(",").filter(Boolean) ?? [],
    ignoreAnnotations: searchParams.has("ignore-annotations"),
    jsx: parseJsxMode(searchParams.get("jsx")),
    jsxImportSource: searchParams.get("jsxImportSource") ?? undefined,
    keepNames: searchParams.has("keep-names"),
    minify: searchParams.has("min"),
    origin: searchParams.get("origin") ?? defaultEsmOrigin,
    sourcemap: searchParams.has("sourcemap"),
    target: searchParams.get("target") ?? "es2022",
  };
}

export async function rewriteEsmImports(
  code: string,
  registry: string,
  origin: string,
  dependencies: Record<string, string>,
  options: NormalizedBuildOptions
): Promise<string> {
  let [imports] = parse(code);
  let rewrites: { start: number; end: number; value: string }[] = [];

  for (let imp of imports) {
    if (imp.n === undefined) {
      continue;
    }

    let specifier = code.slice(imp.s, imp.e);
    let rewriteValue: string;

    if (imp.t === 2) {
      let match = /^(["'])([^"']*)\1$/.exec(specifier);
      if (match === null) continue;

      rewriteValue = match[1] + await rewriteEsmSpecifier(match[2], registry, origin, dependencies, options) + match[1];
    } else {
      rewriteValue = await rewriteEsmSpecifier(specifier, registry, origin, dependencies, options);
    }

    if (rewriteValue !== specifier) {
      rewrites.push({ start: imp.s, end: imp.e, value: rewriteValue });
    }
  }

  rewrites.sort((a, b) => b.start - a.start);

  let result = code;
  for (let { start, end, value } of rewrites) {
    result = result.slice(0, start) + value + result.slice(end);
  }

  return result;
}

export async function bundleSource(
  packageDirectory: string,
  packageJson: PackageJson,
  packageName: string,
  version: string,
  filename: string,
  code: string,
  options: NormalizedBuildOptions
): Promise<{ code: string; map?: string }> {
  let result = await esbuild.build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify(options.env),
    },
    format: "esm",
    ignoreAnnotations: options.ignoreAnnotations,
    jsx: options.jsx === "automatic" ? "automatic" : "transform",
    jsxFactory: options.jsx === "preact" ? "h" : undefined,
    jsxFragment: options.jsx === "preact" ? "Fragment" : undefined,
    jsxImportSource: options.jsxImportSource,
    keepNames: options.keepNames,
    minify: options.minify,
    plugins: [createPackageInternalBundlePlugin(packageDirectory, packageJson, packageName, version, options)],
    sourcemap: options.sourcemap ? "inline" : false,
    stdin: {
      contents: code,
      loader: getEsbuildLoader(filename),
      resolveDir: path.posix.dirname(filename),
      sourcefile: filename,
    },
    platform: options.target === "node" ? "node" : "browser",
    target: getEsbuildTarget(options.target),
    write: false,
  });

  let output = result.outputFiles[0];
  if (output == null) {
    throw new Error(`No bundled output generated for ${packageName}@${version}${filename}`);
  }

  let entryExportNames = collectCommonJsExportNames(code);
  let commonJsExportNames = entryExportNames.length > 0 ? entryExportNames : collectCommonJsExportNames(output.text);

  return {
    code: addCommonJsNamedExports(output.text, commonJsExportNames),
  };
}

export function parseDependencyOverrides(value: string | null): Record<string, string> {
  let overrides: Record<string, string> = {};
  if (value == null || value === "") {
    return overrides;
  }

  for (let item of value.split(",")) {
    let parsed = parsePackageVersionPair(item);
    if (parsed != null) {
      overrides[parsed.packageName] = parsed.version;
    }
  }

  return overrides;
}

export function parseAliases(value: string | null): Record<string, string> {
  let aliases: Record<string, string> = {};
  if (value == null || value === "") {
    return aliases;
  }

  for (let item of value.split(",")) {
    let colonIndex = item.indexOf(":");
    if (colonIndex === -1) continue;

    let from = item.slice(0, colonIndex);
    let to = item.slice(colonIndex + 1);
    if (from !== "" && to !== "") {
      aliases[from] = to;
    }
  }

  return aliases;
}

export function createBuildKey(request: BuildRequest, resolvedFilename: string): string {
  let key = JSON.stringify({
    packageName: request.packageName,
    version: request.version,
    filename: request.filename ?? null,
    resolvedFilename,
    options: request.options,
    service: "esm-build-service-v1",
  });

  return createHash("sha256").update(key).digest("hex");
}

function createInlineBuildKey(request: InlineTransformRequest): string {
  let key = JSON.stringify({
    filename: request.filename,
    options: request.options,
    service: "esm-inline-transform-v1",
    source: request.source,
  });

  return createHash("sha256").update(key).digest("hex");
}

export function resolveBuildFilename(
  packageJson: PackageJson,
  filename: string | undefined,
  options: Pick<NormalizedBuildOptions, "conditions" | "env" | "target">
): string | null {
  if (filename != null && filename !== "/") {
    return (
      resolvePackageExport(packageJson as Parameters<typeof resolvePackageExport>[0], filename, {
        conditions: getBuildConditions(options),
        useBrowserField: !isRuntimeNativeTarget(options.target),
        useModuleField: packageJson.exports == null,
      }) ?? filename
    );
  }

  return (
    resolvePackageExport(packageJson as Parameters<typeof resolvePackageExport>[0], "/", {
      conditions: getBuildConditions(options),
      useBrowserField: !isRuntimeNativeTarget(options.target),
      useModuleField: packageJson.exports == null,
    }) ?? "/index.js"
  );
}

function parseConditions(searchParams: URLSearchParams): string[] {
  return searchParams.has("conditions")
    ? searchParams.getAll("conditions").flatMap((condition) => condition.split(",")).filter(Boolean)
    : [];
}

function getBuildConditions(options: Pick<NormalizedBuildOptions, "conditions" | "env" | "target">): string[] {
  let runtimeConditions = isRuntimeNativeTarget(options.target)
    ? [options.target === "denonext" ? "deno" : options.target]
    : ["browser"];
  let envConditions = options.env === "development" ? ["development"] : ["production"];
  let defaults = ["import", "module", "default"];
  let conditions = [...options.conditions, ...runtimeConditions, ...envConditions, ...defaults];

  return Array.from(new Set(conditions));
}

function isJavaScriptContentType(contentType: string): boolean {
  return contentType === "text/javascript" || contentType === "application/javascript";
}

function parseBundleMode(searchParams: URLSearchParams): NormalizedBuildOptions["bundleMode"] {
  if (searchParams.has("no-bundle") || searchParams.get("bundle") === "false") {
    return "none";
  }
  if (searchParams.has("standalone")) {
    return "standalone";
  }
  if (searchParams.has("bundle")) {
    return "bundle";
  }

  return "smart";
}

export async function transformSource(
  code: string,
  filename: string,
  options: NormalizedBuildOptions
): Promise<{ code: string; map?: string }> {
  if (hasDynamicRequire(code)) {
    throw new UnsupportedDynamicRequireError(filename);
  }

  let result = await esbuild.transform(code, {
    define: {
      "process.env.NODE_ENV": JSON.stringify(options.env),
    },
    format: "esm",
    ignoreAnnotations: options.ignoreAnnotations,
    jsx: options.jsx === "automatic" ? "automatic" : "transform",
    jsxFactory: options.jsx === "preact" ? "h" : undefined,
    jsxFragment: options.jsx === "preact" ? "Fragment" : undefined,
    jsxImportSource: options.jsxImportSource,
    keepNames: options.keepNames,
    loader: getEsbuildLoader(filename),
    minify: options.minify,
    sourcemap: options.sourcemap ? "inline" : false,
    sourcefile: filename,
    target: getEsbuildTarget(options.target),
  });

  return {
    code: addCommonJsNamedExports(result.code, collectCommonJsExportNames(code)),
    map: result.map,
  };
}

function getEsbuildLoader(filename: string): esbuild.Loader {
  if (filename.endsWith(".tsx")) return "tsx";
  if (filename.endsWith(".ts")) return "ts";
  if (filename.endsWith(".jsx")) return "jsx";
  if (filename.endsWith(".json")) return "json";
  return "js";
}

function hasDynamicRequire(code: string): boolean {
  return /\brequire\s*\(\s*[^"'`\s)]/.test(code);
}

function collectCommonJsExportNames(code: string): string[] {
  let names = new Set<string>();
  for (let match of code.matchAll(/\b(?:exports|module\.exports)\.([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(match[1]);
  }
  for (let objectBody of collectModuleExportsObjectBodies(code)) {
    for (let property of objectBody.matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?=\s*(?:[:,]|$))/g)) {
      names.add(property[1]);
    }
  }

  return Array.from(names).sort();
}

function collectModuleExportsObjectBodies(code: string): string[] {
  let bodies: string[] = [];
  let pattern = /\bmodule\.exports\s*=\s*{/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(code)) != null) {
    let objectStart = pattern.lastIndex - 1;
    let objectEnd = findMatchingBrace(code, objectStart);
    if (objectEnd !== -1) {
      bodies.push(code.slice(objectStart + 1, objectEnd));
      pattern.lastIndex = objectEnd + 1;
    }
  }

  return bodies;
}

function findMatchingBrace(code: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < code.length; index += 1) {
    let char = code[index];

    if (quote != null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function addCommonJsNamedExports(code: string, exportNames: string[]): string {
  if (exportNames.length === 0) {
    return code;
  }

  let match: RegExpExecArray | null = null;
  for (let candidate of code.matchAll(/export default (require_[\w$]+\(\));/g)) {
    match = candidate;
  }

  if (match == null) {
    return code;
  }

  let namedExports = exportNames.map((name) => `export const ${name} = __unpkg_cjs_default.${name};`).join("\n");
  return code.slice(0, match.index) + `var __unpkg_cjs_default = ${match[1]};\nexport { __unpkg_cjs_default as default };\n${namedExports}\n`;
}

function createPackageInternalBundlePlugin(
  packageDirectory: string,
  packageJson: PackageJson,
  packageName: string,
  version: string,
  options: NormalizedBuildOptions
): esbuild.Plugin {
  return {
    name: "unpkg-package-internal",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return null;
        }

        if (args.namespace === "unpkg-external-module") {
          return { path: args.path, external: true };
        }

        if (isUnsupportedSourceFile(args.path)) {
          return {
            path: args.path,
            namespace: "unpkg-empty-module",
          };
        }

        if (isBareSpecifier(args.path)) {
          let parsed = parseBareSpecifier(args.path);
          if (parsed?.packageName === packageName) {
            let selfReferencePath = parsed.path === "" ? "/" : parsed.path;
            let resolved = resolveBuildFilename(packageJson, selfReferencePath, options) ?? selfReferencePath;

            return {
              path: resolved,
              namespace: "unpkg-package",
            };
          }

          if (args.kind !== "require-call") {
            return { path: args.path, external: true };
          }

          return {
            path: args.path,
            namespace: "unpkg-external-module",
          };
        }

        if (isValidUrl(args.path)) {
          return { path: args.path, external: true };
        }

        let resolved = path.posix.normalize(path.posix.join(args.resolveDir || "/", args.path));
        if (!resolved.startsWith("/")) {
          resolved = `/${resolved}`;
        }

        return {
          path: resolved,
          namespace: "unpkg-package",
        };
      });

      build.onLoad({ filter: /.*/, namespace: "unpkg-package" }, async (args) => {
        let file = await getFirstExistingSourceFile(packageDirectory, args.path);
        if (file == null) {
          return {
            errors: [{ text: `File not found: ${args.path}` }],
          };
        }

        return {
          contents: new TextDecoder().decode(file.body),
          loader: getEsbuildLoader(file.path),
          resolveDir: path.posix.dirname(file.path),
        };
      });

      build.onLoad({ filter: /.*/, namespace: "unpkg-empty-module" }, () => ({
        contents: "",
        loader: "js",
      }));

      build.onLoad({ filter: /.*/, namespace: "unpkg-external-module" }, (args) => {
        let specifier = JSON.stringify(args.path);

        return {
          contents: [
            `import * as namespace from ${specifier};`,
            "module.exports = namespace.default ?? namespace;",
          ].join("\n"),
          loader: "js",
        };
      });
    },
  };
}

async function getFirstExistingSourceFile(
  packageDirectory: string,
  filename: string
): Promise<{ body: Uint8Array; path: string } | null> {
  for (let candidate of getSourceFileCandidates(filename)) {
    if (isSupportedSourceFile(candidate)) {
      let body = await readPackageFile(packageDirectory, candidate);
      if (body == null) continue;

      return {
        body,
        path: candidate,
      };
    }
  }

  return null;
}

async function readPackageFile(packageDirectory: string, filename: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path.join(packageDirectory, ...filename.replace(/^\/+/, "").split("/")));
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return null;
    }

    throw error;
  }
}

function getSourceFileCandidates(filename: string): string[] {
  if (/\.[cm]?[jt]sx?$/.test(filename)) {
    return [filename];
  }

  return [
    filename,
    `${filename}.js`,
    `${filename}.mjs`,
    `${filename}.jsx`,
    `${filename}.ts`,
    `${filename}.tsx`,
    `${stripTrailingSlash(filename)}/index.js`,
    `${stripTrailingSlash(filename)}/index.mjs`,
    `${stripTrailingSlash(filename)}/index.ts`,
    `${stripTrailingSlash(filename)}/index.tsx`,
  ];
}

function isSupportedSourceFile(filename: string): boolean {
  return /\.(?:[cm]?js|jsx|tsx?|json)$/.test(filename);
}

function isUnsupportedSourceFile(filename: string): boolean {
  return /\.(?:css|svelte|vue)$/.test(filename);
}

function getEsbuildTarget(target: string): esbuild.TransformOptions["target"] {
  if (target === "deno" || target === "denonext" || target === "node") {
    return "es2022";
  }

  return target as esbuild.TransformOptions["target"];
}

function isRuntimeNativeTarget(target: string): boolean {
  return target === "deno" || target === "denonext" || target === "node";
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
  return specifier.startsWith("node:") || specifier in browserBuiltinPolyfills || hardNodeBuiltins.has(specifier);
}

function parseJsxMode(value: string | null): NormalizedBuildOptions["jsx"] {
  if (value === "react" || value === "preact" || value === "automatic") {
    return value;
  }

  return undefined;
}

async function rewriteEsmSpecifier(
  specifier: string,
  registry: string,
  origin: string,
  dependencies: Record<string, string>,
  options: NormalizedBuildOptions
): Promise<string> {
  if (isRuntimeNativeTarget(options.target) && isNodeBuiltinSpecifier(specifier)) {
    return specifier;
  }

  if (specifier in browserBuiltinPolyfills) {
    return `${origin}/${browserBuiltinPolyfills[specifier]}`;
  }
  if (hardNodeBuiltins.has(specifier)) {
    throw new UnsupportedNodeBuiltinError(specifier);
  }

  if (specifier === "" || isValidUrl(specifier)) {
    return specifier;
  }

  if (isBareSpecifier(specifier)) {
    let parsed = parseBareSpecifier(specifier);
    if (parsed == null) return specifier;

    let aliased = applyAlias(parsed.packageName, parsed.path, options.aliases);
    if (shouldExternalize(aliased.packageName, options.external)) {
      return `${aliased.packageName}${aliased.path}`;
    }

    let requestedVersion =
      options.dependencyOverrides[aliased.packageName] ??
      dependencies[aliased.packageName] ??
      "latest";
    let version = await resolveDependencyVersion(registry, aliased.packageName, requestedVersion);
    let search = createDependencySearch(options);

    return `${origin}/${aliased.packageName}@${version}${stripTrailingSlash(aliased.path)}${search}`;
  }

  return `${stripTrailingSlash(specifier)}?target=${options.target}`;
}

function createDependencySearch(options: NormalizedBuildOptions): string {
  let searchParams = new URLSearchParams();
  if (options.env === "development") {
    searchParams.set("dev", "");
  }
  if (options.target !== "es2022") {
    searchParams.set("target", options.target);
  }
  if (options.conditions.length > 0) {
    searchParams.set("conditions", options.conditions.join(","));
  }
  if (options.bundleMode === "bundle") {
    searchParams.set("bundle", "");
  } else if (options.bundleMode === "standalone") {
    searchParams.set("standalone", "");
  }
  if (options.ignoreAnnotations) {
    searchParams.set("ignore-annotations", "");
  }
  if (options.keepNames) {
    searchParams.set("keep-names", "");
  }
  if (options.minify) {
    searchParams.set("min", "");
  }
  if (options.sourcemap) {
    searchParams.set("sourcemap", "");
  }
  if (options.external.length > 0) {
    searchParams.set("external", options.external.join(","));
  }

  let dependencyOverrides = Object.entries(options.dependencyOverrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([packageName, version]) => `${packageName}@${version}`);
  if (dependencyOverrides.length > 0) {
    searchParams.set("deps", dependencyOverrides.join(","));
  }

  let aliases = Object.entries(options.aliases)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([from, to]) => `${from}:${to}`);
  if (aliases.length > 0) {
    searchParams.set("alias", aliases.join(","));
  }

  let search = searchParams.toString();
  return search === "" ? "" : `?${search}`;
}

function shouldExternalize(packageName: string, external: string[]): boolean {
  return external.includes("*") || external.includes(packageName);
}

function applyAlias(
  packageName: string,
  path: string,
  aliases: Record<string, string>
): { packageName: string; path: string } {
  let alias = aliases[packageName];
  if (alias == null) {
    return { packageName, path };
  }

  let parsed = parseBareSpecifier(alias);
  if (parsed == null) {
    return { packageName, path };
  }

  return {
    packageName: parsed.packageName,
    path: parsed.path || path,
  };
}

async function resolveDependencyVersion(registry: string, packageName: string, versionRangeOrTag: string): Promise<string> {
  let response = await fetch(new URL(`/${packageName.toLowerCase()}`, registry), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    return versionRangeOrTag;
  }

  let packageInfo = await response.json() as PackageInfo;
  return resolvePackageVersion(packageInfo, versionRangeOrTag) ?? versionRangeOrTag;
}

function parsePackageVersionPair(value: string): { packageName: string; version: string } | null {
  let atIndex = value.startsWith("@") ? value.indexOf("@", 1) : value.indexOf("@");
  if (atIndex === -1) {
    return null;
  }

  let packageName = value.slice(0, atIndex);
  let version = value.slice(atIndex + 1);
  if (packageName === "" || version === "") {
    return null;
  }

  return { packageName, version };
}

function parseBareSpecifier(specifier: string): { packageName: string; path: string } | null {
  let match = /^((?:@[^/]+\/)?[^/]+)(\/.*)?$/.exec(specifier);
  if (match == null) {
    return null;
  }

  return {
    packageName: match[1],
    path: match[2] ?? "",
  };
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function isValidUrl(url: string): boolean {
  return URL.parse(url) !== null || url.startsWith("//");
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}
