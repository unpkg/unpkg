import { type VNode } from "preact";

import { useAsset } from "../hooks.ts";
import { type ImportMap } from "../import-map.ts";

export function Document({
  children,
  description = "The CDN for everything on npm",
  origin = "https://unpkg.com",
  title = "UNPKG",
}: {
  children: VNode;
  description?: string;
  origin?: string;
  title?: string;
}): VNode {
  let importMap: ImportMap = {
    imports: {
      preact: new URL("/preact@10.25.4/dist/preact.module.js", origin).href,
      "preact/hooks": new URL("/preact@10.25.4/hooks/dist/hooks.module.js", origin).href,
      "preact/jsx-runtime": new URL("/preact@10.25.4/jsx-runtime/dist/jsxRuntime.module.js", origin).href,
    },
  };

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />

        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="stylesheet" href={useAsset("assets/styles.css")} />
        <link rel="stylesheet" href={useAsset("assets/code-light.css")} />
        <link rel="stylesheet" href={useAsset("assets/code-dark.css")} media="(prefers-color-scheme: dark)" />

        <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(importMap) }} />
        <script type="module" src={useAsset("assets/scripts.ts")} defer></script>

        <title>{title}</title>

        <script async src="https://www.googletagmanager.com/gtag/js?id=UA-140352188-1"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'UA-140352188-1');`,
          }}
        ></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
