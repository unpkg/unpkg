import { type VNode } from "preact";

import { useAsset } from "../hooks.ts";
import { type ImportMap } from "../import-map.ts";
import { markdownPathFor } from "../markdown.ts";
import { MARKETING_PATHS } from "../seo.ts";

export function Document({
  breadcrumbs,
  children,
  description = "The CDN for everything on npm",
  gaId,
  origin = "https://unpkg.com",
  path = "/",
  title = "UNPKG",
}: {
  breadcrumbs?: { name: string; path: string }[];
  children: VNode;
  description?: string;
  // GA4 measurement ID. Rendered only when set — dev/staging omit it so
  // non-production traffic never pollutes analytics.
  gaId?: string;
  origin?: string;
  /** Canonical path for this page (SEO). Defaults to the homepage. */
  path?: string;
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
    <html lang="en" class="bg-paper dark:bg-dark-page">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={description} />
        <meta name="color-scheme" content="light dark" />

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="UNPKG" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={new URL(path, origin).href} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta property="og:image" content={new URL("/social-card.png", origin).href} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content={description} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@unpkg" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />

        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="canonical" href={new URL(path, origin).href} />
        {(MARKETING_PATHS as readonly string[]).includes(path) && (
          <link rel="alternate" type="text/markdown" href={new URL(markdownPathFor(path), origin).href} />
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": new URL("/#org", origin).href,
                  name: "UNPKG",
                  url: new URL("/", origin).href,
                  sameAs: ["https://github.com/unpkg", "https://x.com/unpkg"],
                },
                {
                  "@type": "WebSite",
                  name: "UNPKG",
                  url: new URL("/", origin).href,
                },
                ...(breadcrumbs
                  ? [
                      {
                        "@type": "BreadcrumbList",
                        itemListElement: breadcrumbs.map((crumb, index) => ({
                          "@type": "ListItem",
                          position: index + 1,
                          name: crumb.name,
                          item: new URL(crumb.path, origin).href,
                        })),
                      },
                    ]
                  : []),
                {
                  "@type": "WebPage",
                  name: title,
                  description,
                  url: new URL(path, origin).href,
                  isPartOf: { "@id": new URL("/#org", origin).href },
                },
              ],
            }),
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("unpkg-theme");if(t!=="light"&&t!=="dark"){var m=document.cookie.match(/(?:^|; )unpkg-theme=(light|dark)/);t=m?m[1]:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}`,
          }}
        />
        <link rel="stylesheet" href={useAsset("assets/styles.css")} />
        <link rel="stylesheet" href={useAsset("assets/code-light.css")} />
        <link rel="stylesheet" href={useAsset("assets/code-dark.css")} />

        <script type="importmap" dangerouslySetInnerHTML={{ __html: JSON.stringify(importMap) }} />
        <script type="module" src={useAsset("assets/scripts.ts")} defer></script>

        <title>{title}</title>

        {gaId != null && <script async src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}></script>}
        {gaId != null && (
          <script
            dangerouslySetInnerHTML={{
              __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaId}');`,
            }}
          ></script>
        )}
      </head>
      <body class="bg-paper dark:bg-dark-page dark:text-dark-foreground">{children}</body>
    </html>
  );
}
