import { valid, maxSatisfying } from "semver";

import { type PackageInfo } from "./pkg-info.ts";

export function resolvePackageVersion(packageInfo: PackageInfo, versionRangeOrTag = "latest"): string | null {
  let tags = packageInfo["dist-tags"];
  let versions = Object.keys(packageInfo.versions);

  if (versionRangeOrTag in tags) {
    return tags[versionRangeOrTag];
  }

  if (valid(versionRangeOrTag) && versions.includes(versionRangeOrTag)) {
    return versionRangeOrTag;
  }

  let max = maxSatisfying(versions, versionRangeOrTag);

  return max === null ? null : max;
}
