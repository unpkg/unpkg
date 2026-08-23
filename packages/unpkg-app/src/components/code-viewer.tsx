import { type VNode } from "preact";
import { useState, useEffect } from "preact/hooks";

// TODO: Make this configurable via a user preference
const tabSize = 2;

export interface CodeViewerProps {
  html: string;
  numLines: number;
}

export function CodeViewer({ html, numLines }: CodeViewerProps): VNode {
  let [highlightedLines, setHighlightedLines] = useState<number[]>([]);

  function handleLineLinkClick(event: MouseEvent): void {
    event.preventDefault();

    let target = event.target as HTMLAnchorElement;
    let lineNumber = parseInt(target.id.slice(1), 10);

    let newLines: number[];
    if (event.shiftKey) {
      // If the shift key is held down, select all lines between the first
      // selected line and this line.
      let firstLine = highlightedLines[0];

      if (firstLine == null) {
        newLines = [lineNumber];
      } else {
        let start = Math.min(firstLine, lineNumber);
        let end = Math.max(firstLine, lineNumber);
        newLines = getNumbersInRange([start, end]);
      }
    } else if (event.metaKey) {
      if (highlightedLines.includes(lineNumber)) {
        // If this line is already selected, deselect it.
        newLines = highlightedLines.filter((n) => n !== lineNumber);
      } else {
        // Otherwise, select it.
        newLines = [...highlightedLines, lineNumber].sort((a, b) => a - b);
      }
    } else {
      // Otherwise, select only this line.
      newLines = [lineNumber];
    }

    setHighlightedLines(newLines);

    let rangeString = stringifyRanges(
      newLines.reduce((ranges, n) => {
        let lastRange = ranges[ranges.length - 1];

        if (lastRange != null && lastRange[1] === n - 1) {
          lastRange[1] = n;
        } else {
          ranges.push([n, n]);
        }

        return ranges;
      }, [] as Range[]),
    );

    window.history.replaceState(
      null,
      "",
      rangeString === "" ? window.location.pathname + window.location.search : `#L${rangeString}`,
    );
  }

  function handleHashChange(): void {
    let lines = parseLineHash(window.location.hash, numLines);
    setHighlightedLines(lines);

    let firstLine = lines[0];
    if (firstLine != null) {
      document.getElementById(`L${firstLine}`)?.scrollIntoView();
    }
  }

  useEffect(() => {
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  let highlightedLineSet = new Set(highlightedLines);

  return (
    <div class="hljs-frame flex relative bg-white dark:bg-dark-page font-mono text-sm leading-6">
      <div class="py-4 border-b border-x border-slate-300 dark:border-dark-border bg-slate-100 dark:bg-dark-panel text-right select-none">
        {Array.from({ length: numLines }, (_, index) => {
          let lineNumber = index + 1;

          return (
            <div>
              {highlightedLineSet.has(lineNumber) ? (
                <div class="w-full h-6 bg-yellow-200 dark:bg-dark-selection opacity-40 absolute left-0"></div>
              ) : null}
              <div class="relative">
                <a
                  id={`L${lineNumber}`}
                  href={`#L${lineNumber}`}
                  class="hljs-line-number inline-block w-full pl-4 sm:pl-6 pr-2 text-slate-600 dark:text-dark-secondary hover:text-slate-950 dark:hover:text-dark-foreground outline-none"
                  onClick={handleLineLinkClick}
                >
                  {lineNumber}
                </a>
              </div>
            </div>
          );
        })}
      </div>
      <div
        class="hljs-dark-listing py-4 pl-4 pr-6 relative border-b border-r border-slate-300 dark:border-dark-border flex-grow whitespace-pre overflow-x-auto"
        style={{ tabSize }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

type Range = [number, number];

export function parseLineHash(hash: string, numLines: number): number[] {
  if (!Number.isSafeInteger(numLines) || numLines < 1 || !/^#L\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(hash)) {
    return [];
  }

  let lineNumbers = new Set<number>();

  for (let rangeString of hash.slice(2).split(",")) {
    let [startString, endString = startString] = rangeString.split("-");
    let start = Number(startString);
    let end = Number(endString);

    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || start > end) {
      return [];
    }

    if (start > numLines) {
      continue;
    }

    for (let lineNumber = start; lineNumber <= Math.min(end, numLines); lineNumber++) {
      lineNumbers.add(lineNumber);
    }
  }

  return [...lineNumbers];
}

function stringifyRanges(ranges: Range[]): string {
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`)).join(",");
}

function getNumbersInRange(range: Range): number[] {
  let [start, end] = range;
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
