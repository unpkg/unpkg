import type { PackageJson, ExportConditions } from "./npm-info.ts";

interface ResolvePackageExportOptions {
  conditions?: string[];
  useBrowserField?: boolean;
  useModuleField?: boolean;
}

export function resolvePackageExport(
  packageJson: PackageJson,
  filename: string, // The filename in the request URL, e.g. "/path/to/file"
  options?: ResolvePackageExportOptions
): string | null {
  // entry is either "." or "./path"
  let entry = filename === "/" ? "." : `.${filename}`;

  if (options?.useModuleField) {
    // "module": "./dist/index.mjs"
    if (typeof packageJson.module === "string" && entry === ".") {
      return pathToFilename(packageJson.module);
    }
  }

  if (options?.useBrowserField) {
    // "browser": "./dist/index.js"
    if (typeof packageJson.browser === "string" && entry === ".") {
      return pathToFilename(packageJson.browser);
    }

    // "browser": { "./server/only.js": "./client/only.js" }
    if (typeof packageJson.browser === "object" && packageJson.browser != null) {
      for (let key in packageJson.browser) {
        if (entry === normalizeEntryPath(key)) {
          let value = packageJson.browser[key];

          if (typeof value === "string") {
            return pathToFilename(value);
          }
        }
      }
    }
  }

  // "unpkg": "./dist/index.js"
  if (
    typeof packageJson.unpkg === "string" &&
    // If the request contains conditions, assume it wants to use
    // the "exports" field, not the "unpkg" field.
    options?.conditions == null &&
    entry === "."
  ) {
    return pathToFilename(packageJson.unpkg);
  }

  // "exports": "./dist/index.js"
  if (typeof packageJson.exports === "string" && entry === ".") {
    return pathToFilename(packageJson.exports);
  }

  // "exports": { ... }
  if (typeof packageJson.exports === "object" && packageJson.exports != null) {
    let conditions = options?.conditions ?? ["unpkg", "default"];
    let resolved = resolveExportConditions(packageJson.exports, entry, conditions);
    if (resolved != null) {
      return pathToFilename(resolved);
    }
  }

  // "main": "./dist/index.js"
  if (typeof packageJson.main === "string" && entry === ".") {
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
 * Resolves nested conditions in the "exports" field. It traverses nested conditions recursively
 * and returns the first path that matches the entry and/or conditions.
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
  exports: ExportConditions,
  entry: string,
  supportedConditions: string[]
): string | null {
  return _resolveExportConditions(exports, entry, supportedConditions, entry === ".");
}

function _resolveExportConditions(
  exports: ExportConditions,
  entry: string,
  supportedConditions: string[],
  entryWasFound: boolean
): string | null {
  for (let key in exports) {
    let value = exports[key];

    if (isSubpath(key)) {
      if (entry === normalizeEntryPath(key)) {
        if (typeof value === "string") {
          // "exports": { ".": "./dist/index.js" }
          return value;
        } else {
          // "exports": { ".": { ... } }
          return _resolveExportConditions(value, entry, supportedConditions, true);
        }
      }
    } else if (supportedConditions.includes(key)) {
      if (typeof value === "string") {
        // "exports": { "import": "./dist/index.mjs" }
        if (entryWasFound) return value;
      } else {
        // "exports": { "import": { ... } }
        let resolved = _resolveExportConditions(value, entry, supportedConditions, entryWasFound);
        if (resolved != null) {
          return resolved;
        }
      }
    }
  }

  return null;
}

function isSubpath(path: string): boolean {
  return path.startsWith(".");
}
