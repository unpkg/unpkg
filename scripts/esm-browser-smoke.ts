#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

import { compareExportKeys } from "./esm-browser-parity.ts";

interface CompatCase {
  category?: string;
  description: string;
  expect: "module" | "javascript" | "json" | "css" | "typescript" | "diagnostic";
  features?: string[];
  package?: string;
  path: string;
}

interface RuntimeSmokeCase {
  case: CompatCase;
  run: (page: import("playwright").Page, origin: string, runOrigin: string) => Promise<string[]>;
}

interface CompatCorpus {
  cases: CompatCase[];
  description?: string;
  name?: string;
}

interface BrowserSmokeResult {
  baselineExportKeys?: string[];
  case: CompatCase;
  durationMs: number;
  error: string | null;
  exportKeys: string[];
  requestCount: number;
  transferredBytes: number;
  url: string;
}

interface BrowserSmokeReport {
  baselineOrigin?: string;
  browser: "chromium";
  corpus: string;
  createdAt: string;
  failed: number;
  origin: string;
  passed: number;
  results: BrowserSmokeResult[];
  total: number;
}

let options = parseArgs(process.argv.slice(2));
let origin = stripTrailingSlash(options.origin ?? process.env.ESM_BROWSER_ORIGIN ?? "https://esm.sh");
let baselineOrigin = options.baselineOrigin == null ? null : stripTrailingSlash(options.baselineOrigin);
let runOrigin = stripTrailingSlash(options.runOrigin ?? process.env.UNPKG_RUN_ORIGIN ?? origin);
let corpus = await loadCorpus(options.corpusPath);
let smokeCases = corpus.cases.filter((compatCase) => {
  if (compatCase.expect !== "module") return false;
  if (compatCase.features?.includes("worker")) return false;
  if (compatCase.features?.includes("external")) return false;
  if (compatCase.features?.includes("external-all")) return false;
  if (compatCase.features?.includes("target-node")) return false;
  return options.packageName == null || compatCase.package === options.packageName;
}).slice(0, options.limit);
let runtimeCases = options.packageName == null ? createRuntimeSmokeCases() : [];

if (options.dryRun) {
  let importResults = smokeCases.map((compatCase) => ({
    case: compatCase,
    durationMs: 0,
    error: null,
    exportKeys: [],
    requestCount: 0,
    transferredBytes: 0,
    url: new URL(compatCase.path, origin).toString(),
  }));
  let runtimeResults = runtimeCases.map(({ case: smokeCase }) => ({
    case: smokeCase,
    durationMs: 0,
    error: null,
    exportKeys: [],
    requestCount: 0,
    transferredBytes: 0,
    url: new URL(smokeCase.path, origin).toString(),
  }));
  let results = [...importResults, ...runtimeResults];
  printReport({
    baselineOrigin: baselineOrigin ?? undefined,
    browser: "chromium",
    corpus: corpus.name ?? options.corpusPath,
    createdAt: new Date().toISOString(),
    failed: 0,
    origin,
    passed: results.length,
    results,
    total: results.length,
  }, options.jsonOutput);
  process.exit(0);
}

let browser = await chromium.launch();
try {
  let context = await browser.newContext();
  let page = await context.newPage();
  let results: BrowserSmokeResult[] = [];
  for (let compatCase of smokeCases) {
    results.push(await runCase(page, compatCase, origin));
  }
  for (let runtimeCase of runtimeCases) {
    results.push(await runRuntimeCase(page, runtimeCase, origin));
  }

  if (baselineOrigin != null) {
    let baselineResults: BrowserSmokeResult[] = [];
    for (let compatCase of smokeCases) {
      baselineResults.push(await runCase(page, compatCase, baselineOrigin));
    }
    for (let runtimeCase of runtimeCases) {
      baselineResults.push(await runRuntimeCase(page, runtimeCase, baselineOrigin));
    }

    results = results.map((result, index) => addBaselineParity(result, baselineResults[index]));
  }

  let failed = results.filter((result) => result.error != null).length;
  printReport({
    baselineOrigin: baselineOrigin ?? undefined,
    browser: "chromium",
    corpus: corpus.name ?? options.corpusPath,
    createdAt: new Date().toISOString(),
    failed,
    origin,
    passed: results.length - failed,
    results,
    total: results.length,
  }, options.jsonOutput);

  if (failed > 0) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

function addBaselineParity(
  result: BrowserSmokeResult,
  baseline: BrowserSmokeResult | undefined
): BrowserSmokeResult {
  if (baseline == null) {
    return { ...result, error: result.error ?? "Missing baseline browser result" };
  }

  let parityError =
    result.error ??
    (baseline.error == null ? compareExportKeys(baseline.exportKeys, result.exportKeys) : `Baseline failed: ${baseline.error}`);
  return {
    ...result,
    baselineExportKeys: baseline.exportKeys,
    error: parityError,
  };
}

async function runCase(page: import("playwright").Page, compatCase: CompatCase, origin: string): Promise<BrowserSmokeResult> {
  let url = new URL(compatCase.path, origin).toString();
  return trackBrowserCase(page, compatCase, origin, url, async () => {
    return page.evaluate(async (moduleUrl) => {
      let module = await import(moduleUrl);
      return Object.keys(module).sort();
    }, url);
  });
}

async function runRuntimeCase(
  page: import("playwright").Page,
  runtimeCase: RuntimeSmokeCase,
  origin: string
): Promise<BrowserSmokeResult> {
  let url = new URL(runtimeCase.case.path, origin).toString();
  let runtimePage = await page.context().newPage();
  try {
    await runtimePage.setContent("<!doctype html><html><body></body></html>");
    return await trackBrowserCase(runtimePage, runtimeCase.case, origin, url, () =>
      runtimeCase.run(runtimePage, origin, runOrigin)
    );
  } finally {
    await runtimePage.close();
  }
}

async function trackBrowserCase(
  page: import("playwright").Page,
  compatCase: CompatCase,
  origin: string,
  url: string,
  callback: () => Promise<string[]>
): Promise<BrowserSmokeResult> {
  let startedAt = performance.now();
  let requestCount = 0;
  let transferredBytes = 0;

  let responseHandler = async (response: import("playwright").Response): Promise<void> => {
    if (!response.url().startsWith(origin)) return;
    requestCount += 1;
    let headerLength = Number(response.headers()["content-length"]);
    if (Number.isFinite(headerLength)) {
      transferredBytes += headerLength;
    } else {
      try {
        transferredBytes += (await response.body()).byteLength;
      } catch {
        // Some cross-origin responses are not readable through Playwright. Request count
        // still gives us a useful signal for bundle-vs-unbundle scenarios.
      }
    }
  };

  page.on("response", responseHandler);
  try {
    let exportKeys = await callback();

    return {
      case: compatCase,
      durationMs: Math.round(performance.now() - startedAt),
      error: null,
      exportKeys,
      requestCount,
      transferredBytes,
      url,
    };
  } catch (error) {
    return {
      case: compatCase,
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      exportKeys: [],
      requestCount,
      transferredBytes,
      url,
    };
  } finally {
    page.off("response", responseHandler);
  }
}

function createRuntimeSmokeCases(): RuntimeSmokeCase[] {
  return [
    {
      case: {
        category: "runtime",
        description: "React renders with react-dom/client",
        expect: "module",
        features: ["runtime", "react", "render"],
        package: "react-dom",
        path: "/__runtime/react-render",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let ReactModule = await import(`${esmOrigin}/react@18.3.1`);
          let React = ReactModule.default ?? ReactModule;
          let ReactDOM = await import(`${esmOrigin}/react-dom@18.3.1/client`);
          let container = document.createElement("div");
          document.body.append(container);
          let root = ReactDOM.createRoot(container);
          root.render(React.createElement("button", { type: "button" }, "Hello React"));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          if (container.textContent !== "Hello React") {
            throw new Error(`React render failed: ${container.textContent ?? ""}`);
          }
          root.unmount();
          return ["createRoot", "render"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Preact renders DOM in Chromium",
        expect: "module",
        features: ["runtime", "preact", "render"],
        package: "preact",
        path: "/__runtime/preact-render",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { h, render } = await import(`${esmOrigin}/preact@10.26.4`);
          let container = document.createElement("div");
          document.body.append(container);
          render(h("button", { type: "button" }, "Hello Preact"), container);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          if (container.textContent !== "Hello Preact") {
            throw new Error(`Preact render failed: ${container.textContent ?? ""}`);
          }
          render(null, container);
          return ["h", "render"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "CommonJS lodash subpath executes in the browser",
        expect: "module",
        features: ["runtime", "cjs"],
        package: "lodash",
        path: "/__runtime/lodash-cjs",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let module = await import(`${esmOrigin}/lodash@4.17.21/map`);
          let map = module.default;
          let result = map([1, 2, 3], (value) => value * 2);
          if (result.join(",") !== "2,4,6") {
            throw new Error(`Unexpected lodash result: ${result.join(",")}`);
          }
          return ["default", "map"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Browser package API executes in Chromium",
        expect: "module",
        features: ["runtime", "browser"],
        package: "uuid",
        path: "/__runtime/uuid-browser",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { validate, v4 } = await import(`${esmOrigin}/uuid@14.0.0`);
          let id = v4();
          if (!validate(id)) {
            throw new Error(`Invalid UUID generated: ${id}`);
          }
          return ["v4", "validate"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Vue mounts a browser app",
        expect: "module",
        features: ["runtime", "vue", "render"],
        package: "vue",
        path: "/__runtime/vue-mount",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { createApp, h } = await import(`${esmOrigin}/vue@3.5.13`);
          let container = document.createElement("div");
          document.body.append(container);
          let app = createApp({
            render: () => h("button", { type: "button" }, "Hello Vue"),
          });
          app.mount(container);
          await new Promise((resolve) => requestAnimationFrame(resolve));
          if (container.textContent !== "Hello Vue") {
            throw new Error(`Vue mount failed: ${container.textContent ?? ""}`);
          }
          app.unmount();
          return ["createApp", "h", "mount"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "D3 scale computes browser values",
        expect: "module",
        features: ["runtime", "d3"],
        package: "d3-scale",
        path: "/__runtime/d3-scale",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { scaleLinear } = await import(`${esmOrigin}/d3-scale@4.0.2`);
          let scale = scaleLinear([0, 10], [0, 100]);
          let value = scale(2.5);
          if (value !== 25) {
            throw new Error(`Unexpected d3-scale result: ${value}`);
          }
          return ["scaleLinear"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "RxJS observable emits transformed values",
        expect: "module",
        features: ["runtime", "rxjs"],
        package: "rxjs",
        path: "/__runtime/rxjs-observable",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { firstValueFrom, map, of } = await import(`${esmOrigin}/rxjs@7.8.1`);
          let value = await firstValueFrom(of(7).pipe(map((number: number) => number * 6)));
          if (value !== 42) {
            throw new Error(`Unexpected RxJS result: ${value}`);
          }
          return ["firstValueFrom", "map", "of"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Yup validates browser data",
        expect: "module",
        features: ["runtime", "validation"],
        package: "yup",
        path: "/__runtime/yup-validation",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let yup = await import(`${esmOrigin}/yup@1.6.1`);
          let schema = yup.object({
            name: yup.string().required(),
            count: yup.number().min(2).required(),
          });
          let value = await schema.validate({ name: "modules", count: 3 });
          if (value.name !== "modules" || value.count !== 3) {
            throw new Error(`Unexpected Yup validation result: ${JSON.stringify(value)}`);
          }
          return ["object", "string", "number", "validate"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "GraphQL parses a document in Chromium",
        expect: "module",
        features: ["runtime", "graphql"],
        package: "graphql",
        path: "/__runtime/graphql-parse",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { parse } = await import(`${esmOrigin}/graphql@16.10.0`);
          let document = parse("query SmokeTest { viewer { id } }");
          let operation = document.definitions[0];
          if (operation.kind !== "OperationDefinition" || operation.operation !== "query") {
            throw new Error(`Unexpected GraphQL parse result: ${operation.kind}`);
          }
          return ["parse"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Buffer polyfill encodes browser bytes",
        expect: "module",
        features: ["runtime", "node-polyfill"],
        package: "buffer",
        path: "/__runtime/buffer-polyfill",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let { Buffer } = await import(`${esmOrigin}/buffer@6.0.3`);
          let encoded = Buffer.from("esm.unpkg", "utf8").toString("base64");
          if (encoded !== "ZXNtLnVucGtn") {
            throw new Error(`Unexpected Buffer result: ${encoded}`);
          }
          return ["Buffer"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Import-map externalization resolves bare imports",
        expect: "module",
        features: ["runtime", "external", "import-map"],
        package: "react-dom",
        path: "/__runtime/import-map-external",
      },
      run: async (page, origin) => {
        await page.setContent(`<!doctype html><html><head><script type="importmap">${JSON.stringify({
          imports: {
            react: `${origin}/react@18.3.1`,
          },
        })}</script></head><body></body></html>`);

        return page.evaluate(async (moduleUrl) => {
          let ReactDOM = await import(moduleUrl);
          if (typeof ReactDOM.createRoot !== "function") {
            throw new Error("Externalized react-dom/client did not expose createRoot");
          }
          return ["createRoot", "importmap"];
        }, `${origin}/react-dom@18.3.1/client?external=react`);
      },
    },
    {
      case: {
        category: "runtime",
        description: "CSS module exports a constructable stylesheet",
        expect: "module",
        features: ["runtime", "css", "css-module"],
        package: "react-toastify",
        path: "/__runtime/css-module",
      },
      run: (page, origin) =>
        page.evaluate(async (esmOrigin) => {
          let module = await import(`${esmOrigin}/react-toastify@11.0.5/dist/ReactToastify.css?module`);
          if (!(module.default instanceof CSSStyleSheet)) {
            throw new Error("CSS module did not export a CSSStyleSheet");
          }
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, module.default];
          if (!document.adoptedStyleSheets.includes(module.default)) {
            throw new Error("CSSStyleSheet was not adopted by the document");
          }
          return ["CSSStyleSheet", "adoptedStyleSheets"];
        }, origin),
    },
    {
      case: {
        category: "runtime",
        description: "Worker wrapper starts a module worker",
        expect: "module",
        features: ["runtime", "worker"],
        package: "uuid",
        path: "/__runtime/worker-wrapper",
      },
      run: async (page, origin) => {
        await page.goto(`${origin}/_health`);
        return page.evaluate(async (esmOrigin) => {
          let { default: createWorker } = await import(`${esmOrigin}/uuid@14.0.0?worker`);
          let worker = createWorker({ name: "esm-unpkg-browser-smoke" });
          try {
            await new Promise<void>((resolve, reject) => {
              let timeout = setTimeout(resolve, 500);
              worker.addEventListener("error", (event) => {
                clearTimeout(timeout);
                reject(new Error(event.message || "Worker failed to start"));
              }, { once: true });
            });
          } finally {
            worker.terminate();
          }
          return ["Worker", "createWorker"];
        }, origin);
      },
    },
    {
      case: {
        category: "runtime",
        description: "Inline TSX helper transforms browser scripts",
        expect: "module",
        features: ["runtime", "tsx"],
        path: "/__runtime/inline-tsx-helper",
      },
      run: async (page, origin, runOrigin) => {
        await page.setContent([
          "<!doctype html><html><body>",
          '<div id="root"></div>',
          '<script type="text/ts">window.__esmUnpkgInlineTsValue = 21 as number;</script>',
          '<script type="text/tsx" data-jsx="automatic">',
          '  import { createRoot } from "react-dom/client";',
          '  createRoot(document.getElementById("root")!).render(<button>Inline TSX</button>);',
          "</script>",
          "</body></html>",
        ].join(""));
        await page.addScriptTag({
          type: "module",
          url: `${runOrigin}/run?browser-smoke=${Date.now()}`,
        });
        await page.waitForFunction(() => {
          return globalThis.__esmUnpkgInlineTsValue === 21 && document.getElementById("root")?.textContent === "Inline TSX";
        });
        return ["run", "ts", "tsx", "transform"];
      },
    },
  ];
}

async function loadCorpus(corpusPath: string): Promise<CompatCorpus> {
  let text = await readFile(corpusPath, "utf8");
  let value = JSON.parse(text) as unknown;
  if (!isCompatCorpus(value)) {
    throw new Error(`Invalid compatibility corpus: ${corpusPath}`);
  }

  return value;
}

function printReport(report: BrowserSmokeReport, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  let comparison = report.baselineOrigin == null ? "" : ` versus ${report.baselineOrigin}`;
  console.log(`${report.corpus}: ${report.passed}/${report.total} browser smoke cases passed against ${report.origin}${comparison}`);
  for (let result of report.results) {
    let marker = result.error == null ? "PASS" : "FAIL";
    console.log(`${marker} ${result.case.description}: ${result.requestCount} requests, ${result.transferredBytes} bytes`);
    if (result.error != null) {
      console.log(`  ${result.error}`);
    }
  }
}

function isCompatCorpus(value: unknown): value is CompatCorpus {
  if (typeof value !== "object" || value == null) return false;
  let corpus = value as { cases?: unknown };
  return Array.isArray(corpus.cases) && corpus.cases.every(isCompatCase);
}

function isCompatCase(value: unknown): value is CompatCase {
  if (typeof value !== "object" || value == null) return false;
  let compatCase = value as Record<string, unknown>;
  return typeof compatCase.description === "string" && typeof compatCase.path === "string";
}

function parseArgs(args: string[]): {
  baselineOrigin: string | null;
  corpusPath: string;
  dryRun: boolean;
  jsonOutput: boolean;
  limit: number;
  origin: string | null;
  packageName: string | null;
  runOrigin: string | null;
} {
  let baselineOrigin: string | null = null;
  let corpusPath = "scripts/esm-compat-corpus.seed.json";
  let dryRun = false;
  let jsonOutput = false;
  let limit = 10;
  let origin: string | null = null;
  let packageName: string | null = null;
  let runOrigin: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    let arg = args[index];
    if (arg === "--corpus") {
      corpusPath = args[index + 1] ?? corpusPath;
      index += 1;
    } else if (arg.startsWith("--corpus=")) {
      corpusPath = arg.slice("--corpus=".length);
    } else if (arg === "--baseline-origin") {
      baselineOrigin = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--baseline-origin=")) {
      baselineOrigin = arg.slice("--baseline-origin=".length);
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (arg === "--limit") {
      limit = Number(args[index + 1] ?? limit);
      index += 1;
    } else if (arg.startsWith("--limit=")) {
      limit = Number(arg.slice("--limit=".length));
    } else if (arg === "--origin") {
      origin = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--origin=")) {
      origin = arg.slice("--origin=".length);
    } else if (arg === "--run-origin") {
      runOrigin = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--run-origin=")) {
      runOrigin = arg.slice("--run-origin=".length);
    } else if (arg === "--package") {
      packageName = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--package=")) {
      packageName = arg.slice("--package=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    baselineOrigin,
    corpusPath,
    dryRun,
    jsonOutput,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
    origin,
    packageName,
    runOrigin,
  };
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
