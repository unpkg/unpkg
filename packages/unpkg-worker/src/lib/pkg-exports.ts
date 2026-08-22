import type { PackageJson, ExportConditions } from "./npm-info.ts";

interface ResolvePackageExportOptions {
  conditions?: string[];
  useBrowserField?: boolean;
  useModuleField?: boolean;
}

export type PackageExportResolution =
  | { status: "resolved"; filename: string }
  | { status: "blocked" }
  | { status: "not-found" };

export function resolvePackageExport(
  packageJson: PackageJson,
  filename: string, // The filename in the request URL, e.g. "/path/to/file"
  options?: ResolvePackageExportOptions
): string | null {
  let resolution = resolvePackageExportResult(packageJson, filename, options);
  return resolution.status === "resolved" ? resolution.filename : null;
}

/**
 * Resolves a package export while preserving the distinction between an export
 * that is explicitly blocked by a null target and one that was not found.
 */
export function resolvePackageExportResult(
  packageJson: PackageJson,
  filename: string,
  options?: ResolvePackageExportOptions
): PackageExportResolution {
  // entry is either "." or "./path"
  let entry = filename === "/" ? "." : `.${filename}`;

  if (options?.useModuleField) {
    // "module": "./dist/index.mjs"
    if (typeof packageJson.module === "string" && entry === ".") {
      return resolved(pathToFilename(packageJson.module));
    }
  }

  if (options?.useBrowserField) {
    // "browser": "./dist/index.js"
    if (typeof packageJson.browser === "string" && entry === ".") {
      return resolved(pathToFilename(packageJson.browser));
    }

    // "browser": { "./server/only.js": "./client/only.js" }
    if (typeof packageJson.browser === "object" && packageJson.browser != null) {
      for (let key in packageJson.browser) {
        if (entry === normalizeEntryPath(key)) {
          let value = packageJson.browser[key];

          if (typeof value === "string") {
            return resolved(pathToFilename(value));
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
    return resolved(pathToFilename(packageJson.unpkg));
  }

  if (packageJson.exports === null) {
    return { status: "blocked" };
  }

  // "exports": "./dist/index.js"
  if (typeof packageJson.exports === "string" && entry === ".") {
    return resolved(pathToFilename(packageJson.exports));
  }

  // "exports": { ... }
  if (typeof packageJson.exports === "object" && packageJson.exports != null) {
    let conditions = options?.conditions ?? ["unpkg", "default"];
    let target = _resolveExportConditions(packageJson.exports, entry, conditions, entry === ".", null);
    if (target === null) {
      return { status: "blocked" };
    }
    if (target !== undefined) {
      return resolved(pathToFilename(target));
    }
  }

  // "main": "./dist/index.js"
  if (typeof packageJson.main === "string" && entry === ".") {
    return resolved(pathToFilename(packageJson.main));
  }

  return { status: "not-found" };
}

function resolved(filename: string): PackageExportResolution {
  return { status: "resolved", filename };
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
  return _resolveExportConditions(exports, entry, supportedConditions, entry === ".", null) ?? null;
}

function _resolveExportConditions(
  exports: ExportConditions,
  entry: string,
  supportedConditions: string[],
  entryWasFound: boolean,
  wildcardMatch: string | null
): string | null | undefined {
  for (let key in exports) {
    if (!isSubpath(key) || entry !== normalizeEntryPath(key)) continue;

    let value = exports[key];
    if (value === null) {
      return null;
    }
    if (typeof value === "string") {
      return applyWildcardMatch(value, wildcardMatch);
    }

    return _resolveExportConditions(value, entry, supportedConditions, true, wildcardMatch);
  }

  let wildcardEntries = Object.entries(exports)
    .filter(([key]) => isSubpath(key) && key.includes("*"))
    .map(([key, value]) => {
      let match = matchWildcardExport(normalizeEntryPath(key), entry);
      return match == null ? null : { key, match, value };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate != null)
    .sort((left, right) => wildcardSpecificity(right.key) - wildcardSpecificity(left.key));

  for (let { match, value } of wildcardEntries) {
    if (value === null) {
      return null;
    }
    if (typeof value === "string") {
      return applyWildcardMatch(value, match);
    }

    let resolved = _resolveExportConditions(value, entry, supportedConditions, true, match);
    if (resolved !== undefined) {
      return resolved;
    }
  }

  for (let key in exports) {
    let value = exports[key];

    if (!isSubpath(key) && supportedConditions.includes(key)) {
      if (value === null) {
        if (entryWasFound) return null;
      } else if (typeof value === "string") {
        if (entryWasFound) return applyWildcardMatch(value, wildcardMatch);
      } else {
        let resolved = _resolveExportConditions(value, entry, supportedConditions, entryWasFound, wildcardMatch);
        if (resolved !== undefined) {
          return resolved;
        }
      }
    }
  }

  return undefined;
}

function matchWildcardExport(pattern: string, entry: string): string | null {
  let wildcardIndex = pattern.indexOf("*");
  let prefix = pattern.slice(0, wildcardIndex);
  let suffix = pattern.slice(wildcardIndex + 1);
  if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) {
    return null;
  }

  return entry.slice(prefix.length, entry.length - suffix.length);
}

function wildcardSpecificity(pattern: string): number {
  return pattern.replace("*", "").length;
}

function applyWildcardMatch(value: string, wildcardMatch: string | null): string {
  return wildcardMatch == null ? value : value.replaceAll("*", wildcardMatch);
}

function isSubpath(path: string): boolean {
  return path.startsWith(".");
}
