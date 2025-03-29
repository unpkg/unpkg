import * as path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export function fixturePath(...filename: string[]): string {
  return path.resolve(__dirname, "fixtures", ...filename);
}

function packageInfoPath(packageName: string): string {
  return fixturePath("package-info", `${packageName}.json`);
}

export const packageInfo = {
  lodash: packageInfoPath("lodash"),
  preact: packageInfoPath("preact"),
  react: packageInfoPath("react"),
  vitessce: packageInfoPath("vitessce"),
};

function packageTarballPath(packageName: string): string {
  return fixturePath("package-tarballs", `${packageName}.tgz`);
}

export const packageTarballs = {
  lodash: {
    "4.17.21": packageTarballPath("lodash-4.17.21"),
  },
  preact: {
    "10.26.4": packageTarballPath("preact-10.26.4"),
  },
  react: {
    "18.2.0": packageTarballPath("react-18.2.0"),
  },
  vitessce: {
    "3.5.9": packageTarballPath("vitessce-3.5.9"),
  },
};
