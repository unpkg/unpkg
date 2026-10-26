# Loading Files

Every file on npm is available at a UNPKG URL. This guide covers the URL pattern, how versions resolve, and how UNPKG picks a file when you don't name one.

Source page: https://unpkg.com/guides/loading-files

## The URL pattern

```
unpkg.com/:package@:version/:file
```

- `:package` — the package name on npm, including scope (`@scope/name`).
- `:version` — an exact version, a semver range, or a dist-tag. Omit it and `latest` is used.
- `:file` — the path to a file inside the package. Omit it and UNPKG resolves the package's entry point.

Examples:

- https://unpkg.com/preact@10.26.4/dist/preact.min.js
- https://unpkg.com/react@18.3.1/umd/react.production.min.js
- https://unpkg.com/three@0.174.0/build/three.module.min.js

## Versions, ranges, and tags

Ranges and tags (`^18`, `latest`) redirect to the exact version they resolve to, so the response you ultimately get is always a permanent URL. Which specifier to use in production is a trade-off; see [cache performance](https://unpkg.com/guides/cache-performance.md).

## Entry points and exports

With no file path, UNPKG resolves the entry point from `package.json`: the `exports` field first (including subpaths and conditions such as `?conditions=react-server`), then `main`. A package can choose its UNPKG default with the `unpkg` field or the `unpkg` export condition:

```json
{
  "name": "my-package",
  "exports": {
    "unpkg": "./dist/index.unpkg.js",
    "default": "./dist/index.js"
  }
}
```

## Browsing files

Add a trailing `/` to browse a directory (e.g. https://unpkg.com/react/), or use the [metadata API](https://unpkg.com/guides/metadata-api.md) for the same listing as JSON.
