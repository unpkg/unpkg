import { type VNode } from "preact";

import { useAsset } from "../hooks.ts";
import { type ImportMap } from "../import-map.ts";

export function Document({
  children,
  description = "The CDN for everything on npm",
  title = "UNPKG",
  subtitle,
  wwwOrigin = "https://unpkg.com",
}: {
  children?: VNode | VNode[];
  description?: string;
  title?: string;
  subtitle?: string;
  wwwOrigin?: string;
}): VNode {
  let fullTitle = subtitle == null ? title : `${title} • ${subtitle}`;

  let importMap: ImportMap = {
    imports: {
      preact: new URL("/preact@10.25.4/dist/preact.module.js", wwwOrigin).href,
      "preact/hooks": new URL("/preact@10.25.4/hooks/dist/hooks.module.js", wwwOrigin).href,
      "preact/jsx-runtime": new URL("/preact@10.25.4/jsx-runtime/dist/jsxRuntime.module.js", wwwOrigin).href,
    },
  };

  return (
    <html lang="en" class="bg-white dark:bg-dark-page">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={description} />
        <meta name="color-scheme" content="light dark" />

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="UNPKG" />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={new URL("/social-card.png", wwwOrigin).href} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={description} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@unpkg" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />

        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="stylesheet" href={useAsset("assets/styles.css")} />
        <link rel="stylesheet" href={useAsset("assets/code-light.css")} />
        <link rel="stylesheet" href={useAsset("assets/code-dark.css")} media="(prefers-color-scheme: dark)" />

        <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(importMap) }} />
        <script type="module" src={useAsset("assets/scripts.ts")} defer></script>

        <title>{fullTitle}</title>

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
      <body class="bg-white dark:bg-dark-page dark:text-dark-foreground">{children}</body>
    </html>
  );
}
