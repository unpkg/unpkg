import * as path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export function fixturePath(...filename: string[]): string {
  return path.resolve(__dirname, "fixtures", ...filename);
}

export const packageTarballs = {
  "@ffmpeg/core": {
    "0.12.6": fixturePath("core-0.12.6.tgz"),
  },
  lodash: {
    "4.17.21": fixturePath("lodash-4.17.21.tgz"),
  },
  preact: {
    "10.26.4": fixturePath("preact-10.26.4.tgz"),
  },
  react: {
    "18.2.0": fixturePath("react-18.2.0.tgz"),
  },
};
