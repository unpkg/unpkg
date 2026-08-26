import { type VNode } from "preact";
import { useRef, useState } from "preact/hooks";

// Keep in sync with the first example in the Inline Scripts section of home.tsx.
const confettiDemoSource = `import confetti from "canvas-confetti";

confetti({ particleCount: 80, spread: 70 });`;

export function RunDemo({ runUrl }: { runUrl: string }): VNode {
  let [state, setState] = useState<"idle" | "running" | "error">("idle");
  // Warm runs finish in a few milliseconds; only show the running state when a
  // run is actually slow, so the label doesn't flicker on every click.
  let [slowRun, setSlowRun] = useState(false);
  let containerRef = useRef<HTMLDivElement>(null);

  async function runExample() {
    let container = containerRef.current;
    if (state === "running" || container == null) {
      return;
    }

    setState("running");
    let slowRunTimer = setTimeout(() => setSlowRun(true), 250);

    try {
      // Recreate the example's inline script tag and hand it to the real /run
      // helper, so this button exercises the exact pipeline the docs describe.
      container.replaceChildren();
      let script = document.createElement("script");
      script.type = "text/ts";
      script.setAttribute("data-filename", "/confetti-demo.ts");
      script.textContent = confettiDemoSource;
      container.append(script);

      let runner = (await import(runUrl)) as { default: (root?: ParentNode) => Promise<void> };
      // Importing /run for the first time runs any pending inline scripts on its
      // own; later clicks run the freshly inserted script explicitly.
      await runner.default(container);
      setState("idle");
    } catch (error) {
      console.error(error);
      setState("error");
    } finally {
      clearTimeout(slowRunTimer);
      setSlowRun(false);
    }
  }

  return (
    <div class="mt-3 flex items-center gap-4">
      <button
        type="button"
        class={`px-4 py-2 text-sm font-semibold border border-slate-300 dark:border-dark-border-strong bg-slate-100 dark:bg-dark-panel ${
          slowRun
            ? "opacity-50 cursor-default"
            : "hover:bg-slate-200 dark:hover:bg-dark-border cursor-pointer"
        }`}
        disabled={state === "running"}
        onClick={runExample}
      >
        {/* Reserve the wider label's width so the swap never resizes the button. */}
        <span class="grid">
          <span class="col-start-1 row-start-1 invisible" aria-hidden="true">
            Run this example
          </span>
          <span class="col-start-1 row-start-1">{slowRun ? "Running…" : "Run this example"}</span>
        </span>
      </button>
      {state === "error" && (
        <span class="text-sm text-red-600 dark:text-red-400">The example failed to run — see the console.</span>
      )}
      <div ref={containerRef} hidden />
    </div>
  );
}
