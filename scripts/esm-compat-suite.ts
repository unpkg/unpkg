#!/usr/bin/env bun

import { readFile } from "node:fs/promises";

import { compareFinalPathAndQuery, comparePreservedQueryParamsAcrossRedirects } from "./esm-compat-redirects.ts";

type ExpectedBehavior = "module" | "javascript" | "json" | "css" | "typescript" | "redirect" | "diagnostic";
type FailureCategory =
  | "content-type-mismatch"
  | "diagnostic"
  | "fetch-error"
  | "ok-mismatch"
  | "redirect-mismatch"
  | "server-error"
  | "status-mismatch"
  | "timeout"
  | "unexpected-failure"
  | "unexpected-success";
type OutputMode = "json" | "ndjson" | "text";

export interface CompatCase {
  category?: string;
  contentParity?: "expected-only";
  description: string;
  expect: ExpectedBehavior;
  exportParity?: "expected-only";
  features?: string[];
  package?: string;
  path: string;
  preserveRedirectQuery?: string[];
  redirectParity?: "final-path-and-query";
}

interface CompatCorpus {
  cases: CompatCase[];
  description?: string;
  name?: string;
}

interface RedirectHop {
  location: string | null;
  status: number;
  url: string;
}

export interface FetchSummary {
  contentLength: number;
  contentType: string | null;
  diagnosticCode: string | null;
  durationMs: number;
  executableModule: boolean;
  finalUrl: string;
  headers: Record<string, string>;
  ok: boolean;
  redirectChain: RedirectHop[];
  status: number;
}

interface CompatResult {
  case: CompatCase;
  index: number;
  esmSh: FetchSummary;
  esmUnpkg: FetchSummary;
  failureCategory: FailureCategory | null;
  passed: boolean;
  reason: string | null;
  retryCount: number;
}

interface CompatReport {
  comparedAt: string;
  corpus: {
    caseCount: number;
    description?: string;
    name: string;
  };
  origins: {
    esmSh: string;
    esmUnpkg: string;
  };
  results: CompatResult[];
  summary: CompatSummary;
}

interface CompatSummary {
  byCategory: Record<string, { failed: number; passed: number; total: number }>;
  byFailureCategory: Record<string, number>;
  failed: number;
  passed: number;
  total: number;
}

interface RunOptions {
  autoRestartLocalServices: boolean;
  concurrency: number;
  skipBaseline: boolean;
  timeoutMs: number;
}

interface ParsedArgs extends RunOptions {
  corpusPath: string | null;
  dryRun: boolean;
  outputMode: OutputMode;
}

interface NdjsonStartEvent {
  comparedAt: string;
  corpus: CompatReport["corpus"];
  event: "start";
  origins: CompatReport["origins"];
  total: number;
}

interface NdjsonResultEvent {
  event: "result";
  progress: {
    completed: number;
    failed: number;
    passed: number;
    total: number;
  };
  result: CompatResult;
}

interface NdjsonServiceEvent {
  action: "health-check" | "restart" | "restart-failed" | "restart-skipped";
  event: "service";
  message: string;
  service: string;
  url: string;
}

interface NdjsonSummaryEvent {
  event: "summary";
  report: CompatReport;
}

interface Reporter {
  result(result: CompatResult, summary: CompatSummary): void;
  service(event: Omit<NdjsonServiceEvent, "event">): void;
  start(report: Omit<CompatReport, "results" | "summary">, total: number): void;
  summary(report: CompatReport): void;
}

interface ManagedService {
  command: string[];
  healthUrl: string;
  name: string;
  origin: string;
  port: number | null;
  process: Bun.Subprocess | null;
}

const defaultConcurrency = 6;
const defaultCorpusPath = "scripts/esm-compat-corpus.seed.json";
const defaultTimeoutMs = 15_000;
const maxFetchRetries = 1;

let esmShOrigin = stripTrailingSlash(process.env.ESM_SH_ORIGIN ?? "https://esm.sh");
let esmUnpkgOrigin = stripTrailingSlash(process.env.ESM_UNPKG_ORIGIN ?? "https://esm.unpkg.com");
let filesOrigin = stripTrailingSlash(process.env.ESM_FILES_ORIGIN ?? "http://localhost:4000");

if (import.meta.main) {
  await main();
}

async function main(): Promise<void> {
  let options = parseArgs(process.argv.slice(2));
  let corpus = await loadCorpus(options.corpusPath);
  let reportBase: Omit<CompatReport, "results" | "summary"> = {
    comparedAt: new Date().toISOString(),
    corpus: {
      caseCount: corpus.cases.length,
      description: corpus.description,
      name: corpus.name ?? (options.corpusPath == null ? "default" : options.corpusPath),
    },
    origins: {
      esmSh: esmShOrigin,
      esmUnpkg: esmUnpkgOrigin,
    },
  };
  let reporter = createReporter(options.outputMode);
  reporter.start(reportBase, corpus.cases.length);
  let results = options.dryRun
    ? corpus.cases.map((compatCase, index) => createDryRunResult(compatCase, index))
    : await runCases(corpus.cases, options, reporter);
  if (options.dryRun) {
    let dryRunSummary = createEmptySummary(results.length);
    for (let result of results) {
      addResultToSummary(dryRunSummary, result);
      reporter.result(result, dryRunSummary);
    }
  }
  let report: CompatReport = {
    ...reportBase,
    results,
    summary: summarizeResults(results),
  };

  reporter.summary(report);

  if (!options.dryRun && report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function loadCorpus(corpusPath: string | null): Promise<CompatCorpus> {
  if (corpusPath == null) {
    return loadCorpus(defaultCorpusPath);
  }

  let text = await readFile(corpusPath, "utf8");
  let value = JSON.parse(text) as unknown;
  if (!isCompatCorpus(value)) {
    throw new Error(`Invalid compatibility corpus: ${corpusPath}`);
  }

  return value;
}

async function runCases(cases: CompatCase[], options: RunOptions, reporter: Reporter): Promise<CompatResult[]> {
  let localServices = createLocalServices(options, reporter);
  await localServices.ensureHealthyBeforeRun();

  let results: CompatResult[] = [];
  let summary = createEmptySummary(cases.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < cases.length) {
      let index = nextIndex;
      nextIndex += 1;
      let compatCase = cases[index];
      if (compatCase == null) {
        continue;
      }

      let result = await runCaseWithRecovery(compatCase, index, options, localServices);
      results.push(result);
      addResultToSummary(summary, result);
      reporter.result(result, summary);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, cases.length) }, async () => {
      await worker();
    })
  );

  return results.sort((left, right) => left.index - right.index);
}

async function runCaseWithRecovery(
  compatCase: CompatCase,
  index: number,
  options: RunOptions,
  localServices: ReturnType<typeof createLocalServices>
): Promise<CompatResult> {
  let result = await runCase(compatCase, index, options, 0);
  if (!shouldRetryWithServiceRecovery(result, options)) {
    return result;
  }

  let recovered = await localServices.recoverFrom(result);
  return recovered ? await runCase(compatCase, index, options, 1) : result;
}

async function runCase(
  compatCase: CompatCase,
  index: number,
  options: RunOptions,
  retryCount: number
): Promise<CompatResult> {
  let [esmSh, esmUnpkg] = await Promise.all([
    options.skipBaseline
      ? Promise.resolve(unavailableSummary(new URL(compatCase.path, esmShOrigin).toString()))
      : summarizeFetch(new URL(compatCase.path, esmShOrigin), options),
    summarizeFetch(new URL(compatCase.path, esmUnpkgOrigin), options),
  ]);
  let comparison = compareSummaries(compatCase, esmSh, esmUnpkg);

  return {
    case: compatCase,
    index,
    esmSh,
    esmUnpkg,
    failureCategory: comparison.failureCategory,
    passed: comparison.reason == null,
    reason: comparison.reason,
    retryCount,
  };
}

async function summarizeFetch(url: URL, options: RunOptions): Promise<FetchSummary> {
  let controller = new AbortController();
  return withTimeout(summarizeFetchInner(url, controller.signal), controller, url, options.timeoutMs);
}

async function summarizeFetchInner(url: URL, signal: AbortSignal): Promise<FetchSummary> {
  let startedAt = performance.now();
  let currentUrl = url;
  let redirectChain: RedirectHop[] = [];
  let response: Response;

  try {
    for (let index = 0; index < 10; index += 1) {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal,
        headers: {
          Accept: "application/javascript, application/json;q=0.9, */*;q=0.1",
        },
      });

      if (!isRedirect(response.status)) {
        return await summarizeResponse(response, currentUrl, redirectChain, startedAt);
      }

      let location = response.headers.get("Location");
      redirectChain.push({
        location,
        status: response.status,
        url: currentUrl.toString(),
      });
      if (location == null) {
        return await summarizeResponse(response, currentUrl, redirectChain, startedAt);
      }

      currentUrl = new URL(location, currentUrl);
    }
  } catch {
    return {
      contentLength: 0,
      contentType: null,
      diagnosticCode: "FETCH_ERROR",
      durationMs: Math.round(performance.now() - startedAt),
      executableModule: false,
      finalUrl: currentUrl.toString(),
      headers: {},
      ok: false,
      redirectChain,
      status: 0,
    };
  }

  return {
    contentLength: 0,
    contentType: null,
    diagnosticCode: "REDIRECT_LIMIT",
    durationMs: Math.round(performance.now() - startedAt),
    executableModule: false,
    finalUrl: currentUrl.toString(),
    headers: {},
    ok: false,
    redirectChain,
    status: 0,
  };
}

function withTimeout(
  promise: Promise<FetchSummary>,
  controller: AbortController,
  url: URL,
  timeoutMs: number
): Promise<FetchSummary> {
  let startedAt = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  let timeoutPromise = new Promise<FetchSummary>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve({
        contentLength: 0,
        contentType: null,
        diagnosticCode: "TIMEOUT",
        durationMs: Math.round(performance.now() - startedAt),
        executableModule: false,
        finalUrl: url.toString(),
        headers: {},
        ok: false,
        redirectChain: [],
        status: 0,
      });
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout != null) {
      clearTimeout(timeout);
    }
  });
}

async function summarizeResponse(
  response: Response,
  finalUrl: URL,
  redirectChain: RedirectHop[],
  startedAt: number
): Promise<FetchSummary> {
  let bytes = new Uint8Array(await response.arrayBuffer());
  let contentType = response.headers.get("Content-Type");
  let text = looksTextual(contentType) ? new TextDecoder().decode(bytes) : "";

  return {
    contentLength: bytes.byteLength,
    contentType,
    diagnosticCode: readDiagnosticCode(text, contentType),
    durationMs: Math.round(performance.now() - startedAt),
    executableModule: isExecutableModule(text, contentType),
    finalUrl: finalUrl.toString(),
    headers: collectRelevantHeaders(response.headers),
    ok: response.ok,
    redirectChain,
    status: response.status,
  };
}

export function compareSummaries(
  compatCase: CompatCase,
  esmSh: FetchSummary,
  esmUnpkg: FetchSummary
): { failureCategory: FailureCategory | null; reason: string | null } {
  if (esmUnpkg.diagnosticCode === "FETCH_ERROR") {
    return {
      failureCategory: "fetch-error",
      reason: `fetch error: esm.sh=${esmSh.status}, esm.unpkg.com=${esmUnpkg.status}`,
    };
  }

  if (esmUnpkg.diagnosticCode === "TIMEOUT") {
    return {
      failureCategory: "timeout",
      reason: `request timed out: esm.sh=${esmSh.status}, esm.unpkg.com=${esmUnpkg.status}`,
    };
  }

  if (esmUnpkg.status >= 500) {
    return {
      failureCategory: "server-error",
      reason: `server error: esm.sh=${esmSh.status}, esm.unpkg.com=${esmUnpkg.status}`,
    };
  }

  if (compatCase.preserveRedirectQuery != null) {
    if (esmUnpkg.redirectChain.length === 0) {
      return {
        failureCategory: "redirect-mismatch",
        reason: "expected esm.unpkg.com redirect chain for query preservation check",
      };
    }

    let queryMismatch = comparePreservedQueryParamsAcrossRedirects(
      new URL(compatCase.path, esmUnpkg.redirectChain[0]?.url ?? esmUnpkg.finalUrl).toString(),
      esmUnpkg.redirectChain,
      esmUnpkg.finalUrl,
      compatCase.preserveRedirectQuery
    );
    if (queryMismatch != null) {
      return { failureCategory: "redirect-mismatch", reason: queryMismatch };
    }
  }

  if (esmSh.diagnosticCode === "FETCH_ERROR" || esmSh.diagnosticCode === "TIMEOUT" || esmSh.status >= 500) {
    return validateExpectedBehavior(compatCase, esmUnpkg);
  }

  if (compatCase.expect === "diagnostic") {
    return validateExpectedBehavior(compatCase, esmUnpkg);
  }

  if (
    compatCase.redirectParity === "final-path-and-query" &&
    esmSh.diagnosticCode !== "FETCH_ERROR"
  ) {
    if (esmSh.redirectChain.length === 0 || esmUnpkg.redirectChain.length === 0) {
      return {
        failureCategory: "redirect-mismatch",
        reason: `expected redirect chains for final target comparison: esm.sh=${esmSh.redirectChain.length}, esm.unpkg.com=${esmUnpkg.redirectChain.length}`,
      };
    }

    let redirectMismatch = compareFinalPathAndQuery(esmSh.finalUrl, esmUnpkg.finalUrl);
    if (redirectMismatch != null) {
      return { failureCategory: "redirect-mismatch", reason: redirectMismatch };
    }
  }

  if (esmSh.ok !== esmUnpkg.ok) {
    return {
      failureCategory: esmUnpkg.diagnosticCode == null ? "ok-mismatch" : "diagnostic",
      reason: `ok mismatch: esm.sh=${esmSh.status}, esm.unpkg.com=${esmUnpkg.status}`,
    };
  }

  if (esmSh.status !== esmUnpkg.status) {
    return {
      failureCategory: "status-mismatch",
      reason: `status mismatch: esm.sh=${esmSh.status}, esm.unpkg.com=${esmUnpkg.status}`,
    };
  }

  if (!esmSh.ok && !esmUnpkg.ok) {
    return validateExpectedBehavior(compatCase, esmUnpkg);
  }

  let esmShContentKind = getContentKind(esmSh.contentType);
  let esmUnpkgContentKind = getContentKind(esmUnpkg.contentType);
  if (compatCase.contentParity !== "expected-only" && esmShContentKind !== esmUnpkgContentKind) {
    return {
      failureCategory: "content-type-mismatch",
      reason: `response kind mismatch: esm.sh=${esmShContentKind}, esm.unpkg.com=${esmUnpkgContentKind}`,
    };
  }

  return validateExpectedBehavior(compatCase, esmUnpkg);
}

function validateExpectedBehavior(
  compatCase: CompatCase,
  esmUnpkg: FetchSummary
): { failureCategory: FailureCategory | null; reason: string | null } {
  if (compatCase.expect === "diagnostic") {
    return esmUnpkg.status >= 400
      ? { failureCategory: null, reason: null }
      : {
          failureCategory: "unexpected-success",
          reason: `expected esm.unpkg.com diagnostic, got ${esmUnpkg.status}`,
        };
  }

  if (!esmUnpkg.ok) {
    return {
      failureCategory: "unexpected-failure",
      reason: `expected successful ${compatCase.expect} response from esm.unpkg.com, got ${esmUnpkg.status}`,
    };
  }

  if (compatCase.expect === "json" && !isJson(esmUnpkg.contentType)) {
    return {
      failureCategory: "content-type-mismatch",
      reason: `expected JSON from esm.unpkg.com, got ${esmUnpkg.contentType ?? "missing content type"}`,
    };
  }

  if (compatCase.expect === "css" && !isCss(esmUnpkg.contentType)) {
    return {
      failureCategory: "content-type-mismatch",
      reason: `expected CSS from esm.unpkg.com, got ${esmUnpkg.contentType ?? "missing content type"}`,
    };
  }

  if (compatCase.expect === "typescript" && !isTypeScript(esmUnpkg.contentType)) {
    return {
      failureCategory: "content-type-mismatch",
      reason: `expected TypeScript from esm.unpkg.com, got ${esmUnpkg.contentType ?? "missing content type"}`,
    };
  }

  if (compatCase.expect === "javascript" && !isJavaScript(esmUnpkg.contentType)) {
    return {
      failureCategory: "content-type-mismatch",
      reason: `expected JavaScript from esm.unpkg.com, got ${esmUnpkg.contentType ?? "missing content type"}`,
    };
  }

  if (compatCase.expect === "module" && !isJavaScript(esmUnpkg.contentType)) {
    return {
      failureCategory: "content-type-mismatch",
      reason: `expected JavaScript from esm.unpkg.com, got ${esmUnpkg.contentType ?? "missing content type"}`,
    };
  }

  if (compatCase.expect === "module" && !esmUnpkg.executableModule) {
    return {
      failureCategory: "content-type-mismatch",
      reason: "expected esm.unpkg.com response to look like an executable module",
    };
  }

  if (compatCase.expect === "redirect" && esmUnpkg.redirectChain.length === 0) {
    return {
      failureCategory: "redirect-mismatch",
      reason: "expected esm.unpkg.com redirect chain",
    };
  }

  return { failureCategory: null, reason: null };
}

function createEmptySummary(total: number): CompatSummary {
  return {
    byCategory: {},
    byFailureCategory: {},
    failed: 0,
    passed: 0,
    total,
  };
}

function summarizeResults(results: CompatResult[]): CompatSummary {
  let summary = createEmptySummary(results.length);
  for (let result of results) {
    addResultToSummary(summary, result);
  }

  return summary;
}

function addResultToSummary(summary: CompatSummary, result: CompatResult): void {
  if (result.passed) {
    summary.passed += 1;
  } else {
    summary.failed += 1;
  }

  let category = result.case.category ?? "uncategorized";
  let categorySummary = summary.byCategory[category] ?? { failed: 0, passed: 0, total: 0 };
  categorySummary.total += 1;
  if (result.passed) {
    categorySummary.passed += 1;
  } else {
    categorySummary.failed += 1;
  }
  summary.byCategory[category] = categorySummary;

  if (result.failureCategory != null) {
    summary.byFailureCategory[result.failureCategory] =
      (summary.byFailureCategory[result.failureCategory] ?? 0) + 1;
  }
}

function createDryRunResult(compatCase: CompatCase, index: number): CompatResult {
  return {
    case: compatCase,
    index,
    esmSh: pendingSummary(new URL(compatCase.path, esmShOrigin).toString()),
    esmUnpkg: pendingSummary(new URL(compatCase.path, esmUnpkgOrigin).toString()),
    failureCategory: null,
    passed: true,
    reason: null,
    retryCount: 0,
  };
}

function pendingSummary(finalUrl: string): FetchSummary {
  return {
    contentLength: 0,
    contentType: null,
    diagnosticCode: null,
    durationMs: 0,
    executableModule: false,
    finalUrl,
    headers: {},
    ok: true,
    redirectChain: [],
    status: 0,
  };
}

function unavailableSummary(finalUrl: string): FetchSummary {
  return {
    ...pendingSummary(finalUrl),
    diagnosticCode: "FETCH_ERROR",
    ok: false,
  };
}

function createReporter(outputMode: OutputMode): Reporter {
  if (outputMode === "ndjson") {
    return {
      result(result, summary) {
        printNdjson({
          event: "result",
          progress: {
            completed: summary.passed + summary.failed,
            failed: summary.failed,
            passed: summary.passed,
            total: summary.total,
          },
          result,
        } satisfies NdjsonResultEvent);
      },
      service(event) {
        printNdjson({ event: "service", ...event } satisfies NdjsonServiceEvent);
      },
      start(report, total) {
        printNdjson({ event: "start", total, ...report } satisfies NdjsonStartEvent);
      },
      summary(report) {
        printNdjson({ event: "summary", report } satisfies NdjsonSummaryEvent);
      },
    };
  }

  return {
    result() {},
    service(event) {
      if (event.action === "restart" || event.action === "restart-failed") {
        console.error(`${event.service}: ${event.message}`);
      }
    },
    start() {},
    summary(report) {
      printReport(report, outputMode);
    },
  };
}

function printNdjson(value: NdjsonStartEvent | NdjsonResultEvent | NdjsonServiceEvent | NdjsonSummaryEvent): void {
  console.log(JSON.stringify(value));
}

function printReport(report: CompatReport, outputMode: OutputMode): void {
  if (outputMode === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `${report.corpus.name}: ${report.summary.passed}/${report.summary.total} passed against ${report.origins.esmUnpkg}`
  );

  for (let result of report.results) {
    let marker = result.passed ? "PASS" : "FAIL";
    let diagnostic = result.esmUnpkg.diagnosticCode == null ? "" : ` (${result.esmUnpkg.diagnosticCode})`;
    let category = result.case.category == null ? "" : `[${result.case.category}] `;
    console.log(`${marker} ${category}${result.case.description}: ${result.esmUnpkg.status}${diagnostic} ${result.case.path}`);
    if (result.reason != null) {
      console.log(`  ${result.reason}`);
    }
  }

  if (report.summary.failed > 0) {
    console.log("Failure categories:");
    for (let [category, count] of Object.entries(report.summary.byFailureCategory)) {
      console.log(`  ${category}: ${count}`);
    }
  }
}

function readDiagnosticCode(text: string, contentType: string | null): string | null {
  if (!isJson(contentType)) {
    return null;
  }

  try {
    let value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value == null) {
      return null;
    }

    let error = (value as { error?: unknown }).error;
    if (typeof error !== "object" || error == null) {
      return null;
    }

    let code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

function isCompatCorpus(value: unknown): value is CompatCorpus {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  let corpus = value as { cases?: unknown };
  return Array.isArray(corpus.cases) && corpus.cases.every(isCompatCase);
}

export function isCompatCase(value: unknown): value is CompatCase {
  if (typeof value !== "object" || value == null) {
    return false;
  }

  let compatCase = value as Record<string, unknown>;
  let preserveRedirectQuery = compatCase.preserveRedirectQuery;
  let redirectParity = compatCase.redirectParity;
  let contentParity = compatCase.contentParity;
  let exportParity = compatCase.exportParity;
  return (
    typeof compatCase.description === "string" &&
    typeof compatCase.path === "string" &&
    (preserveRedirectQuery == null ||
      (Array.isArray(preserveRedirectQuery) &&
        preserveRedirectQuery.length > 0 &&
        preserveRedirectQuery.every((name) => typeof name === "string" && name !== ""))) &&
    (redirectParity == null || redirectParity === "final-path-and-query") &&
    (contentParity == null || contentParity === "expected-only") &&
    (exportParity == null || exportParity === "expected-only") &&
    (compatCase.expect === "module" ||
      compatCase.expect === "javascript" ||
      compatCase.expect === "json" ||
      compatCase.expect === "css" ||
      compatCase.expect === "typescript" ||
      compatCase.expect === "redirect" ||
      compatCase.expect === "diagnostic")
  );
}

function collectRelevantHeaders(headers: Headers): Record<string, string> {
  let result: Record<string, string> = {};
  for (let name of [
    "Access-Control-Allow-Origin",
    "Cache-Control",
    "Content-Digest",
    "Content-Length",
    "Content-Type",
    "Cross-Origin-Resource-Policy",
    "Location",
    "X-TypeScript-Types",
    "X-UNPKG-Build-Key",
    "X-UNPKG-Transformer",
  ]) {
    let value = headers.get(name);
    if (value != null) {
      result[name] = value;
    }
  }

  return result;
}

function isExecutableModule(text: string, contentType: string | null): boolean {
  if (!isJavaScript(contentType)) {
    return false;
  }

  return /\b(?:import|export)\b/.test(text);
}

function looksTextual(contentType: string | null): boolean {
  return contentType == null || /(?:json|javascript|ecmascript|text)/.test(contentType);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isJson(contentType: string | null): boolean {
  return contentType?.includes("application/json") ?? false;
}

function isTypeScript(contentType: string | null): boolean {
  return contentType?.includes("application/typescript") ?? false;
}

function isCss(contentType: string | null): boolean {
  return contentType?.includes("text/css") ?? false;
}

function isJavaScript(contentType: string | null): boolean {
  return contentType?.includes("javascript") || contentType?.includes("ecmascript") || false;
}

function getContentKind(contentType: string | null): "css" | "javascript" | "json" | "typescript" | "other" {
  if (isCss(contentType)) return "css";
  if (isJavaScript(contentType)) return "javascript";
  if (isJson(contentType)) return "json";
  if (isTypeScript(contentType)) return "typescript";
  return "other";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function createLocalServices(options: RunOptions, reporter: Reporter) {
  let esmUnpkgService = createManagedService("esm.unpkg", esmUnpkgOrigin, "/_health", [
    "pnpm",
    "--filter",
    "unpkg-esm",
    "exec",
    "wrangler",
    "dev",
    "--env",
    "dev",
    "--port",
    "3002",
    "--ip",
    "127.0.0.1",
  ]);
  let services = [
    createManagedService("esm.sh", esmShOrigin, "/react@18.3.1", ["pnpm", "vendor:esm-sh"]),
    esmUnpkgService,
    esmUnpkgService == null
      ? null
      : createManagedService("unpkg-files", filesOrigin, "/_health", ["pnpm", "--filter", "unpkg-files", "dev"]),
  ].filter((service): service is ManagedService => service != null);
  let restarts = new Map<string, Promise<boolean>>();

  async function ensureHealthyBeforeRun(): Promise<void> {
    if (!options.autoRestartLocalServices) {
      return;
    }

    for (let service of services) {
      if (!(await isServiceHealthy(service))) {
        await restartService(service, "service was not reachable before the corpus run");
      }
    }
  }

  async function recoverFrom(result: CompatResult): Promise<boolean> {
    if (!options.autoRestartLocalServices) {
      return false;
    }

    let recovered = false;
    let impactedServices = getImpactedServices(result);
    for (let service of impactedServices) {
      reporter.service({
        action: "health-check",
        message: "checking service after a fetch error",
        service: service.name,
        url: service.healthUrl,
      });

      if (!(await isServiceHealthy(service))) {
        recovered = (await restartService(service, "service became unreachable during the corpus run")) || recovered;
      }
    }

    return recovered;
  }

  function getImpactedServices(result: CompatResult): ManagedService[] {
    let impacted = new Set<ManagedService>();
    let esmUnpkg = services.find((service) => service.name === "esm.unpkg");
    let unpkgFiles = services.find((service) => service.name === "unpkg-files");
    let esmSh = services.find((service) => service.name === "esm.sh");

    if (result.esmUnpkg.diagnosticCode === "FETCH_ERROR") {
      if (esmUnpkg != null) {
        impacted.add(esmUnpkg);
      }
      if (unpkgFiles != null) {
        impacted.add(unpkgFiles);
      }
    }

    if (!options.skipBaseline && result.esmSh.diagnosticCode === "FETCH_ERROR" && esmSh != null) {
      impacted.add(esmSh);
    }

    return [...impacted];
  }

  async function restartService(service: ManagedService, reason: string): Promise<boolean> {
    let existingRestart = restarts.get(service.name);
    if (existingRestart != null) {
      return existingRestart;
    }

    let restart = restartServiceInner(service, reason).finally(() => {
      restarts.delete(service.name);
    });
    restarts.set(service.name, restart);
    return restart;
  }

  async function restartServiceInner(service: ManagedService, reason: string): Promise<boolean> {
    reporter.service({
      action: "restart",
      message: reason,
      service: service.name,
      url: service.healthUrl,
    });

    service.process?.kill();
    service.process = null;

    if (service.port != null) {
      await killLocalPort(service.port);
    }

    service.process = Bun.spawn(service.command, {
      cwd: process.cwd(),
      env: process.env,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    });
    unrefProcess(service.process);

    let healthy = await waitForService(service, options.timeoutMs);
    if (!healthy) {
      reporter.service({
        action: "restart-failed",
        message: `service did not become healthy after running ${service.command.join(" ")}`,
        service: service.name,
        url: service.healthUrl,
      });
    }

    return healthy;
  }

  return { ensureHealthyBeforeRun, recoverFrom };
}

function unrefProcess(process: Bun.Subprocess): void {
  let maybeUnref = process as Bun.Subprocess & { unref?: () => void };
  maybeUnref.unref?.();
}

function createManagedService(
  name: string,
  origin: string,
  healthPath: string,
  command: string[]
): ManagedService | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }

  if (!isLocalHost(url.hostname)) {
    return null;
  }

  let port = Number(url.port);
  return {
    command,
    healthUrl: new URL(healthPath, origin).toString(),
    name,
    origin,
    port: Number.isInteger(port) && port > 0 ? port : null,
    process: null,
  };
}

async function isServiceHealthy(service: ManagedService): Promise<boolean> {
  try {
    let response = await fetch(service.healthUrl, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        Accept: "application/javascript, application/json, text/plain;q=0.9, */*;q=0.1",
      },
    });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForService(service: ManagedService, timeoutMs: number): Promise<boolean> {
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServiceHealthy(service)) {
      return true;
    }
    await Bun.sleep(500);
  }

  return false;
}

async function killLocalPort(port: number): Promise<void> {
  await Bun.spawn(["sh", "-c", `pids=$(lsof -ti tcp:${port}); if [ -n "$pids" ]; then kill $pids; fi`], {
    stderr: "ignore",
    stdout: "ignore",
  }).exited;
  await Bun.sleep(500);
}

function shouldRetryWithServiceRecovery(result: CompatResult, options: RunOptions): boolean {
  if (result.retryCount >= maxFetchRetries) {
    return false;
  }

  return (
    result.esmUnpkg.diagnosticCode === "FETCH_ERROR" ||
    (!options.skipBaseline && result.esmSh.diagnosticCode === "FETCH_ERROR")
  );
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function parseArgs(args: string[]): ParsedArgs {
  let autoRestartLocalServices = true;
  let corpusPath: string | null = null;
  let concurrency = defaultConcurrency;
  let dryRun = false;
  let outputMode: OutputMode = "text";
  let skipBaseline = false;
  let timeoutMs = defaultTimeoutMs;

  for (let index = 0; index < args.length; index += 1) {
    let arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--json") {
      outputMode = "json";
    } else if (arg === "--ndjson") {
      outputMode = "ndjson";
    } else if (arg === "--no-restart-local-services") {
      autoRestartLocalServices = false;
    } else if (arg === "--skip-baseline") {
      skipBaseline = true;
    } else if (arg === "--corpus") {
      corpusPath = args[index + 1] ?? null;
      index += 1;
    } else if (arg.startsWith("--corpus=")) {
      corpusPath = arg.slice("--corpus=".length);
    } else if (arg === "--concurrency") {
      concurrency = parsePositiveInteger(args[index + 1], "--concurrency");
      index += 1;
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = parsePositiveInteger(arg.slice("--concurrency=".length), "--concurrency");
    } else if (arg === "--timeout-ms") {
      timeoutMs = parsePositiveInteger(args[index + 1], "--timeout-ms");
      index += 1;
    } else if (arg.startsWith("--timeout-ms=")) {
      timeoutMs = parsePositiveInteger(arg.slice("--timeout-ms=".length), "--timeout-ms");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { autoRestartLocalServices, concurrency, corpusPath, dryRun, outputMode, skipBaseline, timeoutMs };
}

function parsePositiveInteger(value: string | undefined, name: string): number {
  let number = value == null ? NaN : Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return number;
}
