export function parsePackagePathname(pathname: string): {
  package: string;
  scope?: string;
  version?: string;
  filename?: string;
} | null {
  try {
    pathname = decodeURIComponent(pathname);
  } catch (e) {
    console.error(`Failed to decode pathname: ${pathname}`);
  }

  let match = /^\/((?:(@[^/@]+)\/)?[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(pathname);

  if (match == null) return null;

  return {
    package: match[1],
    scope: match[2],
    version: match[3],
    filename: match[4],
  };
}
