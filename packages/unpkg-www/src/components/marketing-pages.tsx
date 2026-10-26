import { type VNode } from "preact";

import { GUIDES } from "./guide-pages.tsx";
import { Hydrate } from "./hydrate.tsx";
import { StatusChecks } from "./status-checks.tsx";
import { MarketingPage, PageSection } from "./site-chrome.tsx";

const link = "inline-link text-accent dark:text-dark-link hover:underline";
const code = "text-sm bg-paper-alt dark:bg-dark-panel";

export function NetworkPage({ origin }: { origin: string }): VNode {
  return (
    <MarketingPage
      current="/network"
      heading="How UNPKG serves files"
      intro="UNPKG is deliberately simple at the edge and careful behind it. Requests are answered by Cloudflare's global network; behind that edge sits a small, verified path back to the npm tarball your file came from."
    >
      <PageSection id="request-flow" title="The path of a request">
        <figure class="mt-6 border border-hairline-strong dark:border-dark-border-strong bg-white dark:bg-dark-panel p-4 overflow-x-auto">
          <ol class="min-w-[560px]">
            {[
              { name: "Browser cache", detail: "Exact-version files, up to a year. Shield-pinned responses are never stored here." },
              { name: "Cloudflare edge cache", detail: "The hot path. Permanent URLs served near the user; hits never reach the origin." },
              { name: "Worker cache layers", detail: "File and listing caches keyed by package@version, and by cache generation after an eviction." },
              { name: "File origin", detail: "Verified fetches with retries and resume; corrupt entries are evicted and healed." },
              { name: "npm tarball", detail: "The source of truth: byte-for-byte what the maintainer published." },
            ].map((layer, i, layers) => (
              <li key={layer.name}>
                <div class="flex gap-4 items-baseline border border-hairline dark:border-dark-border bg-paper dark:bg-dark-page px-4 py-3">
                  <span class="font-semibold text-accent-deep dark:text-dark-link whitespace-nowrap">{layer.name}</span>
                  <span class="text-base">{layer.detail}</span>
                </div>
                {i < layers.length - 1 && (
                  <div aria-hidden="true" class="text-center text-slate-400 dark:text-dark-muted leading-4">
                    ↓
                  </div>
                )}
              </li>
            ))}
          </ol>
          <figcaption class="mt-2 text-sm text-slate-600 dark:text-dark-secondary">
            A request stops at the first layer that can answer it. Shield runs in the Worker, ahead of every cache
            layer below the browser.
          </figcaption>
        </figure>
      </PageSection>

      <PageSection id="edge-caching" title="Edge caching meets supply chain security">
        <p class="mt-4">
          Exact-version URLs (like <code class={code}>/react@18.3.1/umd/react.production.min.js</code>) are
          immutable in practice, so they are cached at the edge for a year. Range and tag URLs redirect to the exact
          version first, which keeps the hot path pinned to those long-lived entries. Because cached bytes are
          digest-verified, a truncated or damaged entry cannot quietly persist: it fails verification, is evicted,
          and is refetched complete. When a version must be withdrawn, operators can evict that exact{" "}
          <code class={code}>package@version</code> from every cache layer without touching any other version.
        </p>
        <p class="mt-4">
          A year-long cache would be a liability if it kept serving a compromised release, so for domains armed with{" "}
          <a class={link} href="#shield">
            UNPKG Shield
          </a>{" "}
          the check runs before any cache lookup: a bad version is rewritten to the last known-good one (or blocked)
          before a cached copy can be served.
        </p>
      </PageSection>

      <PageSection id="behavior" title="What happens when">
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm border-collapse">
            <thead>
              <tr class="border-b border-hairline-strong dark:border-dark-border-strong">
                <th class="py-2 pr-4 font-semibold">Request</th>
                <th class="py-2 font-semibold">Behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4 align-top whitespace-nowrap">Exact version + file</td>
                <td class="py-2 align-top">Served from the edge under a permanent URL; cached for a year.</td>
              </tr>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4 align-top whitespace-nowrap">Range or tag</td>
                <td class="py-2 align-top">Redirects to the resolved exact version, which is then cached as above.</td>
              </tr>
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4 align-top whitespace-nowrap">Shield-pinned version</td>
                <td class="py-2 align-top">Rewritten to the known-good version before any cache lookup; the browser never stores the substitute.</td>
              </tr>
              <tr>
                <td class="py-2 pr-4 align-top whitespace-nowrap">Withdrawn version</td>
                <td class="py-2 align-top">Its cache generation is evicted in every layer; the next request refetches (or 404s if npm removed it).</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection id="origin" title="A multi-region origin">
        <p class="mt-4">
          Our file origin runs in 11 regions, so a cold fetch stays on the same side of the planet as the edge
          location asking for it. Origin fetches retry automatically, and large files stream with resume instead of
          starting over.
        </p>
        <div class="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-base">
          {[
            { area: "Americas", regions: ["Dallas", "Secaucus", "Los Angeles", "San Jose", "São Paulo"] },
            { area: "Europe", regions: ["Amsterdam", "Paris", "London"] },
            { area: "Asia-Pacific", regions: ["Singapore", "Tokyo", "Sydney"] },
          ].map((group) => (
            <div class="border border-hairline dark:border-dark-border p-4" key={group.area}>
              <h3 class="font-semibold text-ink dark:text-dark-foreground">{group.area}</h3>
              <ul class="mt-2 flex flex-wrap gap-1.5">
                {group.regions.map((region) => (
                  <li class="px-2 py-0.5 bg-paper-alt dark:bg-dark-panel border border-hairline dark:border-dark-border" key={region}>
                    {region}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection id="shield" title="Supply-chain defense at the same edge">
        <p class="mt-4">
          <a class={link} href="https://shield.unpkg.com/">
            UNPKG Shield
          </a>{" "}
          is an optional layer on top of UNPKG, not part of the base service: files are served exactly the same
          whether or not a domain uses it. For domains that have armed it, the check runs in the Worker on the
          request path above, before any cache is consulted; a matched version is rewritten to a known-good one (or
          blocked) and then cached under the clean version's key. Domains that register start in monitoring;
          enforcement is a deliberate opt-in. How Shield classifies releases and how to join are covered at{" "}
          <a class={link} href="https://shield.unpkg.com/">
            shield.unpkg.com
          </a>
          .
        </p>
      </PageSection>

      <PageSection id="tradeoffs" title="The trade we chose, stated plainly">
        <div class="mt-4 p-4 bg-paper-alt dark:bg-dark-panel border border-hairline dark:border-dark-border">
        <p>
          UNPKG runs on one edge provider, Cloudflare, instead of spreading traffic across several CDNs. That is a
          real trade: we give up multi-provider failover. In return, the edge, the cache layers, Shield enforcement,
          and our testing infrastructure all behave as one system, which is what makes the verified-caching and
          hot-swap behavior above possible.
        </p>
        </div>
      </PageSection>

      <PageSection id="fastest" title="Getting the fastest response">
        <p class="mt-4">
          Pin the full version and file path in production URLs. Exact-version requests hit the long-lived edge
          cache; unpinned requests pay a redirect first. The{" "}
          <a class={link} href="/guides">
            guides
          </a>{" "}
          cover the URL patterns in detail.
        </p>
      </PageSection>
    </MarketingPage>
  );
}

export function StatusPage({ appOrigin, esmOrigin }: { appOrigin: string; esmOrigin: string }): VNode {
  return (
    <MarketingPage
      current="/status"
      heading="Status and reliability"
      intro="Live checks against the surfaces that serve your files, run from your own browser."
    >
      <div class="mt-10">
        <Hydrate>
          <StatusChecks appOrigin={appOrigin} esmOrigin={esmOrigin} />
        </Hydrate>
      </div>

    </MarketingPage>
  );
}

export function GuidesPage({ origin }: { origin: string }): VNode {
  return (
    <MarketingPage
      current="/guides"
      heading="Guides"
      intro="Everything UNPKG can do, one topic at a time. Start with loading files, or jump to the workflow you need."
    >
      <div class="mt-8 overflow-x-auto">
        <table class="w-full text-left text-sm border-collapse">
          <thead>
            <tr class="border-b border-hairline-strong dark:border-dark-border-strong">
              <th class="py-2 pr-4 font-semibold">Guide</th>
              <th class="py-2 font-semibold">What it covers</th>
            </tr>
          </thead>
          <tbody>
            {GUIDES.map((guide) => (
              <tr class="border-b border-hairline dark:border-dark-border">
                <td class="py-2 pr-4 whitespace-nowrap align-top">
                  <a class={link} href={`/guides/${guide.slug}`}>
                    {guide.heading}
                  </a>
                </td>
                <td class="py-2 align-top">{guide.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <PageSection id="quickstart" title="Quickstart">
        <p class="mt-4">Load any file from any npm package with a script tag:</p>
        <p class="mt-6 p-4 bg-paper-alt dark:bg-dark-panel">
          <code class={code}>&lt;script src="https://unpkg.com/preact@10.26.4/dist/preact.min.js"&gt;&lt;/script&gt;</code>
        </p>
        <p class="mt-6">
          Pin the full version in production. For browser-ready modules see{" "}
          <a class={link} href="/guides/browser-modules">
            browser modules
          </a>
          ; for what's inside a package, the{" "}
          <a class={link} href="/guides/metadata-api">
            metadata API
          </a>
          .
        </p>
      </PageSection>
    </MarketingPage>
  );
}

export function GuideNotFoundPage(): VNode {
  return (
    <MarketingPage
      current="/guides"
      heading="Guide not found"
      intro="That guide doesn't exist. It may have been renamed, or the link may have a typo."
    >
      <p class="mt-6">
        Browse{" "}
        <a class={link} href="/guides">
          all guides
        </a>
        , or head back to the{" "}
        <a class={link} href="/">
          homepage
        </a>
        .
      </p>
    </MarketingPage>
  );
}

export function AboutPage(): VNode {
  return (
    <MarketingPage
      current="/about"
      heading="About UNPKG"
      intro="UNPKG is a fast, global content delivery network for everything on npm. It is an open source project, maintained in the open, and free to use."
    >
      <PageSection id="project" title="The project">
        <p class="mt-4">
          UNPKG is an{" "}
          <a class={link} href="https://github.com/unpkg" title="UNPKG on GitHub">
            open source project
          </a>
          . The code that serves unpkg.com (the Workers, the file origin, and this site) lives in the{" "}
          <a class={link} href="https://github.com/unpkg/unpkg">
            unpkg/unpkg repository
          </a>
          , and the network it runs on is described on the{" "}
          <a class={link} href="/network">
            network page
          </a>
          .
        </p>
        <p class="mt-4">
          UNPKG is not affiliated with or supported by npm in any way. Please do not contact npm for help with
          UNPKG.
        </p>
      </PageSection>

      <PageSection id="contact" title="Contact and abuse reports">
        <p class="mt-4">
          Email us at{" "}
          <a class={link} href="mailto:support@unpkg.com">
            support@unpkg.com
          </a>{" "}
          for questions, concerns, and abuse reports. You can also reach out to{" "}
          <a class={link} href="https://x.com/unpkg" title="UNPKG on X">
            @unpkg
          </a>{" "}
          on X, or open an issue in the{" "}
          <a class={link} href="https://github.com/unpkg/unpkg">
            GitHub repository
          </a>
          . If a package on npm is malicious, report it to npm as well, and see how{" "}
          <a class={link} href="https://shield.unpkg.com/">
            UNPKG Shield
          </a>{" "}
          can protect your domains from it in the meantime.
        </p>
      </PageSection>

      <PageSection id="security" title="Security">
        <p class="mt-4">
          Found a security issue in UNPKG itself? Please report it privately to{" "}
          <a class={link} href="mailto:support@unpkg.com">
            support@unpkg.com
          </a>{" "}
          rather than in a public issue. If the problem is a compromised npm release being served to your
          production pages,{" "}
          <a class={link} href="https://shield.unpkg.com/">
            UNPKG Shield
          </a>{" "}
          handles that.
        </p>
      </PageSection>

      <PageSection id="terms" title="Terms, in plain language">
        <ul class="mt-4 ml-6 list-disc list-outside">
          <li class="marker:pr-2">
            UNPKG serves files from public npm packages, as published. Package contents belong to their maintainers
            and are under their licenses.
          </li>
          <li class="marker:pr-2 mt-2">
            The service is provided free, as-is, without a contractual SLA. The{" "}
            <a class={link} href="/status">
              status page
            </a>{" "}
            describes how it is run and how we communicate about reliability.
          </li>
          <li class="mt-2">
            This website uses Google Analytics to understand aggregate usage. Serving files requires no account and
            sets no cookies of its own.
          </li>
        </ul>
      </PageSection>
    </MarketingPage>
  );
}
