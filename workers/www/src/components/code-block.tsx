import { type VNode } from "preact";

import { highlightCode } from "../highlight.ts";

const tabSize = 2;

export function CodeBlock({ children }: { children: string }): VNode {
  let lines = trimLeadingWhitespace(trimLines(children.split("\n")));
  let code = lines.join("\n");
  let html = highlightCode(code);

  return (
    <div
      class="p-4 font-mono text-sm leading-6 bg-white border border-slate-300 whitespace-pre overflow-x-auto"
      style={{ tabSize }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function trimLeadingWhitespace(lines: string[]): string[] {
  let minIndent = Infinity;

  for (let line of lines) {
    if (line.trim() === "") {
      continue;
    }

    let indent = line.search(/\S/);
    if (indent < minIndent) {
      minIndent = indent;
    }
  }

  return lines.map((line) => line.slice(minIndent));
}

function trimLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start].trim() === "") {
    start++;
  }

  while (end > start && lines[end - 1].trim() === "") {
    end--;
  }

  return lines.slice(start, end);
}
