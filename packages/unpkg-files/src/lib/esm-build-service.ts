import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseCommonJs } from "@esm.sh/cjs-module-lexer";
import * as esbuild from "esbuild";
import { parse } from "es-module-lexer/js";
import * as semver from "semver";
import {
  normalizeSearchParams,
  resolvePackageExportResult,
  resolvePackageVersion,
} from "unpkg-worker";
import type { PackageInfo, PackageJson as WorkerPackageJson } from "unpkg-worker";

import { withPackageFileDirectory } from "./npm-files.ts";

const defaultEsmOrigin = "https://esm.unpkg.com";
const moduleCacheControl = "public, max-age=60, s-maxage=300";
// Build artifacts are only served at exact-version canonical URLs, so they can
// be cached like immutable content.
const immutableCacheControl = "public, max-age=31536000, immutable";
// The @jspm/core major used for Node builtin polyfills. Emitted URLs pin the
// resolved exact version; this range is the fallback when resolution fails.
const jspmCorePolyfillRange = "2";
// Node builtins with a browser implementation in @jspm/core. The bare subpath
// (without /browser/) resolves through @jspm/core's own exports map, which picks
// the browser variant via the default condition. inspector maps to an empty stub.
const polyfilledNodeBuiltins = [
  "assert",
  "assert/strict",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "dns/promises",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "inspector/promises",
  "module",
  "net",
  "os",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "sys",
  "timers",
  "timers/promises",
  "tls",
  "tty",
  "url",
  "util",
  "util/types",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];
// Maps builtin specifiers (bare and node:-prefixed) to their @jspm/core nodelibs
// subpath. A Map avoids Object.prototype key collisions for specifiers like
// "constructor" that are real npm package names.
const browserBuiltinPolyfills = new Map<string, string>(
  polyfilledNodeBuiltins.flatMap((builtin): [string, string][] => [
    [builtin, builtin],
    [`node:${builtin}`, builtin],
  ])
);
// Builtins with no browser implementation; also requireable without the node:
// prefix. These (and unknown node:* specifiers) map to @jspm/core's empty-module
// stub so packages that merely probe for them still build and run.
const unpolyfilledNodeBuiltins = new Set(["readline/promises", "trace_events"]);

export interface BuildRequest {
  packageName: string;
  version: string;
  filename?: string;
  options: NormalizedBuildOptions;
}

export interface NormalizedBuildOptions {
  aliases: Record<string, string>;
  conditions: string[];
  dependencyOverrides: Record<string, string>;
  env: "development" | "production";
  exportNames: string[];
  external: string[];
  jsx?: "react" | "preact" | "automatic";
  jsxImportSource?: string;
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
  browser?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  exports?: string | null | Record<string, unknown>;
  main?: string;
  module?: string;
  name?: string;
  peerDependencies?: Record<string, string>;
  version?: string;
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
  // Extract the tarball once and serve every read from the extracted directory;
  // each getFile call would otherwise be a fresh tarball download.
  return withPackageFileDirectory(registry, request.packageName, request.version, async (packageDirectory) => {
    let packageJsonBody = await readPackageFile(packageDirectory, "/package.json");
    if (packageJsonBody == null) {
      return null;
    }

    let packageJson = JSON.parse(new TextDecoder().decode(packageJsonBody)) as PackageJson;
    let resolvedFilename = resolveBuildFilename(packageJson, request.filename, request.options);
    if (resolvedFilename == null) {
      return null;
    }
    if (isUnsupportedSourceFile(resolvedFilename)) {
      throw new UnsupportedSourceTypeError(resolvedFilename);
    }

    let file = await getFirstExistingSourceFile(packageDirectory, resolvedFilename);
    if (file == null) {
      return null;
    }

    let filename = file.path;
    let code = new TextDecoder().decode(file.body);
    // Bare self-references stay external in the bundle; pin them to the version
    // being built so every subpath shares one module instance.
    let deps = Object.assign({}, packageJson.peerDependencies, packageJson.dependencies, {
      [request.packageName]: request.version,
    });
    let transformed = await bundleSource(
      packageDirectory,
      packageJson,
      request.packageName,
      request.version,
      filename,
      code,
      request.options
    );
    let diagnostics: RewriteDiagnostics = { unpinnedSpecifiers: [] };
    let rewritten = await rewriteEsmImports(
      transformed.code,
      registry,
      request.options.origin,
      deps,
      request.options,
      diagnostics
    );
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
        // Artifacts whose dependency URLs could not all be pinned to exact
        // versions (e.g. a transient registry failure) stay short-lived so
        // they heal; fully-pinned artifacts are immutable.
        "Cache-Control": diagnostics.unpinnedSpecifiers.length > 0 ? moduleCacheControl : immutableCacheControl,
        "Content-Type": "application/javascript; charset=utf-8",
        "X-UNPKG-Build-Key": buildKey,
        "X-UNPKG-Build-Input": filename,
        "X-UNPKG-Transformer": "esbuild",
      },
      metadata,
    };
  });
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
    conditions: parseConditions(searchParams),
    dependencyOverrides: parseDependencyOverrides(searchParams.get("deps")),
    env: searchParams.has("dev") || searchParams.get("env") === "development" ? "development" : "production",
    exportNames: parseSelectedExports(searchParams.get("exports")),
    external: searchParams.get("external")?.split(",").filter(Boolean) ?? [],
    jsx: parseJsxMode(searchParams.get("jsx")),
    jsxImportSource: searchParams.get("jsxImportSource") ?? undefined,
    minify: searchParams.has("min"),
    origin: searchParams.get("origin") ?? defaultEsmOrigin,
    sourcemap: searchParams.has("sourcemap"),
    target: parseBuildTarget(searchParams.get("target")),
  };
}

const buildTargets = new Set([
  "es2015",
  "es2016",
  "es2017",
  "es2018",
  "es2019",
  "es2020",
  "es2021",
  "es2022",
  "es2023",
  "es2024",
  "esnext",
  "deno",
  "node",
]);

function parseBuildTarget(target: string | null): string {
  // The edge worker validates targets for public URLs; this guards direct
  // requests so an unknown target degrades instead of crashing esbuild.
  return target != null && buildTargets.has(target) ? target : "es2022";
}

export interface RewriteDiagnostics {
  // Bare specifiers whose emitted URL could not be pinned to an exact version
  // (registry failure or an unresolvable range); such builds must not be
  // cached as immutable.
  unpinnedSpecifiers: string[];
}

export async function rewriteEsmImports(
  code: string,
  registry: string,
  origin: string,
  dependencies: Record<string, string>,
  options: NormalizedBuildOptions,
  diagnostics?: RewriteDiagnostics
): Promise<string> {
  let [imports] = parse(code);
  let rewrites = (
    await Promise.all(
      imports.map(async (imp): Promise<{ start: number; end: number; value: string } | null> => {
        if (imp.n === undefined) {
          return null;
        }

        let specifier = code.slice(imp.s, imp.e);
        let rewriteValue: string;

        if (imp.t === 2) {
          let match = /^(["'])([^"']*)\1$/.exec(specifier);
          if (match === null) return null;

          rewriteValue =
            match[1] + (await rewriteEsmSpecifier(match[2], registry, origin, dependencies, options, diagnostics)) + match[1];
        } else {
          rewriteValue = await rewriteEsmSpecifier(specifier, registry, origin, dependencies, options, diagnostics);
        }

        return rewriteValue === specifier ? null : { start: imp.s, end: imp.e, value: rewriteValue };
      })
    )
  ).filter((rewrite): rewrite is NonNullable<typeof rewrite> => rewrite != null);

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
  let commonJsAnalysis = await analyzeCommonJsExports(packageDirectory, filename, code, options);
  let isCommonJsEntry =
    !hasEsmExports(filename, code) &&
    (commonJsAnalysis.exports.length > 0 || commonJsAnalysis.externalReexports.length > 0);
  let selectEsmExports =
    options.exportNames.length > 0 && !isCommonJsEntry && hasEsmExports(filename, code);
  let stdin: esbuild.StdinOptions;
  if (isCommonJsEntry) {
    stdin = {
      contents: createCommonJsInteropEntry(filename, commonJsAnalysis, options.exportNames),
      loader: "js" as const,
      resolveDir: "/",
      sourcefile: "/__unpkg_cjs_interop__.js",
    };
  } else if (selectEsmExports) {
    stdin = {
      contents: `export { ${options.exportNames.join(", ")} } from ${JSON.stringify(filename)};`,
      loader: "js" as const,
      resolveDir: "/",
      sourcefile: "/__unpkg_selected_exports__.js",
    };
  } else {
    stdin = {
      contents: code,
      loader: getEsbuildLoader(filename),
      resolveDir: path.posix.dirname(filename),
      sourcefile: filename,
    };
  }
  let result = await esbuild.build({
    bundle: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify(options.env),
    },
    format: "esm",
    jsx: options.jsx === "automatic" ? "automatic" : "transform",
    jsxFactory: options.jsx === "preact" ? "h" : undefined,
    jsxFragment: options.jsx === "preact" ? "Fragment" : undefined,
    jsxImportSource: options.jsxImportSource,
    minify: options.minify,
    plugins: [
      createPackageInternalBundlePlugin(packageDirectory, packageJson, packageName, options, {
        code,
        filename,
      }),
    ],
    sourcemap: options.sourcemap ? "inline" : false,
    stdin,
    platform: options.target === "node" ? "node" : "browser",
    target: getEsbuildTarget(options.target),
    write: false,
  });

  let output = result.outputFiles[0];
  if (output == null) {
    throw new Error(`No bundled output generated for ${packageName}@${version}${filename}`);
  }

  return {
    code: output.text,
  };
}

/**
 * Builds a synthetic ESM entry module for a CommonJS entry file. esbuild's CommonJS
 * interop then produces the default export (unwrapping `exports.default` for
 * `__esModule` modules), and the named exports are real ESM exports of the bundle,
 * so they survive minification and keep sourcemaps intact. Reexports of other
 * packages become `export * from` statements that resolve at runtime.
 */
function createCommonJsInteropEntry(
  filename: string,
  analysis: CommonJsExportAnalysis,
  selectedExportNames: string[]
): string {
  let names = (selectedExportNames.length > 0 ? selectedExportNames : analysis.exports).filter(
    (name) => name !== "default" && name !== "__unpkg_cjs_default__" && isSafeExportName(name)
  );
  let source = JSON.stringify(filename);
  let lines = [
    names.length > 0
      ? `import __unpkg_cjs_default__, { ${names.join(", ")} } from ${source};`
      : `import __unpkg_cjs_default__ from ${source};`,
    "export default __unpkg_cjs_default__;",
  ];
  if (names.length > 0) {
    lines.push(`export { ${names.join(", ")} };`);
  }
  if (selectedExportNames.length === 0) {
    for (let specifier of analysis.externalReexports) {
      lines.push(`export * from ${JSON.stringify(specifier)};`);
    }
  }

  return lines.join("\n") + "\n";
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

export function parseSelectedExports(value: string | null): string[] {
  if (value == null || value === "") {
    return [];
  }

  let names = value
    .split(",")
    .map((name) => name.trim())
    .filter(isSelectableExportName);
  return Array.from(new Set(names)).sort();
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
    let resolution = resolvePackageExportResult(packageJson as WorkerPackageJson, filename, {
      conditions: getBuildConditions(options),
      useBrowserField: !isRuntimeNativeTarget(options.target),
      useModuleField: packageJson.exports === undefined,
    });
    if (resolution.status === "blocked") return null;
    return resolution.status === "resolved" ? resolution.filename : filename;
  }

  let resolution = resolvePackageExportResult(packageJson as WorkerPackageJson, "/", {
    conditions: getBuildConditions(options),
    useBrowserField: !isRuntimeNativeTarget(options.target),
    useModuleField: packageJson.exports === undefined,
  });
  if (resolution.status === "blocked") return null;
  return resolution.status === "resolved" ? resolution.filename : "/index.js";
}

function parseConditions(searchParams: URLSearchParams): string[] {
  return searchParams.has("conditions")
    ? searchParams.getAll("conditions").flatMap((condition) => condition.split(",")).filter(Boolean)
    : [];
}

function getBuildConditions(options: Pick<NormalizedBuildOptions, "conditions" | "env" | "target">): string[] {
  let runtimeConditions = isRuntimeNativeTarget(options.target)
    ? [options.target]
    : ["browser"];
  let envConditions = options.env === "development" ? ["development"] : ["production"];
  let defaults = ["import", "module", "default"];
  let conditions = [...options.conditions, ...runtimeConditions, ...envConditions, ...defaults];

  return Array.from(new Set(conditions));
}

function isJavaScriptContentType(contentType: string): boolean {
  return contentType === "text/javascript" || contentType === "application/javascript";
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
    jsx: options.jsx === "automatic" ? "automatic" : "transform",
    jsxFactory: options.jsx === "preact" ? "h" : undefined,
    jsxFragment: options.jsx === "preact" ? "Fragment" : undefined,
    jsxImportSource: options.jsxImportSource,
    loader: getEsbuildLoader(filename),
    minify: options.minify,
    sourcemap: options.sourcemap ? "inline" : false,
    sourcefile: filename,
    target: getEsbuildTarget(options.target),
  });

  return {
    code: addCommonJsNamedExports(result.code, analyzeCommonJsSource(filename, code, options.env).exports),
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

interface CommonJsAnalysis {
  exports: string[];
  reexports: string[];
}

const reservedExportNames = new Set([
  // eval and arguments are not reserved words but cannot be import bindings.
  "arguments",
  "eval",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

export function analyzeCommonJsSource(
  filename: string,
  code: string,
  nodeEnv: NormalizedBuildOptions["env"],
  callMode = false
): CommonJsAnalysis {
  try {
    let result = parseCommonJs(filename, code, { callMode, nodeEnv });
    return {
      exports: result.exports.filter(isSafeExportName),
      reexports: result.reexports,
    };
  } catch {
    return { exports: [], reexports: [] };
  }
}

export interface CommonJsExportAnalysis {
  exports: string[];
  externalReexports: string[];
}

export async function analyzeCommonJsExports(
  packageDirectory: string,
  filename: string,
  code: string,
  options: NormalizedBuildOptions
): Promise<CommonJsExportAnalysis> {
  let exportNames = new Set<string>();
  let externalReexports = new Set<string>();
  let pending = [{ callMode: false, code, filename }];
  let visited = new Set<string>();

  while (pending.length > 0) {
    let current = pending.pop();
    if (current == null) continue;

    let visitKey = `${current.filename}\0${current.callMode}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    if (current.filename.endsWith(".json")) {
      for (let name of readJsonExportNames(current.code)) {
        exportNames.add(name);
      }
      continue;
    }

    let analysis = analyzeCommonJsSource(current.filename, current.code, options.env, current.callMode);
    for (let name of analysis.exports) {
      exportNames.add(name);
    }

    for (let reexport of analysis.reexports) {
      let callMode = reexport.endsWith("()");
      let specifier = callMode ? reexport.slice(0, -2) : reexport;

      if (!specifier.startsWith(".")) {
        // A reexport of another package (or a Node builtin). Its export names are not
        // statically known here; surface it so the build can emit `export * from` and
        // let the rewritten module URL provide the names at runtime.
        if (!callMode) {
          externalReexports.add(specifier);
        }
        continue;
      }

      let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(current.filename), specifier));
      if (!resolved.startsWith("/")) {
        resolved = `/${resolved}`;
      }

      let file = await getFirstExistingSourceFile(packageDirectory, resolved);
      if (file != null) {
        pending.push({
          callMode,
          code: new TextDecoder().decode(file.body),
          filename: file.path,
        });
      }
    }
  }

  return {
    exports: Array.from(exportNames).sort(),
    externalReexports: Array.from(externalReexports).sort(),
  };
}

function readJsonExportNames(code: string): string[] {
  try {
    let value = JSON.parse(code) as unknown;
    if (typeof value !== "object" || value == null || Array.isArray(value)) {
      return [];
    }

    return Object.keys(value).filter(isSafeExportName);
  } catch {
    return [];
  }
}

function isSafeExportName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !reservedExportNames.has(name);
}

function isSelectableExportName(name: string): boolean {
  return name === "default" || isSafeExportName(name);
}

function hasEsmExports(filename: string, code: string): boolean {
  if (filename.endsWith(".mjs") || filename.endsWith(".mts")) {
    return true;
  }

  try {
    let [, exports] = parse(code);
    return exports.length > 0;
  } catch {
    return false;
  }
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

  let namedExportDeclarations = exportNames
    .map((name, index) => `const __unpkg_cjs_export_${index} = __unpkg_cjs_default[${JSON.stringify(name)}];`)
    .join("\n");
  let namedExportSpecifiers = exportNames.map((name, index) => `__unpkg_cjs_export_${index} as ${name}`).join(", ");
  return (
    code.slice(0, match.index) +
    `var __unpkg_cjs_default = ${match[1]};\n${namedExportDeclarations}\nexport { __unpkg_cjs_default as default, ${namedExportSpecifiers} };\n` +
    code.slice(match.index + match[0].length)
  );
}

function createPackageInternalBundlePlugin(
  packageDirectory: string,
  packageJson: PackageJson,
  packageName: string,
  options: NormalizedBuildOptions,
  entry?: { code: string; filename: string }
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
            let resolved = resolveBuildFilename(packageJson, selfReferencePath, options);
            if (resolved == null) {
              return {
                errors: [{ text: `Package subpath "${selfReferencePath}" is blocked by its exports map` }],
              };
            }

            // A self-reference that resolves back to the entry being built must
            // be bundled — externalizing it would make the module import its
            // own URL mid-evaluation.
            if (
              entry != null &&
              (resolved === entry.filename || getSourceFileCandidates(resolved).includes(entry.filename))
            ) {
              return {
                path: entry.filename,
                namespace: "unpkg-package",
              };
            }
          }

          // Other bare specifiers (dependencies and cross-subpath
          // self-references) stay external so every module URL is shared: a
          // bundled private copy would duplicate module state (e.g.
          // preact/hooks bundling its own preact core).
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
        if (entry != null && args.path === entry.filename) {
          return {
            contents: entry.code,
            loader: getEsbuildLoader(entry.filename),
            resolveDir: path.posix.dirname(entry.filename),
          };
        }

        let file = await getFirstExistingSourceFile(packageDirectory, args.path);
        if (file == null) {
          return {
            errors: [{ text: `File not found: ${args.path}` }],
          };
        }

        // An extensionless spelling of the entry (e.g. require('./index') for
        // the /index.js entry) resolves here; serve the in-memory entry code so
        // both spellings carry identical content.
        if (entry != null && file.path === entry.filename) {
          return {
            contents: entry.code,
            loader: getEsbuildLoader(entry.filename),
            resolveDir: path.posix.dirname(entry.filename),
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
            // For __esModule modules the built artifact's default export is the
            // unwrapped exports.default, so the namespace (named exports plus
            // default) is the closest shape to the original module.exports;
            // otherwise the default export IS module.exports.
            "module.exports = namespace.__esModule ? namespace : namespace.default ?? namespace;",
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
    `${filename}.cjs`,
    `${filename}.jsx`,
    `${filename}.ts`,
    `${filename}.tsx`,
    `${filename}.json`,
    `${stripTrailingSlash(filename)}/index.js`,
    `${stripTrailingSlash(filename)}/index.mjs`,
    `${stripTrailingSlash(filename)}/index.cjs`,
    `${stripTrailingSlash(filename)}/index.ts`,
    `${stripTrailingSlash(filename)}/index.tsx`,
    `${stripTrailingSlash(filename)}/index.json`,
  ];
}

function isSupportedSourceFile(filename: string): boolean {
  return /\.(?:[cm]?js|jsx|tsx?|json)$/.test(filename);
}

function isUnsupportedSourceFile(filename: string): boolean {
  return /\.(?:css|svelte|vue)$/.test(filename);
}

function getEsbuildTarget(target: string): esbuild.TransformOptions["target"] {
  if (target === "deno" || target === "node") {
    return "es2022";
  }

  return target as esbuild.TransformOptions["target"];
}

function isRuntimeNativeTarget(target: string): boolean {
  return target === "deno" || target === "node";
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
  return specifier.startsWith("node:") || browserBuiltinPolyfills.has(specifier) || unpolyfilledNodeBuiltins.has(specifier);
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
  options: NormalizedBuildOptions,
  diagnostics?: RewriteDiagnostics
): Promise<string> {
  if (isRuntimeNativeTarget(options.target) && isNodeBuiltinSpecifier(specifier)) {
    return specifier;
  }

  if (isNodeBuiltinSpecifier(specifier)) {
    // Builtins without a browser implementation (and unknown node:* specifiers)
    // map to @jspm/core's empty-module stub so packages that merely probe for
    // them still build; passing them through would reach the browser as an
    // unresolvable specifier.
    let polyfillSubpath = browserBuiltinPolyfills.get(specifier) ?? "@empty";
    // Pin the polyfill package so builds are deterministic and the emitted URL
    // is canonical (no version-resolution redirect on every polyfill import).
    let polyfillVersion = await resolveDependencyVersion(registry, "@jspm/core", jspmCorePolyfillRange);
    if (semver.valid(polyfillVersion) == null) {
      diagnostics?.unpinnedSpecifiers.push(specifier);
    }

    return `${origin}/@jspm/core@${polyfillVersion}/nodelibs/${polyfillSubpath}?target=${options.target}`;
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
      getOwnProperty(options.dependencyOverrides, aliased.packageName) ??
      getOwnProperty(dependencies, aliased.packageName) ??
      "latest";
    let dependency = parseDependencyVersionSpecifier(aliased.packageName, requestedVersion);
    let version = await resolveDependencyVersion(registry, dependency.packageName, dependency.versionRangeOrTag);
    if (semver.valid(version) == null) {
      diagnostics?.unpinnedSpecifiers.push(specifier);
    }

    let search = createDependencySearch(options);

    return `${origin}/${dependency.packageName}@${version}${stripTrailingSlash(aliased.path)}${search}`;
  }

  return `${stripTrailingSlash(specifier)}?target=${options.target}`;
}

function createDependencySearch(options: NormalizedBuildOptions): string {
  let searchParams = new URLSearchParams();
  if (options.env === "development") {
    searchParams.set("dev", "");
  }
  // Always include the target so the emitted URL is already canonical; a URL
  // without it would redirect on every dependency import.
  searchParams.set("target", options.target);
  if (options.conditions.length > 0) {
    searchParams.set("conditions", options.conditions.join(","));
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

  // Render in the exact canonical order the esm worker normalizes to, so the
  // emitted URL never redirects.
  return normalizeSearchParams(searchParams);
}

function shouldExternalize(packageName: string, external: string[]): boolean {
  return external.includes("*") || external.includes(packageName);
}

// Package names come from arbitrary code, so record lookups must never see
// inherited Object.prototype members (e.g. a dependency named "constructor").
function getOwnProperty(record: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function applyAlias(
  packageName: string,
  path: string,
  aliases: Record<string, string>
): { packageName: string; path: string } {
  let alias = getOwnProperty(aliases, packageName);
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

/**
 * Interprets the version field of a dependency entry. Handles npm: aliases
 * ("npm:string-width@^4.2.0" installs a different package under this name),
 * workspace: protocol ranges, and git/URL specifiers that have no registry
 * version to resolve (those fall back to the latest published version).
 */
function parseDependencyVersionSpecifier(
  packageName: string,
  requestedVersion: string
): { packageName: string; versionRangeOrTag: string } {
  if (requestedVersion.startsWith("npm:")) {
    let aliasTarget = parsePackageVersionPair(requestedVersion.slice(4));
    if (aliasTarget != null) {
      return { packageName: aliasTarget.packageName, versionRangeOrTag: aliasTarget.version };
    }

    let aliasName = requestedVersion.slice(4);
    return { packageName: aliasName === "" ? packageName : aliasName, versionRangeOrTag: "latest" };
  }

  if (requestedVersion.startsWith("workspace:")) {
    let range = requestedVersion.slice("workspace:".length);
    let isBareProtocol = range === "" || range === "*" || range === "^" || range === "~";
    return { packageName, versionRangeOrTag: isBareProtocol ? "latest" : range };
  }

  // git/GitHub/tarball-URL/file specifiers have no registry range; slashes and
  // colons never appear in valid semver ranges or dist-tags.
  if (requestedVersion.includes("/") || requestedVersion.includes(":")) {
    return { packageName, versionRangeOrTag: "latest" };
  }

  return { packageName, versionRangeOrTag: requestedVersion };
}

export function clearPackageInfoCache(): void {
  packageInfoCache.clear();
}

const packageInfoTtlMs = 5 * 60 * 1000;
const packageInfoCacheMaxEntries = 500;
let packageInfoCache = new Map<string, { expiresAt: number; promise: Promise<PackageInfo | null> }>();

function getCachedPackageInfo(registry: string, packageName: string): Promise<PackageInfo | null> {
  let key = `${registry}/${packageName}`;
  let cached = packageInfoCache.get(key);
  if (cached != null && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  // Failure cleanup must only evict its own entry — by the time a stale fetch
  // settles, a fresh entry may already occupy the key.
  let evictOwnEntry = () => {
    if (packageInfoCache.get(key) === entry) {
      packageInfoCache.delete(key);
    }
  };
  let entry = {
    expiresAt: Date.now() + packageInfoTtlMs,
    promise: (async (): Promise<PackageInfo | null> => {
      // The abbreviated packument has dist-tags plus version keys — everything
      // version resolution needs — at a fraction of the full document's size.
      let response = await fetch(new URL(`/${packageName}`, registry), {
        headers: { Accept: "application/vnd.npm.install-v1+json" },
      });
      if (!response.ok) {
        // Don't cache failures; a transient registry error should not stick.
        evictOwnEntry();
        return null;
      }

      return (await response.json()) as PackageInfo;
    })(),
  };
  entry.promise.catch(evictOwnEntry);

  if (packageInfoCache.size >= packageInfoCacheMaxEntries) {
    let now = Date.now();
    for (let [entryKey, existing] of packageInfoCache) {
      if (existing.expiresAt <= now) packageInfoCache.delete(entryKey);
    }
    // Maps iterate in insertion order; evict oldest-inserted entries rather
    // than dropping the whole (mostly hot) cache.
    for (let entryKey of packageInfoCache.keys()) {
      if (packageInfoCache.size < packageInfoCacheMaxEntries) break;
      packageInfoCache.delete(entryKey);
    }
  }
  packageInfoCache.set(key, entry);

  return entry.promise;
}

async function resolveDependencyVersion(registry: string, packageName: string, versionRangeOrTag: string): Promise<string> {
  // Exact versions (including pinned self-references) need no registry lookup.
  // semver.valid returns the cleaned form (strips a leading v, whitespace).
  let exactVersion = semver.valid(versionRangeOrTag);
  if (exactVersion != null) {
    return exactVersion;
  }

  // A resolution failure degrades to the raw range (the caller marks the build
  // as unpinned); it must never fail the whole build. Dependency names in
  // published package.json files already carry the registry's canonical case,
  // so there is no lowercase fallback here — falling back on a transient error
  // could pin an unrelated same-named package's version.
  let packageInfo: PackageInfo | null = null;
  try {
    packageInfo = await getCachedPackageInfo(registry, packageName);
  } catch {
    return versionRangeOrTag;
  }
  if (packageInfo == null) {
    return versionRangeOrTag;
  }

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
