import { lookup, mimes } from "mrmime";

mimes.authors = "text/plain";
mimes.changes = "text/plain";
mimes.cjs = "text/javascript";
mimes.cts = "text/typescript";
mimes["d.cts"] = "text/typescript";
mimes["d.mts"] = "text/typescript";
mimes["d.ts"] = "text/typescript";
mimes.license = "text/plain";
mimes.makefile = "text/plain";
mimes.mjs = "text/javascript";
mimes.mts = "text/typescript";
mimes.patents = "text/plain";
mimes.readme = "text/plain";
mimes.ts = "text/typescript";
mimes.flow = "text/plain";

const textFiles = /\/?(\.[a-z]*rc|\.git[a-z]*|\.[a-z]*ignore|\.lock)$/i;

export function getContentType(filename: string): string {
  let basename = filename.split(/[\\/]/).pop()!;
  let type = textFiles.test(basename) ? "text/plain" : lookup(basename);
  return type ?? "application/octet-stream";
}
