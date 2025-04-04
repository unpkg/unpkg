import { valid, maxSatisfying } from "semver";

import type { PackageInfo } from "./npm-info.ts";

export function resolvePackageVersion(packageInfo: PackageInfo, versionRangeOrTag: string): string | null {
  let tags = packageInfo["dist-tags"];
  if (tags != null && versionRangeOrTag in tags) {
    return tags[versionRangeOrTag];
  }

  if (packageInfo.versions == null) return null;

  let versions = Object.keys(packageInfo.versions);
  if (valid(versionRangeOrTag) && versions.includes(versionRangeOrTag)) {
    return versionRangeOrTag;
  }

  let max = maxSatisfying(versions, versionRangeOrTag);

  return max === null ? null : max;
}
