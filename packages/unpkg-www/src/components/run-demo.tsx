import { type VNode } from "preact";
import { useRef, useState } from "preact/hooks";

// Keep in sync with the first example in the Inline Scripts section of home.tsx.
const confettiDemoSource = `import confetti from "canvas-confetti";

confetti({ particleCount: 80, spread: 70 });`;

export function RunDemo({ runUrl }: { runUrl: string }): VNode {
  let [state, setState] = useState<"idle" | "running" | "error">("idle");
  let containerRef = useRef<HTMLDivElement>(null);

  async function runExample() {
    let container = containerRef.current;
    if (state === "running" || container == null) {
      return;
    }

    setState("running");

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
    }
  }

  return (
    <div class="mt-3 flex items-center gap-4">
      <button
        type="button"
        class="px-4 py-2 text-sm font-semibold border border-slate-300 dark:border-dark-border-strong bg-slate-100 dark:bg-dark-panel hover:bg-slate-200 dark:hover:bg-dark-border cursor-pointer disabled:opacity-50 disabled:cursor-default"
        disabled={state === "running"}
        onClick={runExample}
      >
        {state === "running" ? "Running…" : "Run this example"}
      </button>
      {state === "error" && (
        <span class="text-sm text-red-600 dark:text-red-400">The example failed to run — see the console.</span>
      )}
      <div ref={containerRef} hidden />
    </div>
  );
}
