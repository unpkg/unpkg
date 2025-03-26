import { type VNode } from "preact";
import { useContext } from "preact/hooks";

import { AssetsContext } from "../assets.ts";
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
  description = "The CDN for everything on npm",
  title = "unpkg",
}: {
  children: VNode;
  description?: string;
  title?: string;
}): VNode {
  let assets = useContext(AssetsContext);

  return (
    <html lang="en">
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=UA-140352188-1"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'UA-140352188-1');`,
          }}
        ></script>
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
