import * as path from "node:path";
import * as fsp from "node:fs/promises";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const packageInfo = {
  lodash: await readPackageInfo("lodash"),
  preact: await readPackageInfo("preact"),
  react: await readPackageInfo("react"),
  vitessce: await readPackageInfo("vitessce"),
};

async function readPackageInfo(packageName: string): Promise<any> {
  return JSON.parse(await fsp.readFile(path.resolve(__dirname, `./fixtures/package-info/${packageName}.json`), "utf8"));
}

export const packageTarballs = {
  lodash: {
    "4.17.21": await readPackageTarball("lodash-4.17.21"),
  },
  preact: {
    "10.26.4": await readPackageTarball("preact-10.26.4"),
  },
  react: {
    "18.2.0": await readPackageTarball("react-18.2.0"),
  },
  vitessce: {
    "3.5.9": await readPackageTarball("vitessce-3.5.9"),
  },
};

function readPackageTarball(packageName: string): Promise<Uint8Array> {
  return fsp.readFile(path.resolve(__dirname, `./fixtures/package-tarballs/${packageName}.tgz`));
}
