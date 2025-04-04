import { describe, it, expect } from "bun:test";

import { rewriteImports } from "./pkg-imports.ts";

describe("rewriteImports", () => {
  it('rewrites `import React from "react";`', () => {
    let result = rewriteImports('import React from "react";', "https://unpkg.com", { react: "15.6.1" });
    expect(result).toBe('import React from "https://unpkg.com/react@15.6.1?module";');
  });

  it('rewrites `import router from "@angular/router";`', () => {
    let result = rewriteImports('import router from "@angular/router";', "https://unpkg.com", {
      "@angular/router": "4.3.5",
    });
    expect(result).toBe('import router from "https://unpkg.com/@angular/router@4.3.5?module";');
  });

  it('rewrites `import map from "lodash.map";`', () => {
    let result = rewriteImports('import map from "lodash.map";', "https://unpkg.com", { "lodash.map": "4.6.0" });
    expect(result).toBe('import map from "https://unpkg.com/lodash.map@4.6.0?module";');
  });

  it('rewrites `import fs from "pn/fs";`', () => {
    let result = rewriteImports('import fs from "pn/fs";', "https://unpkg.com", { pn: "1.0.0" });
    expect(result).toBe('import fs from "https://unpkg.com/pn@1.0.0/fs?module";');
  });

  it('rewrites `import cupcakes from "./cupcakes";`', () => {
    let result = rewriteImports('import cupcakes from "./cupcakes";', "https://unpkg.com", {});
    expect(result).toBe('import cupcakes from "./cupcakes?module";');
  });

  it('rewrites `import shoelaces from "/shoelaces";`', () => {
    let result = rewriteImports('import shoelaces from "/shoelaces";', "https://unpkg.com", {});
    expect(result).toBe('import shoelaces from "/shoelaces?module";');
  });

  it('does not rewrite `import something from "//something.com/whatevs";`', () => {
    let result = rewriteImports('import something from "//something.com/whatevs";', "https://unpkg.com", {});
    expect(result).toBe('import something from "//something.com/whatevs";');
  });

  it('does not rewrite `import something from "http://something.com/whatevs";`', () => {
    let result = rewriteImports('import something from "http://something.com/whatevs";', "https://unpkg.com", {});
    expect(result).toBe('import something from "http://something.com/whatevs";');
  });

  it('does not rewrite `let ReactDOM = require("react-dom");`', () => {
    let result = rewriteImports('let ReactDOM = require("react-dom");', "https://unpkg.com", {});
    expect(result).toBe('let ReactDOM = require("react-dom");');
  });

  it('rewrites `export { default as React } from "react";`', () => {
    let result = rewriteImports('export { default as React } from "react";', "https://unpkg.com", { react: "15.6.1" });
    expect(result).toBe('export { default as React } from "https://unpkg.com/react@15.6.1?module";');
  });

  it('rewrites `export { Component } from "react";`', () => {
    let result = rewriteImports('export { Component } from "react";', "https://unpkg.com", { react: "15.6.1" });
    expect(result).toBe('export { Component } from "https://unpkg.com/react@15.6.1?module";');
  });

  it('rewrites `export * from "react";`', () => {
    let result = rewriteImports('export * from "react";', "https://unpkg.com", { react: "15.6.1" });
    expect(result).toBe('export * from "https://unpkg.com/react@15.6.1?module";');
  });

  it('does not rewrite `export var message = "hello";`', () => {
    let result = rewriteImports('export var message = "hello";', "https://unpkg.com", {});
    expect(result).toBe('export var message = "hello";');
  });

  it('rewrites `import("./something.js");`', () => {
    let result = rewriteImports('import("./something.js");', "https://unpkg.com", {});
    expect(result).toBe('import("./something.js?module");');
  });

  it('rewrites `import("react");`', () => {
    let result = rewriteImports('import("react");', "https://unpkg.com", { react: "15.6.1" });
    expect(result).toBe('import("https://unpkg.com/react@15.6.1?module");');
  });

  it('rewrites `import { Component } from "https://unpkg.com/@angular/core/";`', () => {
    let result = rewriteImports('import { Component } from "@angular/core/";', "https://unpkg.com", {
      "@angular/core": "1.2.3",
    });
    expect(result).toBe('import { Component } from "https://unpkg.com/@angular/core@1.2.3?module";');
  });

  it('rewrites `import { state } from "lit";` when version is a join', () => {
    let result = rewriteImports('import { state } from "lit";', "https://unpkg.com", { lit: "^2.0.0 || ^3.0.0" });
    expect(result).toBe('import { state } from "https://unpkg.com/lit@^3.0.0?module";');
  });

  it('rewrites `import { state } from "lit";` when version is a range', () => {
    let result = rewriteImports('import { state } from "lit";', "https://unpkg.com", { lit: "2.0.0 - 3.0.0" });
    expect(result).toBe('import { state } from "https://unpkg.com/lit@3.0.0?module";');
  });
});
