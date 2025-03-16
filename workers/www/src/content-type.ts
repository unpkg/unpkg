import { lookup, mimes } from "mrmime";

mimes.authors = "text/plain";
mimes.changes = "text/plain";
mimes.license = "text/plain";
mimes.makefile = "text/plain";
mimes.patents = "text/plain";
mimes.readme = "text/plain";
mimes.ts = "text/plain";
mimes.flow = "text/plain";

const textFiles = /\/?(\.[a-z]*rc|\.git[a-z]*|\.[a-z]*ignore|\.lock)$/i;

export function getContentType(filename: string): string {
  let name = basename(filename);
  return textFiles.test(name) ? "text/plain" : lookup(name) || "text/plain";
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop()!;
}
