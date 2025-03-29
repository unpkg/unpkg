import * as path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export function fixturePath(...filename: string[]): string {
  return path.resolve(__dirname, "fixtures", ...filename);
}

function packageInfoPath(packageName: string): string {
  return fixturePath("package-info", `${packageName}.json`);
}

export const packageInfo = {
  react: packageInfoPath("react"),
};
