import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export function readFixture(name: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let stream = fs.createReadStream(path.resolve(__dirname, `./fixtures/${name}`));
      stream.on("error", (error) => controller.error(error));
      stream.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      stream.on("end", () => controller.close());
    },
  });
}
