import type { PackageFile } from "unpkg-core";

const contentTypeLanguageNames: Record<string, string> = {
  "application/json": "JSON",
  "application/octet-stream": "Binary",
  "application/vnd.ms-fontobject": "Embedded OpenType",
  "application/xml": "XML",
  "image/svg+xml": "SVG",
  "font/ttf": "TrueType Font",
  "font/woff": "WOFF",
  "font/woff2": "WOFF2",
  "text/css": "CSS",
  "text/html": "HTML",
  "text/javascript": "JavaScript",
  "text/jsx": "JSX",
  "text/markdown": "Markdown",
  "text/plain": "Plain Text",
  "text/x-scss": "SCSS",
  "text/yaml": "YAML",
};

export function getLanguageName(file: PackageFile): string {
  if (/\.flow$/.test(file.path)) return "Flow";
  if (/\.(d\.ts|tsx)$/.test(file.path)) return "TypeScript";
  if (/\.map$/.test(file.path)) return "Source Map (JSON)";

  return contentTypeLanguageNames[file.type] ?? file.type;
}
