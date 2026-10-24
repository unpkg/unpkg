# Browser Modules

For packages that aren't published as browser-ready modules, esm.unpkg.com resolves, converts, and rewrites them into ES modules any modern browser can load directly.

Source page: https://unpkg.com/guides/browser-modules

## Usage

Use the same package URL style as UNPKG, on the `esm.unpkg.com` subdomain:

```html
<script type="module">
  import React from "https://esm.unpkg.com/react@18.3.1";
  import { createRoot } from "https://esm.unpkg.com/react-dom@18.3.1/client";
</script>
```

Versions may be exact, dist-tags, or ranges; requests redirect to a normalized, version-pinned URL so generated imports are stable and cacheable. By default esm.unpkg.com targets modern browsers (`target=es2022`), uses production mode, and bundles package internals while leaving dependencies as rewritten UNPKG imports.

## All parameters

Requests are normalized and redirected to a canonical URL, so equivalent spellings share one cache entry. Unknown parameters are stripped rather than honored.

| Parameter | Use |
|---|---|
| `?target=…` | Output target: `es2015`–`es2024`, `esnext`, `deno`, or `node`. Defaults to `es2022`. |
| `?dev` | Development export conditions and `NODE_ENV`. |
| `?conditions=…` | Comma-separated custom export conditions. |
| `?exports=…` | Restricts which export conditions/subpaths are considered. |
| `?deps=…` | Pins or overrides dependency versions used by the build. |
| `?external=…` | Leaves listed dependencies as bare imports instead of rewriting them. A `/*` path prefix keeps every dependency external. |
| `?alias=…` | Rewrites one package specifier to another during resolution. |
| `?jsx=…` | JSX transform mode (for example `automatic`). |
| `?jsxImportSource=…` | JSX import source, such as `preact`. |
| `?min` | Minifies the output. |
| `?sourcemap` | Emits a source map with the module. |
| `?worker` | Builds the worker variant of the module. |
| `?no-dts` | Skips TypeScript declaration handling. |
| `?meta` | Returns JSON metadata about the built module instead of code. Cannot be combined with `?css`, `?module`, or `?worker`. |
| `?raw` | Serves the underlying file untransformed. Cannot be combined with build parameters. |

## Stylesheets

Direct `.css` files serve as CSS. With `?module`, a stylesheet becomes a constructable `CSSStyleSheet` module you can adopt; `?css` controls how imported stylesheets are handled by the build.

## Errors and redirects

Invalid specifiers and unsupported combinations return JSON errors with a machine-readable `code`. Unpinned or non-canonical requests redirect (301) to the resolved, version-pinned URL so generated imports stay stable and cacheable for a year.

The esm.unpkg.com landing page is a thin pointer to this guide, which is the canonical documentation.
