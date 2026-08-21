export function compareExportKeys(
  baseline: readonly string[],
  candidate: readonly string[],
  mode: "match" | "expected-only" = "match"
): string | null {
  if (mode === "expected-only") {
    return null;
  }

  let baselineSet = new Set(baseline);
  let candidateSet = new Set(candidate);
  let missing = [...baselineSet].filter((name) => !candidateSet.has(name)).sort();
  let extra = [...candidateSet].filter((name) => !baselineSet.has(name)).sort();

  if (missing.length === 0 && extra.length === 0) {
    return null;
  }

  return `export surface mismatch: missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`;
}
