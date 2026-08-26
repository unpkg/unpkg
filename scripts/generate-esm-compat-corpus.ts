#!/usr/bin/env bun

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface PackageSeed {
  category: string;
  cssRoot?: boolean;
  name: string;
  scenarios?: ScenarioName[];
}

type ScenarioName =
  | "browser-target"
  | "css-module"
  | "css-missing"
  | "css-subpath"
  | "deps-react"
  | "dev"
  | "external-all"
  | "external-react"
  | "jsx-runtime"
  | "meta"
  | "min"
  | "node-target"
  | "raw-package-json"
  | "root"
  | "sourcemap"
  | "worker";

interface CompatCase {
  category: string;
  description: string;
  expect: "module" | "json" | "css" | "diagnostic";
  features: string[];
  package: string;
  path: string;
}

interface NpmPackageInfo {
  "dist-tags"?: Record<string, string>;
}

const outputPath = process.argv[2] ?? "scripts/esm-compat-corpus.ecosystem.json";
const registry = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

const packageSeeds: PackageSeed[] = [
  { name: "@babel/runtime", category: "cjs" },
  { name: "@emotion/react", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "@emotion/styled", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "@floating-ui/dom", category: "browser" },
  { name: "@floating-ui/react", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "@reduxjs/toolkit", category: "framework-peer" },
  { name: "@tanstack/react-query", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "@types/react", category: "types" },
  { name: "axios", category: "browser" },
  { name: "buffer", category: "node-builtin" },
  { name: "bootstrap", category: "css", scenarios: ["css-subpath"] },
  { name: "chalk", category: "cjs" },
  { name: "classnames", category: "cjs" },
  { name: "clsx", category: "browser" },
  { name: "color", category: "cjs" },
  { name: "commander", category: "cjs" },
  { name: "copy-to-clipboard", category: "browser" },
  { name: "core-js", category: "large-graph" },
  { name: "cross-fetch", category: "browser" },
  { name: "d3", category: "large-graph" },
  { name: "d3-array", category: "large-graph" },
  { name: "d3-scale", category: "large-graph" },
  { name: "date-fns", category: "browser" },
  { name: "dayjs", category: "cjs" },
  { name: "debug", category: "cjs" },
  { name: "decimal.js", category: "browser" },
  { name: "deepmerge", category: "cjs" },
  { name: "dompurify", category: "browser" },
  { name: "dotenv", category: "node-only", scenarios: ["node-target"] },
  { name: "events", category: "node-builtin" },
  { name: "fast-deep-equal", category: "cjs" },
  { name: "formik", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "framer-motion", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "fuse.js", category: "browser" },
  { name: "graphql", category: "browser" },
  { name: "history", category: "browser" },
  { name: "htm", category: "framework" },
  { name: "immer", category: "browser" },
  { name: "is-plain-object", category: "cjs" },
  { name: "js-cookie", category: "browser" },
  { name: "js-yaml", category: "cjs" },
  { name: "jszip", category: "browser" },
  { name: "lit", category: "framework" },
  { name: "lodash", category: "cjs" },
  { name: "lodash-es", category: "browser" },
  { name: "marked", category: "browser" },
  { name: "memoize-one", category: "cjs" },
  { name: "mime", category: "cjs" },
  { name: "mobx", category: "browser" },
  { name: "moment", category: "cjs" },
  { name: "ms", category: "cjs" },
  { name: "nanoid", category: "browser", scenarios: ["browser-target", "node-target"] },
  { name: "normalize.css", category: "css", cssRoot: true },
  { name: "path-browserify", category: "node-builtin" },
  { name: "preact", category: "framework", scenarios: ["jsx-runtime", "worker"] },
  { name: "prop-types", category: "framework-peer" },
  { name: "qs", category: "cjs" },
  { name: "query-string", category: "browser" },
  { name: "ramda", category: "cjs" },
  { name: "react", category: "framework", scenarios: ["dev", "jsx-runtime", "node-target", "worker"] },
  { name: "react", category: "css", scenarios: ["css-missing"] },
  { name: "react-dom", category: "framework-peer", scenarios: ["deps-react", "dev", "external-react"] },
  { name: "react-hook-form", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "react-is", category: "framework-peer" },
  { name: "react-toastify", category: "css", scenarios: ["css-subpath", "css-module"] },
  { name: "react-redux", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "react-router", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "react-router-dom", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "recharts", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "redux", category: "browser" },
  { name: "resolve", category: "cjs" },
  { name: "rxjs", category: "browser" },
  { name: "scheduler", category: "framework-peer" },
  { name: "semver", category: "cjs" },
  { name: "shallowequal", category: "cjs" },
  { name: "solid-js", category: "framework", scenarios: ["jsx-runtime"] },
  { name: "stream-browserify", category: "node-builtin" },
  { name: "string-width", category: "cjs" },
  { name: "styled-components", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "svelte", category: "framework" },
  { name: "swr", category: "framework-peer", scenarios: ["deps-react", "external-all", "external-react"] },
  { name: "tiny-invariant", category: "cjs" },
  { name: "tslib", category: "browser" },
  { name: "underscore", category: "cjs" },
  { name: "use-sync-external-store", category: "framework-peer", scenarios: ["deps-react"] },
  { name: "uuid", category: "browser", scenarios: ["browser-target", "node-target"] },
  { name: "valtio", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "vite", category: "node-only", scenarios: ["node-target"] },
  { name: "vue", category: "framework", scenarios: ["dev"] },
  { name: "vue-router", category: "framework-peer" },
  { name: "yallist", category: "cjs" },
  { name: "yaml", category: "browser" },
  { name: "yup", category: "browser" },
  { name: "zod", category: "browser" },
  { name: "zustand", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "three", category: "large-graph" },
  { name: "monaco-editor", category: "large-graph" },
  { name: "lucide-react", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "react-window", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "ag-grid-community", category: "large-graph" },
  { name: "xstate", category: "browser" },
  { name: "jotai", category: "framework-peer", scenarios: ["deps-react", "external-react"] },
  { name: "es-toolkit", category: "browser" },
  { name: "numbro", category: "cjs" },
  { name: "date-fns-tz", category: "browser" },
];

let versions = new Map<string, string>();
for (let seed of packageSeeds) {
  versions.set(seed.name, await resolveLatestVersion(seed.name));
}

let cases = packageSeeds.flatMap((seed) => createCases(seed, versions.get(seed.name)!));
let corpus = {
  name: "ecosystem",
  description: "Version-pinned npm package scenarios for ecosystem-scale esm.sh compatibility measurement.",
  generatedAt: new Date().toISOString(),
  packageCount: new Set(packageSeeds.map((seed) => seed.name)).size,
  scenarioCount: cases.length,
  cases,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(`Wrote ${cases.length} scenarios for ${corpus.packageCount} packages to ${outputPath}`);

async function resolveLatestVersion(packageName: string): Promise<string> {
  let response = await fetch(new URL(`/${packageName}`, registry), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Unable to resolve ${packageName}: ${response.status} ${response.statusText}`);
  }

  let info = await response.json() as NpmPackageInfo;
  let latest = info["dist-tags"]?.latest;
  if (latest == null) {
    throw new Error(`Package has no latest dist-tag: ${packageName}`);
  }

  return latest;
}

function createCases(seed: PackageSeed, version: string): CompatCase[] {
  let scenarios = new Set<ScenarioName>(["root", "meta", "raw-package-json", ...(seed.scenarios ?? [])]);

  return Array.from(scenarios).map((scenario) => createCase(seed, version, scenario));
}

function createCase(seed: PackageSeed, version: string, scenario: ScenarioName): CompatCase {
  let packageSpecifier = `${seed.name}@${version}`;
  let base = `/${packageSpecifier}`;

  switch (scenario) {
    case "browser-target":
      return moduleCase(seed, `Browser target for ${packageSpecifier}`, `${base}?target=es2020`, ["target"]);
    case "css-module":
      return moduleCase(
        seed,
        `CSS module output for ${packageSpecifier}`,
        `${base}/dist/ReactToastify.css?module`,
        ["css", "css-module"]
      );
    case "css-missing":
      return diagnosticCase(seed, `Explicit CSS request without a stylesheet for ${packageSpecifier}`, `${base}?css`, [
        "css",
        "css-not-found",
      ]);
    case "css-subpath":
      return cssCase(seed, `Direct CSS file for ${packageSpecifier}`, getCssSubpath(seed, base), ["css", "subpath"]);
    case "deps-react":
      return moduleCase(seed, `React dependency override for ${packageSpecifier}`, `${base}?deps=react@18.3.1`, ["deps"]);
    case "dev":
      return moduleCase(seed, `Development mode for ${packageSpecifier}`, `${base}?dev`, ["dev"]);
    case "external-all":
      return moduleCase(seed, `External-all shorthand for ${packageSpecifier}`, `/*${packageSpecifier}`, ["external-all"]);
    case "external-react":
      return moduleCase(seed, `External React for ${packageSpecifier}`, `${base}?external=react,react-dom`, ["external"]);
    case "jsx-runtime":
      return moduleCase(seed, `JSX runtime subpath for ${packageSpecifier}`, `${base}/jsx-runtime`, ["subpath", "jsx-runtime"]);
    case "meta":
      return jsonCase(seed, `Metadata for ${packageSpecifier}`, `${base}?meta`, ["meta"]);
    case "min":
      return moduleCase(seed, `Minified output for ${packageSpecifier}`, `${base}?min`, ["min"]);
    case "node-target":
      return moduleCase(seed, `Node target for ${packageSpecifier}`, `${base}?target=node`, ["target-node"]);
    case "raw-package-json":
      return jsonCase(seed, `Raw package.json for ${packageSpecifier}`, `${base}/package.json?raw`, ["raw"]);
    case "root":
      return seed.cssRoot === true
        ? cssCase(seed, `Package CSS root for ${packageSpecifier}`, base, ["css", "package-root"])
        : moduleCase(seed, `Package root for ${packageSpecifier}`, base, ["package-root"]);
    case "sourcemap":
      return moduleCase(seed, `Source map output for ${packageSpecifier}`, `${base}?sourcemap`, ["sourcemap"]);
    case "worker":
      return moduleCase(seed, `Worker wrapper for ${packageSpecifier}`, `${base}?worker`, ["worker"]);
  }
}

function moduleCase(seed: PackageSeed, description: string, casePath: string, features: string[]): CompatCase {
  return {
    category: seed.category,
    description,
    expect: "module",
    features,
    package: seed.name,
    path: casePath,
  };
}

function jsonCase(seed: PackageSeed, description: string, casePath: string, features: string[]): CompatCase {
  return {
    category: seed.category,
    description,
    expect: "json",
    features,
    package: seed.name,
    path: casePath,
  };
}

function cssCase(seed: PackageSeed, description: string, casePath: string, features: string[]): CompatCase {
  return {
    category: seed.category,
    description,
    expect: "css",
    features,
    package: seed.name,
    path: casePath,
  };
}

function getCssSubpath(seed: PackageSeed, base: string): string {
  if (seed.name === "bootstrap") {
    return `${base}/dist/css/bootstrap.min.css`;
  }
  if (seed.name === "react-toastify") {
    return `${base}/dist/ReactToastify.css`;
  }

  return base;
}
