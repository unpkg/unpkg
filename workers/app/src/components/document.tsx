import { type VNode } from "preact";

import { AppContext } from "./app-context.ts";
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
  subtitle,
}: {
  children?: VNode | VNode[];
  context: ContextProvider;
  description?: string;
  title?: string;
  subtitle?: string;
}): VNode {
  let assets = context.get(AssetsContext);

  return (
    <AppContext.Provider value={context}>
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
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta name="description" content={description} />
          <link rel="icon" type="image/jpeg" href="/favicon.jpg" />
          <link rel="stylesheet" href={assets.get("src/styles.css")} />
          <link rel="stylesheet" href={assets.get("src/code-light.css")} />
          <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(importMap) }} />
          <script type="module" src={assets.get("src/scripts.ts")} defer></script>
          <title>{subtitle == null ? title : `unpkg • ${subtitle}`}</title>
        </head>
        <body>{children}</body>
      </html>
    </AppContext.Provider>
  );
}
