import type { PackageJson, ExportConditions } from "./pkg-info.ts";

interface ResolvePackageExportOptions {
  conditions?: string[];
  useLegacyModuleField?: boolean;
  useLegacyBrowserField?: boolean;
}

export function resolvePackageExport(
  packageJson: PackageJson,
  filename: string, // The filename in the request URL, e.g. "/path/to/file"
  options?: ResolvePackageExportOptions,
): string | null {
  // entry is either "." or "./path"
  let entry = filename === "/" ? "." : `.${filename}`;

  if (
    entry === "." &&
    typeof packageJson.unpkg === "string" &&
    // If the request contains conditions, assume it wants to use
    // the "exports" field, not the "unpkg" field.
    options?.conditions == null
  ) {
    // "unpkg": "./dist/index.js"
    return pathToFilename(packageJson.unpkg);
  }

  if (entry === "." && typeof packageJson.exports === "string") {
    // "exports": "./dist/index.js"
    return pathToFilename(packageJson.exports);
  }

  if (typeof packageJson.exports === "object" && packageJson.exports != null) {
    let conditions = options?.conditions ?? ["unpkg", "default"];
    let resolved = resolveExportConditions(packageJson.exports, entry, conditions);

    if (resolved != null) {
      // "exports": { "default": "./dist/index.js" }
      // "exports": { ".": "./dist/index.js" }
      // "exports": { ".": { "default": "./dist/index.js" } }
      return pathToFilename(resolved);
    }
  }

  if (entry === "." && options?.useLegacyModuleField && typeof packageJson.module === "string") {
    // "module": "./dist/index.mjs"
    return pathToFilename(packageJson.module);
  }

  if (entry === "." && options?.useLegacyBrowserField) {
    if (typeof packageJson.browser === "string") {
      // "browser": "./dist/index.js"
      return pathToFilename(packageJson.browser);
    }

    if (typeof packageJson.browser === "object" && packageJson.browser != null) {
      for (let key in packageJson.browser) {
        if (entry === normalizeEntryPath(key)) {
          let value = packageJson.browser[key];

          if (typeof value === "string") {
            // "browser": { "./server/only.js": "./client/only.js" }
            return pathToFilename(value);
          }
        }
      }
    }
  }

  if (entry === "." && typeof packageJson.main === "string") {
    // "main": "./dist/index.js"
    return pathToFilename(packageJson.main);
  }

  return null;
}

function pathToFilename(path: string): string {
  return path.replace(/^\.?\/*/, "/");
}

function normalizeEntryPath(path: string): string {
  return path === "." || path === "./" ? "." : path.replace(/^\.?\/*/, "./");
}

/**
 * This is required to resolve nested conditions in the "exports" field. It traverses nested
 * conditions recursively and returns an array of all paths that match the conditions.
 *
 * let packageJson = {
 *   "exports": {
 *     ".": {
 *       "worker": {
 *         "default": "./dist/worker.js",
 *         "import": "./dist/worker.mjs",
 *         "require": "./dist/worker.cjs"
 *       }
 *     }
 *   }
 * };
 *
 * resolveExportConditions(packageJson.exports, ".", ["worker", "import"]);
 *   => "./dist/worker.mjs"
 */
export function resolveExportConditions(
  exportConditions: ExportConditions,
  entry: string,
  supportedConditions: string[],
): string | null {
  for (let key in exportConditions) {
    let value = exportConditions[key];

    if (isSubpath(key) ? entry === normalizeEntryPath(key) : supportedConditions.includes(key)) {
      return typeof value === "string"
        ? value
        : resolveExportConditions(value as ExportConditions, entry, supportedConditions);
    }
  }

  return null;
}

function isSubpath(path: string): boolean {
  return path.startsWith(".");
}
