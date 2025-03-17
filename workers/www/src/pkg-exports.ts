import type { PackageJson, ExportConditions } from "./pkg-info.ts";

interface ResolvePackageExportOptions {
  conditions?: string[];
  useLegacyModuleField?: boolean;
  useLegacyBrowserField?: boolean;
}

export function resolvePackageExport(
  packageJson: PackageJson,
  filename?: string, // e.g. "/path/to/file"
  options?: ResolvePackageExportOptions,
): string | null {
  // entry is either "." or "./path"
  let entry = filename == null || filename === "/" ? "." : `.${filename}`;

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

    for (let key in packageJson.exports) {
      if (entry === normalizeEntryPath(key)) {
        let value = packageJson.exports[key];

        if (typeof value === "string") {
          // "exports": { ".": "./dist/index.js" }
          return pathToFilename(value);
        }

        let resolved = resolveExportConditions(value, conditions);

        if (resolved.length > 0) {
          // "exports": { ".": { "default": "./dist/index.js" } }
          return pathToFilename(resolved[0]);
        }
      }
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
 * e.g.
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
 * resolveExportConditions(packageJson.exports['.'], ["worker", "import"]);
 *   => ["./dist/worker.mjs"]
 */
export function resolveExportConditions(conditionsMap: ExportConditions, conditions: string[]): string[] {
  let resolved: string[] = [];

  for (let condition in conditionsMap) {
    if (!conditions.includes(condition)) continue;

    let value = conditionsMap[condition];
    if (typeof value === "string") {
      resolved.push(value);
    } else {
      resolved.push(...resolveExportConditions(value, conditions));
    }
  }

  return resolved;
}
