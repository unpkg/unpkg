import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFixture } from "../../test/fixtures.ts";
import { parseTarStream } from "./tar.ts";

function readTarball(fixtureName: string): ReadableStream<Uint8Array> {
  return readFixture(fixtureName).pipeThrough(new DecompressionStream("gzip"));
}

async function parseTarball(fixtureName: string): Promise<{ name: string; size: number }[]> {
  let stream = readTarball(fixtureName);

  let entries: { name: string; size: number }[] = [];
  for await (let entry of parseTarStream(stream)) {
    entries.push({ name: entry.header.name, size: entry.header.size });
  }

  return entries;
}

describe("TarParser", () => {
  it("parses @ffmpeg/core-0.12.6.tgz", async () => {
    let entries = await parseTarball("core-0.12.6.tgz");
    assert.equal(entries.length, 5);
  });

  it("parses lodash-4.17.21.tgz", async () => {
    let entries = await parseTarball("lodash-4.17.21.tgz");
    assert.equal(entries.length, 1054);
  });

  it("parses material-5.16.7.tgz", async () => {
    let entries = await parseTarball("material-5.16.7.tgz");
    assert.equal(entries.length, 2923);
  });

  it("parses moment-2.29.0.tgz", async () => {
    let entries = await parseTarball("moment-2.29.0.tgz");
    assert.equal(entries.length, 533);
  });

  it("parses preact-10.26.4.tgz", async () => {
    let entries = await parseTarball("preact-10.26.4.tgz");
    assert.equal(entries.length, 134);
  });

  it("parses @ibm/plex-1.0.2.tgz", async () => {
    let entries = await parseTarball("plex-1.0.2.tgz");
    assert.equal(entries.length, 20669);
  });

  it("parses react-18.2.0.tgz", async () => {
    let entries = await parseTarball("react-18.2.0.tgz");
    assert.equal(entries.length, 20);
  });
});
