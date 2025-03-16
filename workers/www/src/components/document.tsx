import { type VNode } from "preact";

import { AssetsContext } from "../assets.ts";
import { type ContextProvider } from "../context.ts";
import { type ImportMap } from "../import-map.ts";

const importMap: ImportMap = {
  imports: {
    preact: "https://unpkg.com/preact@10.25.4/dist/preact.module.js",
    "preact/hooks": "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js",
    "preact/jsx-runtime": "https://unpkg.com/preact@10.25.4/jsx-runtime/dist/jsxRuntime.module.js",
  },
};

export function Document({
  children,
  context,
  description = "The CDN for everything on npm",
  title = "unpkg",
}: {
  children: VNode;
  context: ContextProvider;
  description?: string;
  title?: string;
}): VNode {
  let assets = context.get(AssetsContext);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />

        <link rel="icon" type="image/jpeg" href="/favicon.jpg" />

        <link rel="stylesheet" href={assets.get("src/styles.css")} />
        <link rel="stylesheet" href={assets.get("src/code-light.css")} />

        <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(importMap) }} />
        <script type="module" src={assets.get("src/scripts.ts")} defer></script>

        <title>{title}</title>
      </head>
      <body>{children}</body>
    </html>
  );
}
