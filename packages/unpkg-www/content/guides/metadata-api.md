# Metadata API

Append `?meta` to a package or directory URL and UNPKG returns JSON describing the files there. Tools, agents, and build scripts use it to discover what's inside a package without downloading it.

Source page: https://unpkg.com/guides/metadata-api

## ?meta

Append `?meta` to any package root or directory URL:

- https://unpkg.com/react-router@7.3.0/?meta
- https://unpkg.com/react-router@7.3.0/dist/?meta

The response lists the files under that prefix, each with:

```json
{
  "package": "react-router",
  "version": "7.3.0",
  "prefix": "/dist/",
  "files": [
    {
      "path": "/dist/production/dom-export.js",
      "size": 195047,
      "type": "text/javascript",
      "integrity": "sha256-Gh8wMHW9MO5IMaBq7fOc7szDMRemnO/7Qr8kTK4ebgY="
    }
  ]
}
```

- `path` — the file path within the package.
- `size` — size in bytes.
- `type` — MIME type.
- `integrity` — a SHA-256 hash of the file contents.

Version-less and range URLs redirect to the resolved version first, so metadata always describes an exact release.
