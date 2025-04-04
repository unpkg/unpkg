# unpkg-files

This is the file server for UNPKG. It has one job: fetch tarballs from npm, decompress them, and extract their contents.

## Development

Install dependencies and run the tests:

```
pnpm install
pnpm test
```

Boot the dev server:

```
pnpm dev
```

## Deploying

Build the server and boot it:

```
pnpm build
bun ./dist/server.js
```
