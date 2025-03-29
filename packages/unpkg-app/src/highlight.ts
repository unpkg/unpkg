import highlight from "highlight.js/lib/common";

export function highlightCode(code: string): string {
  let result = highlight.highlightAuto(code);
  return result.value;
}
