import { type VNode } from "preact";

import { highlightCode } from "../highlight.ts";

const tabSize = 2;

export function CodeBlock({ children }: { children: string }): VNode {
  let html = highlightCode(children);

  return (
    <div
      class="p-4 font-mono text-sm leading-6 bg-white border border-slate-300 whitespace-pre overflow-x-auto"
      style={{ tabSize }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
