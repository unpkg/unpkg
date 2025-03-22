import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { packageTarballs } from "../test/fixtures.ts";

import { type TarEntry, parseTarStream } from "./tar.ts";

function bufferToStream(buffer: Uint8Array, chunkSize = Math.pow(2, 16)): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let offset = 0;

      function push() {
        if (offset < buffer.length) {
          controller.enqueue(buffer.slice(offset, offset + chunkSize));
          offset += chunkSize;
          setTimeout(push, 0);
        } else {
          controller.close();
        }
      }

      push();
    },
  });
}

function tarballStream(tarball: Uint8Array): ReadableStream<Uint8Array> {
  return bufferToStream(tarball).pipeThrough(new DecompressionStream("gzip"));
}

describe("TarParser", () => {
  it("parses lodash-4.17.21.tgz", async () => {
    let stream = tarballStream(packageTarballs.lodash["4.17.21"]);

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 1054);
  });

  it("parses material-5.16.7.tgz", async () => {
    let stream = tarballStream(packageTarballs.material["5.16.7"]);

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 2923);
  });

  it("parses moment-2.29.0.tgz", async () => {
    let stream = tarballStream(packageTarballs.moment["2.29.0"]);

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 533);
  });

  it("parses preact-10.26.4.tgz", async () => {
    let stream = tarballStream(packageTarballs.preact["10.26.4"]);

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 134);
  });

  it("parses plex-1.0.2.tgz", async () => {
    let stream = tarballStream(packageTarballs.plex["1.0.2"]);

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 20669);
  });

  it("parses react-18.2.0.tgz", async () => {
    let stream = tarballStream(packageTarballs.react["18.2.0"]);

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 20);
  });
});
