import { type VNode, Fragment } from "preact";

import { CodeBlock } from "./code-block.tsx";
import { Hydrate } from "./hydrate.tsx";
import { RunDemo } from "./run-demo.tsx";
import { PageSection, SiteFooter, SiteHeader } from "./site-chrome.tsx";

const link = "inline-link text-accent dark:text-dark-link hover:underline";
const code = "text-sm bg-paper-alt dark:bg-dark-panel";

export interface GuideDef {
  slug: string;
  title: string;
  description: string;
  heading: string;
  intro: string;
}

export const GUIDES: GuideDef[] = [
  {
    slug: "loading-files",
    title: "Loading Files — UNPKG Guides",
    description:
      "The UNPKG URL pattern explained: package, version, and file; semver ranges and dist-tags; entry-point and exports resolution; directory listings.",
    heading: "Loading files",
    intro:
      "Every file on npm is available at a UNPKG URL. This guide covers the URL pattern, how versions resolve, and how UNPKG picks a file when you don't name one.",
  },
  {
    slug: "nobuild-apps",
    title: "Nobuild Apps — UNPKG Guides",
    description:
      "Build browser apps with no build step: load npm dependencies directly with import maps and native ES modules from UNPKG.",
    heading: "Nobuild apps",
    intro:
      "You don't need a bundler to use npm packages in the browser. With import maps, the browser itself resolves your dependencies from UNPKG.",
  },
  {
    slug: "inline-scripts",
    title: "Inline Scripts — UNPKG Guides",
    description:
      "Run TypeScript, JSX, and TSX inline in HTML with UNPKG's /run helper: script types, data attributes, and examples.",
    heading: "Inline scripts",
    intro:
      "The /run helper finds inline TypeScript and JSX script blocks in your page, transforms them, and executes them as modules — no build step and no separate files.",
  },
  {
    slug: "browser-modules",
    title: "Browser Modules — UNPKG Guides",
    description:
      "esm.unpkg.com converts npm packages to browser-ready ES modules: URL format, targets, conditions, dependency overrides, JSX, CSS modules, and raw mode.",
    heading: "Browser modules",
    intro:
      "For packages that aren't published as browser-ready modules, esm.unpkg.com resolves, converts, and rewrites them into ES modules any modern browser can load directly.",
  },
  {
    slug: "metadata-api",
    title: "Metadata API — UNPKG Guides",
    description:
      "Append ?meta to any UNPKG package or directory URL for JSON metadata: file paths, sizes, types, and integrity hashes.",
    heading: "Metadata API",
    intro:
      "Append ?meta to a package or directory URL and UNPKG returns JSON describing the files there. Tools, agents, and build scripts use it to discover what's inside a package without downloading it.",
  },
  {
    slug: "cache-performance",
    title: "Cache Performance — UNPKG Guides",
    description:
      "How UNPKG caching works and how to get the best hit rate: permanent exact-version URLs, redirects for ranges and tags, and verified cache entries.",
    heading: "Cache performance",
    intro:
      "UNPKG is fast because most requests are answered from cache at the edge. This guide explains what gets cached, for how long, and how to write URLs that hit it.",
  },
  {
    slug: "supply-chain-security",
    title: "Supply Chain Security — UNPKG Guides",
    description:
      "How UNPKG Shield watches npm releases, pins or blocks compromised versions at the edge, and gives package owners visibility into where their code runs.",
    heading: "Supply chain security",
    intro:
      "A compromised npm release can reach production pages in minutes. UNPKG Shield watches every release as it publishes and can substitute a known-good version at the edge before a browser ever executes the bad one.",
  },
];

function GuideShell({ guide, children }: { guide: GuideDef; children: VNode }): VNode {
  return (
    <Fragment>
      <SiteHeader current="/guides" />
      <div class="mx-auto max-w-screen-xl px-8 lg:flex lg:gap-12">
        <aside class="hidden lg:block w-56 shrink-0">
          <nav aria-label="Guides" class="sticky top-24 py-10 text-base">
            <p class="font-semibold text-ink dark:text-dark-foreground">Guides</p>
            <ul class="mt-3 space-y-2">
              {GUIDES.map((entry) => (
                <li key={entry.slug}>
                  <a
                    href={`/guides/${entry.slug}`}
                    aria-current={entry.slug === guide.slug ? "page" : undefined}
                    class={
                      entry.slug === guide.slug
                        ? "text-accent-deep dark:text-dark-link font-semibold"
                        : "text-slate-600 dark:text-dark-secondary hover:text-ink dark:hover:text-dark-foreground hover:underline"
                    }
                  >
                    {entry.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main class="flex-1 min-w-0 max-w-screen-md text-lg text-slate-900 dark:text-dark-secondary leading-relaxed py-2">
          <h1 class="mt-10 text-4xl font-black text-ink dark:text-dark-foreground">{guide.heading}</h1>
          <p class="mt-6 text-xl leading-relaxed">{guide.intro}</p>
          <p class="mt-6 text-base lg:hidden">
            <a class={link} href="/guides">
              ← All guides
            </a>
          </p>
          {children}
          <nav aria-label="More guides" class="mt-20 border-t border-hairline dark:border-dark-border pt-6 flex flex-wrap justify-between gap-4 text-base">
            {(() => {
              let index = GUIDES.findIndex((entry) => entry.slug === guide.slug);
              let prev = GUIDES[index - 1];
              let next = GUIDES[index + 1];
              return (
                <>
                  <span>
                    {prev && (
                      <a class={link} href={`/guides/${prev.slug}`}>
                        ← {prev.heading}
                      </a>
                    )}
                  </span>
                  <a class={link} href="/guides">
                    All guides
                  </a>
                  <span>
                    {next && (
                      <a class={link} href={`/guides/${next.slug}`}>
                        {next.heading} →
                      </a>
                    )}
                  </span>
                </>
              );
            })()}
          </nav>
        </main>
      </div>
      <div class="mt-24">
        <SiteFooter />
      </div>
    </Fragment>
  );
}

export function LoadingFilesGuide(): VNode {
  const guide = GUIDES[0];
  return (
    <GuideShell guide={guide}>
      <PageSection id="url-pattern" title="The URL pattern">
        <p class="mt-4 p-4 text-center bg-paper-alt dark:bg-dark-panel">
          <code class={code}>unpkg.com/:package@:version/:file</code>
        </p>
        <ul class="mt-6 ml-6 list-disc list-outside">
          <li class="marker:pr-2">
            <code class={code}>:package</code> — the package name on npm, including scope (
            <code class={code}>@scope/name</code>).
          </li>
          <li class="marker:pr-2 mt-2">
            <code class={code}>:version</code> — an exact version, a semver range, or a dist-tag. Omit it and{" "}
            <code class={code}>latest</code> is used.
          </li>
          <li class="mt-2">
            <code class={code}>:file</code> — the path to a file inside the package. Omit it and UNPKG resolves the
            package's entry point.
          </li>
        </ul>
        <p class="mt-6">
          Examples:{" "}
          <a class={link} href="/preact@10.26.4/dist/preact.min.js">
            preact@10.26.4/dist/preact.min.js
          </a>
          ,{" "}
          <a class={link} href="/react@18.3.1/umd/react.production.min.js">
            react@18.3.1/umd/react.production.min.js
          </a>
          ,{" "}
          <a class={link} href="/three@0.174.0/build/three.module.min.js">
            three@0.174.0/build/three.module.min.js
          </a>
          .
        </p>
      </PageSection>

      <PageSection id="versions" title="Versions, ranges, and tags">
        <p class="mt-4">
          Ranges and tags (<code class={code}>^18</code>, <code class={code}>latest</code>) redirect to the exact
          version they resolve to, so the response you ultimately get is always a permanent URL. For production, pin
          the full version yourself — see{" "}
          <a class={link} href="/guides/cache-performance">
            cache performance
          </a>
          .
        </p>
      </PageSection>

      <PageSection id="entry-points" title="Entry points and exports">
        <p class="mt-4">
          With no file path, UNPKG resolves the entry point from <code class={code}>package.json</code>: the{" "}
          <code class={code}>exports</code> field first (including subpaths and conditions such as{" "}
          <code class={code}>?conditions=react-server</code>), then <code class={code}>main</code>. A package can
          choose its UNPKG default with the <code class={code}>unpkg</code> field or the{" "}
          <code class={code}>unpkg</code> export condition.
        </p>
        <div class="mt-6">
          <CodeBlock>
            {`
            {
              "name": "my-package",
              "exports": {
                "unpkg": "./dist/index.unpkg.js",
                "default": "./dist/index.js"
              }
            }
          `}
          </CodeBlock>
        </div>
      </PageSection>

      <PageSection id="listings" title="Browsing files">
        <p class="mt-4">
          Add a trailing <code class={code}>/</code> to browse a directory (
          <a class={link} href="/react/">
            unpkg.com/react/
          </a>
          ), or use the{" "}
          <a class={link} href="/guides/metadata-api">
            metadata API
          </a>{" "}
          for the same listing as JSON.
        </p>
      </PageSection>
    </GuideShell>
  );
}

export function NobuildAppsGuide(): VNode {
  return (
    <GuideShell guide={GUIDES[1]}>
      <PageSection id="import-maps" title="Import maps do the bundler's job">
        <p class="mt-4">
          An{" "}
          <a class={link} href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap">
            import map
          </a>{" "}
          tells the browser where bare imports like <code class={code}>preact</code> should load from. Point them at
          UNPKG and a plain HTML file becomes a working app:
        </p>
        <div class="mt-6">
          <CodeBlock>
            {`
            <script type="importmap">
              {
                "imports": {
                  "preact": "https://unpkg.com/preact@10.25.4/dist/preact.module.js",
                  "preact/hooks": "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js",
                  "htm": "https://unpkg.com/htm@3.1.1/dist/htm.module.js"
                }
              }
            </script>
            <script type="module">
              import { h, render } from "preact";
              // your app here
            </script>
          `}
          </CodeBlock>
        </div>
        <p class="mt-6">
          Pin exact versions in the map so the browser cache and the edge cache both stay hot — with the{" "}
          <a class={link} href="/guides/cache-performance">
            same trade-off as any pinned URL
          </a>
          : patches only arrive when you update the map. Looser specifiers — patch-level ones especially — flow
          updates automatically, at the cost of a redirect and accepting whatever the next release brings — the
          security side of that risk is what{" "}
          <a class={link} href="/guides/supply-chain-security">
            supply-chain defense at the edge
          </a>{" "}
          is for. For packages that aren't published as browser modules,{" "}
          <a class={link} href="/guides/browser-modules">
            esm.unpkg.com
          </a>{" "}
          converts them first.
        </p>
      </PageSection>
    </GuideShell>
  );
}

export function InlineScriptsGuide({ origin }: { origin: string }): VNode {
  return (
    <GuideShell guide={GUIDES[2]}>
      <PageSection id="run" title="The /run helper">
        <p class="mt-4">
          Load <code class={code}>{`${origin}/run`}</code> as a module script. It scans the page for inline scripts
          of type <code class={code}>text/ts</code>, <code class={code}>text/jsx</code>, and{" "}
          <code class={code}>text/tsx</code>, transforms them through esm.unpkg.com, and inserts executable module
          scripts in their place.
        </p>
        <div class="mt-6">
          <CodeBlock>
            {`
            <script type="module" src="${origin}/run"></script>
            <script type="text/ts">
              import confetti from "canvas-confetti";
              confetti({ particleCount: 80, spread: 70 });
            </script>
          `}
          </CodeBlock>
        </div>
        <Hydrate>
          <RunDemo runUrl={`${origin}/run`} />
        </Hydrate>
      </PageSection>

      <PageSection id="attributes" title="Script attributes">
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm border-collapse">
            <thead>
              <tr class="border-b border-hairline-strong dark:border-dark-border-strong">
                <th class="py-2 pr-4 font-semibold">Attribute</th>
                <th class="py-2 font-semibold">Use</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4">
                  <code class={code}>data-filename</code>
                </td>
                <td class="py-2">Names the inline file for extension inference and clearer diagnostics.</td>
              </tr>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4">
                  <code class={code}>data-target</code>
                </td>
                <td class="py-2">
                  Sets the JavaScript output target, such as <code class={code}>es2022</code>.
                </td>
              </tr>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4">
                  <code class={code}>data-jsx</code>
                </td>
                <td class="py-2">
                  Chooses JSX mode, such as <code class={code}>automatic</code>.
                </td>
              </tr>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4">
                  <code class={code}>data-jsx-import-source</code>
                </td>
                <td class="py-2">
                  Sets the JSX import source, such as <code class={code}>preact</code>.
                </td>
              </tr>
              <tr>
                <td class="py-2 pr-4">
                  <code class={code}>data-dev</code>
                </td>
                <td class="py-2">Enables development-mode JSX output.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageSection>
    </GuideShell>
  );
}

export function BrowserModulesGuide({ esmOrigin }: { esmOrigin: string }): VNode {
  const esm = (path: string): string => new URL(path, esmOrigin).href;
  return (
    <GuideShell guide={GUIDES[3]}>
      <PageSection id="usage" title="Usage">
        <p class="mt-4">
          Use the same package URL style as UNPKG, on the <code class={code}>esm.unpkg.com</code> subdomain:
        </p>
        <div class="mt-6">
          <CodeBlock>
            {`
            <script type="module">
              import React from "${esm("/react@18.3.1")}";
              import { createRoot } from "${esm("/react-dom@18.3.1/client")}";
            </script>
          `}
          </CodeBlock>
        </div>
        <p class="mt-6">
          Versions may be exact, dist-tags, or ranges; requests redirect to a normalized, version-pinned URL so
          generated imports are stable and cacheable. By default esm.unpkg.com targets modern browsers (
          <code class={code}>target=es2022</code>), uses production mode, and bundles package internals while
          leaving dependencies as rewritten UNPKG imports.
        </p>
      </PageSection>

      <PageSection id="parameters" title="All parameters">
        <p class="mt-4">
          Requests are normalized and redirected to a canonical URL, so equivalent spellings share one cache entry.
          Unknown parameters are stripped rather than honored. The full set:
        </p>
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm border-collapse">
            <thead>
              <tr class="border-b border-hairline-strong dark:border-dark-border-strong">
                <th class="py-2 pr-4 font-semibold">Parameter</th>
                <th class="py-2 font-semibold">Use</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?target=…</code></td><td class="py-2">Output target: <code class={code}>es2015</code>–<code class={code}>es2024</code>, <code class={code}>esnext</code>, <code class={code}>deno</code>, or <code class={code}>node</code>. Defaults to <code class={code}>es2022</code>.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?dev</code></td><td class="py-2">Development export conditions and <code class={code}>NODE_ENV</code>.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?conditions=…</code></td><td class="py-2">Comma-separated custom export conditions.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?exports=…</code></td><td class="py-2">Restricts which export conditions/subpaths are considered.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?deps=…</code></td><td class="py-2">Pins or overrides dependency versions used by the build.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?external=…</code></td><td class="py-2">Leaves listed dependencies as bare imports instead of rewriting them. A <code class={code}>/*</code> path prefix keeps every dependency external.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?alias=…</code></td><td class="py-2">Rewrites one package specifier to another during resolution.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?jsx=…</code></td><td class="py-2">JSX transform mode (for example <code class={code}>automatic</code>).</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?jsxImportSource=…</code></td><td class="py-2">JSX import source, such as <code class={code}>preact</code>.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?min</code></td><td class="py-2">Minifies the output.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?sourcemap</code></td><td class="py-2">Emits a source map with the module.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?worker</code></td><td class="py-2">Builds the worker variant of the module.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?no-dts</code></td><td class="py-2">Skips TypeScript declaration handling.</td></tr>
              <tr class="border-b border-hairline dark:border-dark-border"><td class="py-2 pr-4"><code class={code}>?meta</code></td><td class="py-2">Returns JSON metadata about the built module instead of code. Cannot be combined with <code class={code}>?css</code>, <code class={code}>?module</code>, or <code class={code}>?worker</code>.</td></tr>
              <tr><td class="py-2 pr-4"><code class={code}>?raw</code></td><td class="py-2">Serves the underlying file untransformed. Cannot be combined with build parameters.</td></tr>
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection id="css" title="Stylesheets">
        <p class="mt-4">
          Direct <code class={code}>.css</code> files serve as CSS. With <code class={code}>?module</code>, a
          stylesheet becomes a constructable <code class={code}>CSSStyleSheet</code> module you can adopt;{" "}
          <code class={code}>?css</code> controls how imported stylesheets are handled by the build.
        </p>
      </PageSection>

      <PageSection id="errors" title="Errors and redirects">
        <p class="mt-4">
          Invalid specifiers and unsupported combinations return JSON errors with a machine-readable{" "}
          <code class={code}>code</code>. Unpinned or non-canonical requests redirect (301) to the resolved,
          version-pinned URL so generated imports stay stable and cacheable for a year.
        </p>
      </PageSection>
    </GuideShell>
  );
}

export function MetadataApiGuide(): VNode {
  return (
    <GuideShell guide={GUIDES[4]}>
      <PageSection id="meta" title="?meta">
        <p class="mt-4">
          Append <code class={code}>?meta</code> to any package root or directory URL:
        </p>
        <ul class="mt-4 ml-6 list-disc list-outside">
          <li>
            <a class={link} href="/react-router@7.3.0/?meta">
              unpkg.com/react-router@7.3.0/?meta
            </a>
          </li>
          <li>
            <a class={link} href="/react-router@7.3.0/dist/?meta">
              unpkg.com/react-router@7.3.0/dist/?meta
            </a>
          </li>
        </ul>
        <p class="mt-6">The response lists the files under that prefix, each with:</p>
        <div class="mt-6">
          <CodeBlock>
            {`
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
          `}
          </CodeBlock>
        </div>
        <p class="mt-6">
          <code class={code}>path</code>, <code class={code}>size</code> (bytes), <code class={code}>type</code>{" "}
          (MIME type), and <code class={code}>integrity</code> (a SHA-256 hash of the file contents). Version-less
          and range URLs redirect to the resolved version first, so metadata always describes an exact release.
        </p>
      </PageSection>
    </GuideShell>
  );
}

export function CachePerformanceGuide(): VNode {
  return (
    <GuideShell guide={GUIDES[5]}>
      <PageSection id="permanent-urls" title="Permanent URLs are the fast path">
        <p class="mt-4">
          npm never lets a published version be overwritten, so an exact-version file URL is permanent. UNPKG caches
          those responses at the edge for a year. URLs without a fully resolved version —{" "}
          <a class={link} href="/preact@10">
            unpkg.com/preact@10
          </a>{" "}
          — must resolve first and redirect, so they are never the direct cache hit.{" "}
          <span class="font-semibold">
            For the best chance of a cache hit, use the full package version and file path in production URLs
          </span>
          , like{" "}
          <a class={link} href="/preact@10.5.0/dist/preact.min.js">
            unpkg.com/preact@10.5.0/dist/preact.min.js
          </a>
          .
        </p>
        <p class="mt-4">
          That speed is a trade-off, not a free win: a fully pinned URL never changes, so bug fixes and patches only
          arrive when you update it. Looser specifiers flow updates to you automatically, at the cost of a redirect
          on the way in and accepting whatever the next release brings. A middle path is a patch-level specifier
          (such as <code class={code}>preact@10.26</code>), which takes bug fixes within a release line while major
          and minor changes stay deliberate. Which side you choose is a judgment call — and the security side of it
          is exactly the risk{" "}
          <a class={link} href="/guides/supply-chain-security">
            UNPKG Shield
          </a>{" "}
          exists to carry, by watching new releases and stopping the bad ones at the edge whichever way you pin.
        </p>
      </PageSection>

      <PageSection id="verified" title="Verified, self-healing entries">
        <p class="mt-4">
          Before a file enters any cache layer it is length- and digest-verified against the origin's response. An
          entry that fails verification later is evicted and refetched rather than served. If a version has to be
          withdrawn, operators can evict that exact <code class={code}>package@version</code> from every layer
          without disturbing any other version. The{" "}
          <a class={link} href="/network">
            network page
          </a>{" "}
          explains the machinery.
        </p>
      </PageSection>
    </GuideShell>
  );
}

export function SupplyChainSecurityGuide(): VNode {
  return (
    <GuideShell guide={GUIDES[6]}>
      <PageSection id="shield" title="UNPKG Shield">
        <p class="mt-4">
          <a class={link} href="https://shield.unpkg.com/">
            UNPKG Shield
          </a>{" "}
          watches every npm release the moment it publishes and judges each change with a diff-aware classifier
          informed by OSV, the GitHub Advisory Database, and the OpenSSF malicious-packages feed.
        </p>
        <ul class="mt-6 ml-6 list-disc list-outside">
          <li class="marker:pr-2">
            <span class="font-semibold">Armed domains</span> get a compromised version pinned or swapped to the last
            known-good release at the edge — or blocked — before a browser executes it.
          </li>
          <li class="marker:pr-2 mt-2">
            <span class="font-semibold">Monitoring domains</span> stay unarmed and simply observe, so you can watch
            first and enforce when ready.
          </li>
          <li class="mt-2">
            <span class="font-semibold">Package owners</span> can see which domains serve their packages and which
            versions are live, so a hijacked release stops being invisible.
          </li>
        </ul>
      </PageSection>

      <PageSection id="why-not-sri" title="Why not just use SRI?">
        <p class="mt-4">
          Subresource Integrity is a good tool, and the two approaches solve different problems. An SRI hash proves
          the bytes you received are the bytes you pinned — nothing more. It can't tell you whether a new release is
          safe, and every update, including critical bug fixes, waits on someone updating hashes across every page
          and dependency.
        </p>
        <p class="mt-4">
          Shield takes the other direction: instead of each site verifying bytes by hand, every release is judged
          once, centrally, as it publishes, and a bad one is stopped at the edge for everyone armed against it. No
          hash maintenance, and no deploy on your side when something goes wrong.
        </p>
        <p class="mt-4">
          It's a genuine choice. If you pin and verify hashes yourself, keep doing that — it's the right model when
          you want to trust no intermediary. If you'd rather not maintain hashes across every dependency and update,
          Shield is the barrier that stays current for you.
        </p>
        <p class="mt-4">
          Enforcement happens on the normal request path described on the{" "}
          <a class={link} href="/network">
            network page
          </a>
          : the check runs before any cache is consulted, and a pinned response is served under the clean version's
          cache key. Join the beta at{" "}
          <a class={link} href="https://shield.unpkg.com/register">
            shield.unpkg.com/register
          </a>
          .
        </p>
      </PageSection>
    </GuideShell>
  );
}
