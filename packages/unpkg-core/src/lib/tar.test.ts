import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readFixture } from "../../test/fixtures.ts";

import { type TarEntry, parseTarStream } from "./tar.ts";

describe("TarParser", () => {
  it("parses @ffmpeg/core-0.12.6.tgz", async () => {
    let stream = readFixture("core-0.12.6");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 5);
  });

  it("parses lodash-4.17.21.tgz", async () => {
    let stream = readFixture("lodash-4.17.21");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 1054);
  });

  it("parses material-5.16.7.tgz", async () => {
    let stream = readFixture("material-5.16.7");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 2923);
  });

  it("parses moment-2.29.0.tgz", async () => {
    let stream = readFixture("moment-2.29.0");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 533);
  });

  it("parses preact-10.26.4.tgz", async () => {
    let stream = readFixture("preact-10.26.4");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 134);
  });

  it("parses @ibm/plex-1.0.2.tgz", async () => {
    let stream = readFixture("plex-1.0.2");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 20669);
  });

  it("parses react-18.2.0.tgz", async () => {
    let stream = readFixture("react-18.2.0");

    let entries: TarEntry[] = [];
    for await (let entry of parseTarStream(stream)) {
      entries.push(entry);
    }

    assert.equal(entries.length, 20);
  });
});
