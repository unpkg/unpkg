import { type VNode } from "preact";
import prettyBytes from "pretty-bytes";
import type { PackageInfo, PackageFile, PackageFileMetadata } from "unpkg-worker";

import { highlightCode } from "../highlight.ts";
import { useHrefs } from "../hooks.ts";
import { getLanguageName } from "../language-names.ts";

import { CodeViewer } from "./code-viewer.tsx";
import { FilesHeader } from "./files-header.tsx";
import { FilesLayout } from "./files-layout.tsx";
import { FilesNav } from "./files-nav.tsx";
import { Hydrate } from "./hydrate.tsx";
import { ImageViewer } from "./image-viewer.tsx";

// The maximum number of characters we are willing to apply syntax highlighting to.
const maxHighlightedTextSize = 50_000;

// The maximum number of interactive line links we are willing to render and hydrate.
const maxInteractiveLineCount = 2_000;

// The maximum number of bytes we are willing to load and show in a text preview.
export const maxTextPreviewSize = 2 * 1024 * 1024;

// The maximum number of escaped text bytes we are willing to include in the rendered page.
const maxRenderedTextPreviewSize = 2 * 1024 * 1024;

export function shouldLoadFileBody(file: PackageFileMetadata): boolean {
  return !isTextFile(file) || file.size <= maxTextPreviewSize;
}

export function FileDetail({
  packageInfo,
  version,
  filename,
  file,
}: {
  packageInfo: PackageInfo;
  version: string;
  filename: string;
  file: PackageFile | PackageFileMetadata;
}): VNode {
  let hrefs = useHrefs();
  let rawHref = hrefs.raw(packageInfo.name, version, filename);

  let lineCount: number | undefined;
  let loc: number | undefined;

  let content: VNode;
  if (isTextFile(file)) {
    if ("body" in file) {
      let text = new TextDecoder().decode(file.body);
      lineCount = countLines(text);

      if (text.length <= maxHighlightedTextSize && lineCount <= maxInteractiveLineCount) {
        loc = text.split("\n").filter((line) => line.trim() !== "").length;
        content = (
          <Hydrate>
            <CodeViewer html={highlightCode(text)} numLines={lineCount} />
          </Hydrate>
        );
      } else if (isRenderedTextWithinLimit(text)) {
        content = (
          <pre
            class="py-4 px-6 border-b border-x border-slate-300 dark:border-dark-border bg-white dark:bg-dark-page font-mono text-sm leading-6 whitespace-pre overflow-x-auto"
            style={{ tabSize: 2 }}
          >
            {text}
          </pre>
        );
      } else {
        content = <LargeFileNotice rawHref={rawHref} />;
      }
    } else {
      content = <LargeFileNotice rawHref={rawHref} />;
    }
  } else if (file.type.startsWith("image/")) {
    content = <ImageViewer alt={filename} src={rawHref} />;
  } else {
    content = (
      <div class="py-4 border-b border-x border-slate-300 dark:border-dark-border bg-white dark:bg-dark-page text-center">
        No preview is available for this file.
      </div>
    );
  }

  return (
    <FilesLayout>
      <FilesHeader packageInfo={packageInfo} version={version} filename={filename} />

      <FilesNav packageInfo={packageInfo} version={version} filename={filename} />

      <div class="p-3 border border-slate-300 dark:border-dark-border bg-slate-100 dark:bg-dark-chrome text-sm flex justify-between select-none">
        <div class="w-64">
          {lineCount == null ? "" : <LineCount lineCount={lineCount} loc={loc} />}
          <span>{prettyBytes(file.size)}</span>
        </div>
        <div class="hidden flex-grow sm:block text-center">{getLanguageName(file)}</div>
        <div class="w-64 hidden sm:block text-right">
          <a href={rawHref} class="py-1 px-2 border border-slate-300 dark:border-dark-border bg-slate-100 dark:bg-dark-panel hover:bg-slate-200 dark:hover:bg-dark-border rounded-sm">
            View Raw
          </a>
        </div>
      </div>

      {content}
    </FilesLayout>
  );
}

function LineCount({ lineCount, loc }: { lineCount: number; loc?: number }): VNode {
  return (
    <span>
      <span>{formatNumber(lineCount)} lines </span>
      {loc != null && lineCount !== loc ? <span>({formatNumber(loc)} loc) </span> : null}
      <span>&bull; </span>
    </span>
  );
}

function countLines(text: string): number {
  let count = 1;
  let index = -1;

  while ((index = text.indexOf("\n", index + 1)) !== -1) {
    count++;
  }

  return count;
}

function isRenderedTextWithinLimit(text: string): boolean {
  let size = 0;

  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);

    if (code === 38) {
      size += 5; // &amp;
    } else if (code === 60) {
      size += 4; // &lt;
    } else if (code === 34) {
      size += 6; // &quot;
    } else if (code <= 0x7f) {
      size += 1;
    } else if (code <= 0x7ff) {
      size += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      let nextCode = text.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        size += 4;
        index++;
      } else {
        size += 3;
      }
    } else {
      size += 3;
    }

    if (size > maxRenderedTextPreviewSize) {
      return false;
    }
  }

  return true;
}

function LargeFileNotice({ rawHref }: { rawHref: string }): VNode {
  return (
    <div class="py-4 border-b border-x border-slate-300 dark:border-dark-border bg-white dark:bg-dark-page text-center">
      <span>This file is too large to preview. </span>
      <a href={rawHref} class="inline-link text-blue-600 dark:text-dark-link hover:underline">
        View Raw
      </a>
    </div>
  );
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en").format(num);
}

function isTextFile(file: PackageFileMetadata): boolean {
  return file.type.startsWith("text/") || file.type === "application/json";
}
