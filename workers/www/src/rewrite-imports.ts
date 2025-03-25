import { parse } from "es-module-lexer/js";

/**
 * Rewrites all imports in the given code to point to unpkg URLs.
 */
export function rewriteImports(code: string, origin: string, dependencies: Record<string, string>): string {
  let [imports] = parse(code);
  let rewrites: { start: number; end: number; value: string }[] = [];

  for (let imp of imports) {
    // Skip imports without a specifier
    if (imp.n === undefined) {
      continue;
    }

    let specifier = code.slice(imp.s, imp.e);

    let rewriteValue: string;
    if (imp.t === 2) {
      // dynamic import()
      let match = /^(["'])([^"']*)\1$/.exec(specifier);
      if (match === null) continue; // not a simple string literal
      rewriteValue = match[1] + rewriteSpecifier(match[2], origin, dependencies) + match[1];
    } else {
      rewriteValue = rewriteSpecifier(specifier, origin, dependencies);
    }

    if (rewriteValue !== specifier) {
      rewrites.push({ start: imp.s, end: imp.e, value: rewriteValue });
    }
  }

  // Sort rewrites in reverse order to avoid position shifts
  rewrites.sort((a, b) => b.start - a.start);

  let result = code;
  for (let { start, end, value } of rewrites) {
    result = result.slice(0, start) + value + result.slice(end);
  }

  return result;
}

function rewriteSpecifier(specifier: string, origin: string, dependencies: Record<string, string>): string {
  if (specifier === "" || isValidUrl(specifier)) {
    return specifier;
  }

  if (isBareSpecifier(specifier)) {
    let match = bareSpecifierFormat.exec(specifier);
    if (match === null) return specifier; // should never happen
    let packageName = match[1];
    let path = match[2] || "";

    let version = dependencies[packageName];
    if (version === undefined) {
      console.warn(`No dependency version found for ${packageName}, defaulting to latest`);
      version = "latest";
    } else if (/ \|\| /.test(version)) {
      let versions = version.split(" || ");
      version = versions[versions.length - 1];
    }
    if (/ - /.test(version)) {
      let versions = version.split(" - ");
      version = versions[versions.length - 1];
    }

    return `${origin}/${packageName}@${version}${stripTrailingSlash(path)}?module`;
  }

  // local path
  return `${stripTrailingSlash(specifier)}?module`;
}

function stripTrailingSlash(path: string): string {
  return path.replace(/\/+$/, "");
}

function isValidUrl(url: string): boolean {
  return URL.parse(url) !== null || url.startsWith("//");
}

const bareSpecifierFormat = /^((?:@[^/]+\/)?[^/]+)(\/.*)?$/;

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}
