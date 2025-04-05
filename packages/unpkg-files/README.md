# unpkg-files

This package is the file server for UNPKG. It has one job: fetch tarballs from npm, decompress them, and extract their contents. It is deployed on [Fly.io](https://fly.io/).

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
