import * as path from "node:path";
import * as fsp from "node:fs/promises";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const packageInfo = {
  react: await readPackageInfo("react"),
};

async function readPackageInfo(packageName: string): Promise<any> {
  return JSON.parse(
    await fsp.readFile(
      path.resolve(__dirname, `./fixtures/package-info/${packageName}.json`),
      "utf8"
    )
  );
}
