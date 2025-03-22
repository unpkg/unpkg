import * as path from "node:path";
import * as fsp from "node:fs/promises";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const packageInfo = {
  lodash: await readPackageInfo("lodash"),
  preact: await readPackageInfo("preact"),
  react: await readPackageInfo("react"),
};

async function readPackageInfo(packageName: string): Promise<any> {
  return JSON.parse(await fsp.readFile(path.resolve(__dirname, `./fixtures/package-info/${packageName}.json`), "utf8"));
}

export const packageTarballs = {
  lodash: {
    "4.17.21": await readPackageTarball("lodash-4.17.21"),
  },
  material: {
    "5.16.7": await readPackageTarball("material-5.16.7"),
  },
  moment: {
    "2.29.0": await readPackageTarball("moment-2.29.0"),
  },
  plex: {
    "1.0.2": await readPackageTarball("plex-1.0.2"),
  },
  preact: {
    "10.26.4": await readPackageTarball("preact-10.26.4"),
  },
  react: {
    "18.2.0": await readPackageTarball("react-18.2.0"),
  },
};

function readPackageTarball(packageName: string): Promise<Uint8Array> {
  return fsp.readFile(path.resolve(__dirname, `./fixtures/package-tarballs/${packageName}.tgz`));
}
