import { type VNode, Fragment } from "preact";

import { CodeBlock } from "./code-block.tsx";
import { Hydrate } from "./hydrate.tsx";
import { RunDemo } from "./run-demo.tsx";
import { UrlBuilder } from "./url-builder.tsx";
import { btnPrimary, btnSecondary, SiteFooter, SiteHeader } from "./site-chrome.tsx";

const link = "inline-link text-accent dark:text-dark-link hover:underline";
const code = "text-sm bg-paper-alt dark:bg-dark-panel";

/**
 * The homepage is a landing page: what UNPKG is, how to start, why it can
 * be trusted in production, and where the depth lives (guides, network,
 * status). Detailed reference material belongs to /guides/*, not here.
 */
export function Home({ esmOrigin, origin }: { esmOrigin: string; origin: string }): VNode {
  let url = (pathname: string): string => new URL(pathname, origin).href;
  let esmUrl = (pathname: string): string => new URL(pathname, esmOrigin).href;

  return (
    <Fragment>
      <SiteHeader current="/" />
      <header class="mx-auto lg:max-w-screen-md px-8 text-slate-900 dark:text-dark-secondary">
        <h1 class="mt-24 text-7xl text-center font-black text-ink dark:text-dark-foreground">UNPKG</h1>
        <p class="mt-8 text-center text-xl text-slate-900 dark:text-dark-secondary leading-relaxed">
          The CDN for everything on{" "}
          <a class={link} href="https://www.npmjs.com/">
            npm
          </a>
          . Load any file from any package by URL. Files are served from Cloudflare's edge.
        </p>
        <p class="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a class={btnPrimary} href="/guides">
            Get started
          </a>
          <a class={btnSecondary} href="/react/">
            Browse a package
          </a>
        </p>
        <p class="mt-10 p-4 text-center bg-paper-alt dark:bg-dark-panel">
          <code class="text-sm sm:hidden">unpkg.com/:pkg@:ver/:file</code>
          <code class="text-sm hidden sm:block">{url("/:package@:version/:file")}</code>
        </p>
        <div class="mt-8">
          <Hydrate>
            <UrlBuilder esmOrigin={esmOrigin} origin={origin} />
          </Hydrate>
        </div>
      </header>

      <main class="mx-auto lg:max-w-screen-md text-lg text-slate-900 dark:text-dark-secondary leading-relaxed max-w-full px-8">
        <dl class="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-hairline-strong dark:border-dark-border-strong bg-white dark:bg-dark-panel shadow-[0_1px_2px_rgba(14,26,35,0.06)] text-base">
          <div class="p-4 border-b sm:border-b-0 lg:border-r border-hairline dark:border-dark-border">
            <svg class="w-6 h-6 text-accent dark:text-dark-link" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5" /><path stroke-linecap="round" d="M3.5 12h17M12 3.5c2.3 2.3 3.4 5.2 3.4 8.5s-1.1 6.2-3.4 8.5c-2.3-2.3-3.4-5.2-3.4-8.5S9.7 5.8 12 3.5Z" /></svg>
                  <dt class="mt-2.5 font-semibold text-ink dark:text-dark-foreground">Global edge</dt>
            <dd class="mt-1 text-[0.95rem] leading-snug text-slate-600 dark:text-dark-secondary">
              Served from Cloudflare's network, close to browsers everywhere.{" "}
              <a class={link} href="/network">
                Network
              </a>
            </dd>
          </div>
          <div class="p-4 border-b sm:border-b-0 lg:border-r border-hairline dark:border-dark-border">
            <svg class="w-6 h-6 text-accent dark:text-dark-link" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v2A2.5 2.5 0 0 1 17.5 10h-11A2.5 2.5 0 0 1 4 7.5v-2ZM4 16a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 16v2a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18v-2Z" /><path stroke-linecap="round" d="M7 6.5h.01M7 17h.01" /></svg>
                  <dt class="mt-2.5 font-semibold text-ink dark:text-dark-foreground">11 origin regions</dt>
            <dd class="mt-1 text-[0.95rem] leading-snug text-slate-600 dark:text-dark-secondary">Files are fetched from origin machines across the Americas, Europe, Asia, and Australia.</dd>
          </div>
          <div class="p-4 border-b sm:border-b-0 lg:border-r border-hairline dark:border-dark-border">
            <svg class="w-6 h-6 text-accent dark:text-dark-link" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8.5" /><path stroke-linecap="round" stroke-linejoin="round" d="m8.5 12.2 2.4 2.4 4.6-5" /></svg>
                  <dt class="mt-2.5 font-semibold text-ink dark:text-dark-foreground">Verified bytes</dt>
            <dd class="mt-1 text-[0.95rem] leading-snug text-slate-600 dark:text-dark-secondary">Every file is digest-checked before it is cached, and corrupt entries heal themselves.</dd>
          </div>
          <div class="p-4">
            <svg class="w-6 h-6 text-accent dark:text-dark-link" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3 5 5.8v5.4c0 4.3 2.9 7.4 7 9.3 4.1-1.9 7-5 7-9.3V5.8L12 3Z" /><path stroke-linecap="round" stroke-linejoin="round" d="m9.3 11.8 2 2 3.6-3.9" /></svg>
                  <dt class="mt-2.5 font-semibold text-ink dark:text-dark-foreground">Supply-chain defense</dt>
            <dd class="mt-1 text-[0.95rem] leading-snug text-slate-600 dark:text-dark-secondary">
              <a class={link} href="https://shield.unpkg.com/">
                UNPKG Shield
              </a>{" "}
              pins or swaps compromised packages at the edge.
            </dd>
          </div>
        </dl>

        <section id="quickstart">
          <h2 class="mt-20 mb-6 text-xl font-semibold text-slate-900 dark:text-dark-foreground">Start in one line</h2>
          <p>
            Point a script tag at a package file. Pin the full version in production so the response comes straight
            from the edge cache:
          </p>
          <div class="mt-6">
            <CodeBlock>
              {`
              <script src="https://unpkg.com/preact@10.26.4/dist/preact.min.js"></script>
            `}
            </CodeBlock>
          </div>
          <p class="mt-6">
            In a module, load the browser-ready build from{" "}
            <a class={link} href={esmUrl("/")}>
              esm.unpkg.com
            </a>
            :
          </p>
          <div class="mt-6">
            <CodeBlock>
              {`
              <script type="module">
                import React from "https://esm.unpkg.com/react@18.3.1";
              </script>
            `}
            </CodeBlock>
          </div>
          <p class="mt-6">
            Need to know what's inside a package first? Append{" "}
            <a class={link} href="/guides/metadata-api">
              <code class={code}>?meta</code>
            </a>{" "}
            to any package URL for JSON metadata.
          </p>
        </section>

        <section id="ways-to-use">
          <h2 class="mt-20 mb-6 text-xl font-semibold text-slate-900 dark:text-dark-foreground">Ways to use UNPKG</h2>
          <ul class="ml-6 list-disc list-outside">
            <li class="marker:pr-2">
              <a class={link} href="/guides/loading-files">
                Load files from npm
              </a>
              : any file, any package, one URL. Versions, entry points, and exports resolution explained.
            </li>
            <li class="marker:pr-2 mt-2">
              <a class={link} href="/guides/nobuild-apps">
                Build apps with no build step
              </a>
              : import maps turn a plain HTML file into a working app.
            </li>
            <li class="marker:pr-2 mt-2">
              <a class={link} href="/guides/browser-modules">
                Use native browser modules
              </a>
              : esm.unpkg.com converts packages into modules browsers load directly.
            </li>
            <li class="marker:pr-2 mt-2">
              <a class={link} href="/guides/inline-scripts">
                Run inline TypeScript and JSX
              </a>
              : the <code class={code}>/run</code> helper transforms inline scripts in the page.
            </li>
            <li class="mt-2">
              <a class={link} href="/guides/metadata-api">
                Inspect packages programmatically
              </a>
              : file listings, sizes, and integrity hashes as JSON, for tools and agents.
            </li>
          </ul>

          <div class="mt-10" id="live-demo">
            <CodeBlock>
              {`
              <script type="module" src="${url("/run")}"></script>
              <script type="text/ts">
                import confetti from "canvas-confetti";
                confetti({ particleCount: 80, spread: 70 });
              </script>
            `}
            </CodeBlock>
            <Hydrate>
              <RunDemo runUrl={url("/run")} />
            </Hydrate>
          </div>
        </section>

        <section id="production">
          <h2 class="mt-20 mb-6 text-xl font-semibold text-slate-900 dark:text-dark-foreground">
            Running in production
          </h2>
          <p>
            Exact-version files are cached at the edge for a year, and every cached byte is digest-verified. A
            damaged entry is evicted and refetched, never served. If a version has to be withdrawn, it can be
            evicted from every cache layer without touching any other version. The{" "}
            <a class={link} href="/network">
              network page
            </a>{" "}
            explains how, and the{" "}
            <a class={link} href="/status">
              status page
            </a>{" "}
            describes how changes ship safely.
          </p>
          <div class="mt-8 p-4 bg-paper-alt dark:bg-dark-panel">
            <p>
              <span class="font-semibold">Serving production traffic through UNPKG?</span>{" "}
              <a class={link} href="https://shield.unpkg.com/" title="UNPKG Shield">
                UNPKG Shield
              </a>{" "}
              (currently in Beta) watches every npm release as it publishes. Arm a domain and a compromised version
              is pinned to the last known-good release (or blocked) at the edge, before a browser executes it.{" "}
              <a class={link} href="/guides/supply-chain-security">
                How supply-chain defense works
              </a>
              .
            </p>
          </div>
        </section>

        <section id="about">
          <h2 class="mt-20 mb-6 text-xl font-semibold text-slate-900 dark:text-dark-foreground">Open source</h2>
          <p>
            UNPKG is an{" "}
            <a class={link} href="https://github.com/unpkg" title="UNPKG on GitHub">
              open source project
            </a>
            , free to use, and not affiliated with npm. The{" "}
            <a class={link} href="/guides">
              guides
            </a>{" "}
            go deeper on everything above.
          </p>
        </section>
      </main>

      <div class="mt-24">
        <SiteFooter />
      </div>
    </Fragment>
  );
}
