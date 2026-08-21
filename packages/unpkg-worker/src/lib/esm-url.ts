export interface EsmPackagePath {
  externalAll: boolean;
  filename?: string;
  package: string;
  scope?: string;
  version?: string;
}

export interface NormalizedEsmRequest {
  packagePath: EsmPackagePath;
  search: string;
  searchParams: URLSearchParams;
  target: string;
  url: URL;
}

export type EsmRequestErrorCode =
  | "INVALID_PACKAGE_SPECIFIER"
  | "INVALID_QUERY"
  | "UNSUPPORTED_TARGET";

export interface EsmRequestError {
  code: EsmRequestErrorCode;
  message: string;
  status: number;
}

const browserTargets = new Set([
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
  "denonext",
  "node",
]);

const rawModeConflicts = new Set([
  "bundle",
  "dev",
  "env",
  "exports",
  "ignore-annotations",
  "jsx",
  "jsxImportSource",
  "keep-names",
  "min",
  "no-bundle",
  "sourcemap",
  "standalone",
  "target",
]);

export function normalizeEsmRequestUrl(requestUrl: string | URL): NormalizedEsmRequest | EsmRequestError {
  let url = new URL(requestUrl);
  let pathQuery = extractPathQuery(url.pathname);

  if (pathQuery != null) {
    url.pathname = pathQuery.pathname;
    for (let [name, value] of pathQuery.searchParams) {
      url.searchParams.append(name, value);
    }
  }

  let packagePath = parseEsmPackagePathname(url.pathname);
  if (packagePath == null) {
    return {
      code: "INVALID_PACKAGE_SPECIFIER",
      message: `Invalid package specifier: ${url.pathname}`,
      status: 400,
    };
  }

  let validationError = validateEsmSearchParams(url.searchParams);
  if (validationError != null) {
    return validationError;
  }

  if (
    !url.searchParams.has("target") &&
    !url.searchParams.has("raw") &&
    !isUntargetedAssetRequest(packagePath, url.searchParams)
  ) {
    url.searchParams.set("target", "es2022");
  }

  let search = normalizeSearchParams(url.searchParams);
  url.search = search;

  return {
    packagePath,
    search,
    searchParams: new URLSearchParams(url.searchParams),
    target: url.searchParams.get("target") ?? "raw",
    url,
  };
}

function isUntargetedAssetRequest(packagePath: EsmPackagePath, searchParams: URLSearchParams): boolean {
  return (
    searchParams.has("css") ||
    packagePath.package.toLowerCase().startsWith("@types/") ||
    packagePath.package.endsWith(".css") ||
    packagePath.filename?.endsWith(".css") === true ||
    isTypeDeclarationPath(packagePath.filename)
  );
}

function isTypeDeclarationPath(filename: string | undefined): boolean {
  return filename?.endsWith(".d.ts") || filename?.endsWith(".d.mts") || filename?.endsWith(".d.cts") || false;
}

export function parseEsmPackagePathname(pathname: string): EsmPackagePath | null {
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    console.error(`Failed to decode pathname: ${pathname}`);
  }

  let match = /^\/(\*)?((?:(@[^/@]+)\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(pathname);
  if (match == null) return null;

  return {
    externalAll: match[1] === "*",
    package: match[2],
    scope: match[3],
    version: match[4],
    filename: match[5],
  };
}

export function getEsmPackageSubpath(filename: string | undefined): string {
  if (filename == null || filename === "/" || filename === "") {
    return ".";
  }

  return `.${filename.replace(/\/+$/, "")}`;
}

function validateEsmSearchParams(searchParams: URLSearchParams): EsmRequestError | null {
  let target = searchParams.get("target");
  if (target != null && !browserTargets.has(target)) {
    return {
      code: "UNSUPPORTED_TARGET",
      message: `Unsupported target: ${target}`,
      status: 400,
    };
  }

  if (searchParams.has("dev") && searchParams.get("env") === "production") {
    return {
      code: "INVALID_QUERY",
      message: "?dev cannot be combined with ?env=production",
      status: 400,
    };
  }

  let env = searchParams.get("env");
  if (env != null && env !== "development" && env !== "production") {
    return {
      code: "INVALID_QUERY",
      message: `Unsupported env: ${env}`,
      status: 400,
    };
  }

  if (searchParams.has("raw")) {
    for (let name of rawModeConflicts) {
      if (searchParams.has(name)) {
        return {
          code: "INVALID_QUERY",
          message: `?raw cannot be combined with ?${name}`,
          status: 400,
        };
      }
    }
  }

  return null;
}

function extractPathQuery(pathname: string): { pathname: string; searchParams: URLSearchParams } | null {
  let ampersandIndex = pathname.indexOf("&");
  if (ampersandIndex === -1) return null;

  let before = pathname.slice(0, ampersandIndex);
  let after = pathname.slice(ampersandIndex + 1);
  let slashIndex = after.indexOf("/");
  let pathQuery = slashIndex === -1 ? after : after.slice(0, slashIndex);
  let pathSuffix = slashIndex === -1 ? "" : after.slice(slashIndex);
  let searchParams = new URLSearchParams();

  for (let part of pathQuery.split("&")) {
    if (part === "") continue;

    let equalsIndex = part.indexOf("=");
    if (equalsIndex === -1) {
      searchParams.append(part, "");
    } else {
      searchParams.append(part.slice(0, equalsIndex), part.slice(equalsIndex + 1));
    }
  }

  return {
    pathname: before + pathSuffix,
    searchParams,
  };
}

function normalizeSearchParams(searchParams: URLSearchParams): string {
  let entries = Array.from(searchParams.entries()).sort(([leftName, leftValue], [rightName, rightValue]) => {
    if (leftName === rightName) {
      return leftValue.localeCompare(rightValue);
    }

    return leftName.localeCompare(rightName);
  });
  let normalized = new URLSearchParams();

  for (let [name, value] of entries) {
    normalized.append(name, value);
  }

  let search = normalized.toString();
  return search === "" ? "" : `?${search}`;
}
