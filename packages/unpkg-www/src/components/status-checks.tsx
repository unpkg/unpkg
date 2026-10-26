import { type VNode } from "preact";
import { useEffect, useState } from "preact/hooks";

type CheckState = "checking" | "ok" | "fail";

interface CheckDef {
  id: string;
  label: string;
  detail: string;
  run: () => Promise<void>;
}

interface CheckResult {
  state: CheckState;
  ms?: number;
}

/**
 * Live status checks, run in the visitor's browser against the real
 * surfaces. These are per-visitor observations ("can you reach it, how
 * fast"), explicitly not a global uptime measurement.
 */
export function StatusChecks({ appOrigin, esmOrigin }: { appOrigin: string; esmOrigin: string }): VNode {
  const checks: CheckDef[] = [
    {
      id: "worker",
      label: "File-serving Worker",
      detail: "unpkg.com health endpoint",
      run: async () => {
        let response = await fetch("/_health", { cache: "no-store" });
        if (!response.ok || (await response.text()) !== "OK") throw new Error("health");
      },
    },
    {
      id: "files",
      label: "File delivery",
      detail: "Edge, cache layers, and origin path",
      run: async () => {
        let response = await fetch("/ms@2.1.0/package.json", { cache: "no-store" });
        if (!response.ok) throw new Error("files");
        await response.text();
      },
    },
    {
      id: "meta",
      label: "Metadata API",
      detail: "?meta listings",
      run: async () => {
        let response = await fetch("/ms@2.1.0/?meta", { cache: "no-store" });
        if (!response.ok) throw new Error("meta");
        let data = (await response.json()) as { files?: unknown };
        if (!Array.isArray(data.files)) throw new Error("meta shape");
      },
    },
    {
      id: "esm",
      label: "ES module conversion",
      detail: "esm.unpkg.com",
      run: async () => {
        let response = await fetch(`${esmOrigin}/ms@2.1.0`, { cache: "no-store" });
        if (!response.ok) throw new Error("esm");
        await response.text();
      },
    },
    {
      id: "app",
      label: "Package browser",
      detail: "app.unpkg.com (reachability)",
      run: async () => {
        // The app serves HTML without CORS headers, so this is a
        // reachability probe: it resolves only if the surface answers.
        await fetch(`${appOrigin}/react@18.3.1`, { mode: "no-cors", cache: "no-store" });
      },
    },
  ];

  let [results, setResults] = useState<Record<string, CheckResult>>({});

  useEffect(() => {
    let cancelled = false;
    setResults(Object.fromEntries(checks.map((check) => [check.id, { state: "checking" as CheckState }])));
    (async () => {
      await Promise.all(
        checks.map(async (check) => {
          let started = performance.now();
          try {
            await check.run();
            if (!cancelled) {
              setResults((prev) => ({
                ...prev,
                [check.id]: { state: "ok", ms: Math.max(1, Math.round(performance.now() - started)) },
              }));
            }
          } catch {
            if (!cancelled) {
              setResults((prev) => ({ ...prev, [check.id]: { state: "fail" } }));
            }
          }
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div class="border border-hairline-strong dark:border-dark-border-strong bg-white dark:bg-dark-panel">
      <ul>
        {checks.map((check) => {
          let result = results[check.id] ?? { state: "checking" as CheckState };
          return (
            <li
              key={check.id}
              class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 border-b border-hairline dark:border-dark-border last:border-b-0 text-base"
            >
              <span
                aria-hidden="true"
                class={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  result.state === "ok" ? "bg-[#5c8a6f]" : result.state === "fail" ? "bg-[#b8513f]" : "bg-slate-300 dark:bg-dark-border-strong"
                }`}
              />
              <span class="font-semibold text-ink dark:text-dark-foreground">{check.label}</span>
              <span class="text-slate-600 dark:text-dark-secondary">{check.detail}</span>
              <span class="ml-auto text-sm text-slate-600 dark:text-dark-secondary">
                {result.state === "ok" ? "Operational" : result.state === "fail" ? "Not reachable" : "Checking…"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
