export interface PackageInfo {
  description?: string;
  "dist-tags"?: Record<string, string>;
  homepage?: string;
  keywords?: string[];
  license?: string;
  maintainers?: { name: string; email?: string }[];
  name: string;
  repository?: {
    type: string;
    url: string;
    directory?: string;
  };
  time: Record<string, string>; // timestamps of published versions
  versions?: Record<string, PackageJson>;
}

export interface PackageJson {
  // See https://github.com/defunctzombie/package-browser-field-spec
  browser?: string | Record<string, string>;
  dependencies: Record<string, string>;
  description: string;
  devDependencies?: Record<string, string>;
  exports?: string | ExportConditions;
  homepage?: string;
  license?: string;
  main?: string;
  // See https://medium.com/webpack/webpack-and-rollup-the-same-but-different-a41ad427058c
  module?: string;
  name: string;
  peerDependencies?: Record<string, string>;
  repository?: { url: string; type?: string; directory?: string };
  unpkg?: string;
  version: string;
}

export interface ExportConditions {
  [condition: string]: string | ExportConditions;
}

export async function getPackageInfo(registry: string, packageName: string): Promise<PackageInfo | null> {
  let request = new Request(createPackageInfoUrl(registry, packageName), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  let response = await fetch(request);

  if (!response.ok) {
    return null;
  }

  return response.json();
}

function createPackageInfoUrl(registry: string, packageName: string): URL {
  return new URL(`/${packageName.toLowerCase()}`, registry);
}
