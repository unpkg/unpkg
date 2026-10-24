import highlight from "highlight.js/lib/common";
import type { ComponentChildren, VNode } from "preact";
import { render } from "preact-render-to-string";

import type { Env } from "../env.ts";
import { GitHubIcon, XIcon } from "./icons.tsx";

const homePageExample = `<script type="module">
  import React from "%%ESM_ORIGIN%%/react@18.3.1";
  import { createRoot } from "%%ESM_ORIGIN%%/react-dom@18.3.1/client";

  createRoot(document.getElementById("root")).render(
    React.createElement("h1", null, "Hello from esm.unpkg.com")
  );
</script>`;

export function createHomePage(env: Env): string {
  let wwwOrigin = env.WWW_ORIGIN.replace(/\/+$/, "");
  let esmOrigin = env.ORIGIN.replace(/\/+$/, "");
  let exampleHtml = highlight.highlight(homePageExample.replaceAll("%%ESM_ORIGIN%%", esmOrigin), {
    language: "xml",
  }).value;

  return (
    "<!DOCTYPE html>" +
    render(
      <Document origin={esmOrigin} wwwOrigin={wwwOrigin}>
        <Header wwwOrigin={wwwOrigin} />
        <main>
          <div class="content">
            <section>
              <p>
                <strong>esm.unpkg.com is currently in beta.</strong> It serves browser-ready ES modules from npm
                packages using UNPKG infrastructure. Use it when a package is not already published as browser-ready ESM
                and you want to load it directly in modern browsers without a build step.
              </p>

              <p class="callout">
                <code>{esmOrigin}/:package@:version/:subpath</code>
              </p>
            </section>

            <section>
              <h2>Example</h2>
              <p>
                Import packages from <code>esm.unpkg.com</code> in a module script:
              </p>

              <div class="code-frame">
                <div class="code-head" aria-hidden="true">
                  <span />
                  <span />
                  <span class="on" />
                </div>
                <div class="code-block hljs-listing">
                  <code dangerouslySetInnerHTML={{ __html: exampleHtml }} />
                </div>
              </div>
            </section>

            <section>
              <h2>Usage</h2>
              <ul>
                <li>
                  Omit the version to use the package&apos;s <code>latest</code> npm tag.
                </li>
                <li>Use npm dist-tags, semver ranges, or exact versions in the URL.</li>
                <li>
                  Add <code>?target=es2022</code> to choose an output target.
                </li>
                <li>
                  Add <code>?dev</code> for development builds.
                </li>
                <li>
                  Add <code>?meta</code> to inspect resolved module metadata.
                </li>
              </ul>
            </section>

            <section>
              <h2>Documentation</h2>
              <p>
                The full reference — every parameter, stylesheet handling, and error format — lives in the{" "}
                <a class="inline-link" href={`${wwwOrigin}/guides/browser-modules`}>
                  browser modules guide
                </a>{" "}
                on the main UNPKG site. This page is only a pointer; the guide is the canonical documentation.
              </p>
            </section>
          </div>
        </main>
        <Footer />
      </Document>
    )
  );
}

function Document({ children, origin, wwwOrigin }: { children: ComponentChildren; origin: string; wwwOrigin: string }): VNode {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Browser-ready ES modules from npm packages, served by UNPKG. Full documentation lives in the UNPKG browser modules guide." />
        <link rel="canonical" href={`${wwwOrigin}/guides/browser-modules`} />
        <meta name="color-scheme" content="light dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("unpkg-theme");if(t!=="light"&&t!=="dark"){var m=document.cookie.match(/(?:^|; )unpkg-theme=(light|dark)/);t=m?m[1]:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}`,
          }}
        />

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="UNPKG" />
        <meta property="og:title" content="UNPKG ESM — Browser-ready ES modules from npm" />
        <meta property="og:description" content="Browser-ready npm package imports from UNPKG." />
        <meta property="og:image" content={new URL("/social-card.png", origin).href} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:alt" content="Browser-ready npm package imports from UNPKG." />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@unpkg" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <title>UNPKG ESM — Browser-ready ES modules from npm</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `var b=document.getElementById("theme-toggle");if(b){b.addEventListener("click",function(){var n=document.documentElement.dataset.theme==="dark"?"light":"dark";document.documentElement.dataset.theme=n;try{localStorage.setItem("unpkg-theme",n);}catch(e){}var c="unpkg-theme="+n+"; path=/; max-age=31536000; SameSite=Lax";var p=location.hostname.split(".");if(p.length>=2){c+="; domain=."+p.slice(-2).join(".");}document.cookie=c;});}`,
          }}
        />
      </body>
    </html>
  );
}

function Header({ wwwOrigin }: { wwwOrigin: string }): VNode {
  return (
    <>
      <div class="topbar">
        <nav>
          <a class="brand" href={`${wwwOrigin}/`}>
            UNPKG
          </a>
          <span class="nav-links">
            <a href={`${wwwOrigin}/guides/browser-modules`}>Browser modules guide →</a>
            <button type="button" id="theme-toggle" aria-label="Toggle dark mode" title="Toggle dark mode">
              <svg class="theme-icon-moon" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" width="20" height="20">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
              </svg>
              <svg class="theme-icon-sun" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" width="20" height="20">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
              </svg>
            </button>
          </span>
        </nav>
      </div>
      <header>
        <h1>UNPKG ESM</h1>
      </header>
    </>
  );
}

function Footer(): VNode {
  return (
    <footer>
      <span class="footer-brand">
        UNPKG
        <span class="footer-icons">
          <a href="https://github.com/unpkg" title="UNPKG on GitHub" aria-label="UNPKG on GitHub">
            <GitHubIcon />
          </a>
          <a href="https://x.com/unpkg" title="UNPKG on X" aria-label="UNPKG on X">
            <XIcon />
          </a>
        </span>
      </span>
      <span>
        Contact us{" "}
        <a href="mailto:support@unpkg.com">support@unpkg.com</a>
      </span>
    </footer>
  );
}

const pageStyles = `
* { box-sizing: border-box; }
body {
  margin: 0;
  color: #0e1a23;
  background: #fbfaf7;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.625;
}
header, main, footer {
  max-width: 768px;
  margin-left: auto;
  margin-right: auto;
}
header {
  padding: 6rem 2rem 0;
  text-align: center;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fbfaf7;
  border-bottom: 1px solid #ede7dc;
}
.topbar nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 768px;
  margin: 0 auto;
  padding: 1rem 2rem;
  font-size: 0.95rem;
}
.topbar .brand {
  color: #0e1a23;
  font-weight: 900;
  font-size: 1.5rem;
}
.topbar .nav-links {
  display: inline-flex;
  align-items: center;
  gap: 1.25rem;
}
#theme-toggle {
  background: none;
  border: 0;
  padding: 0.375rem;
  border-radius: 0.375rem;
  cursor: pointer;
  color: inherit;
  line-height: 0;
}
#theme-toggle:hover {
  background: #f4f1eb;
}
[data-theme="light"] {
  color-scheme: light;
}
[data-theme="light"] .theme-icon-sun {
  display: none;
}
[data-theme="dark"] .theme-icon-moon {
  display: none;
}
.code-frame {
  margin-top: 3rem;
  border: 1px solid #d9d2c5;
  background: #fff;
}
.code-head {
  display: flex;
  gap: 0.375rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #ede7dc;
}
.code-head span {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 9999px;
  background: #d9d2c5;
}
.code-head span.on {
  background: #3a6b7a;
}
.code-frame .code-block {
  margin-top: 0;
}
.footer-brand {
  display: inline-flex;
  align-items: center;
  gap: 1rem;
  font-weight: 900;
  color: #0e1a23;
}
.footer-icons {
  display: inline-flex;
  gap: 1rem;
}
h1 {
  margin: 0;
  color: #000;
  font-size: 4.5rem;
  line-height: 1;
  font-weight: 900;
  letter-spacing: 0;
}
main {
  max-width: 100%;
  padding: 4rem 2rem 8rem;
}
.content {
  max-width: 768px;
  margin-left: auto;
  margin-right: auto;
}
section + section {
  margin-top: 4rem;
}
h2 {
  margin: 0 0 1rem;
  color: #0f172a;
  font-size: 1.25rem;
  line-height: 1.3;
  letter-spacing: 0;
}
p {
  margin: 1rem 0 0;
}
ul {
  margin: 1rem 0 0 1.5rem;
  padding: 0;
  list-style: disc outside;
}
li + li {
  margin-top: 0.35rem;
}
a {
  color: #3a6b7a;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
code {
  border-radius: 0;
  background: #f4f1eb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.875rem;
  padding: 0.1rem 0.25rem;
}
.code-block {
  margin-top: 3rem;
  overflow-x: auto;
  background: #f1f5f9;
  padding: 1rem;
  text-align: left;
}
.code-block code {
  display: block;
  min-width: max-content;
  background: transparent;
  padding: 0;
  white-space: pre;
}
.hljs-listing {
  background: #fbfdff;
  color: #383a42;
}
.hljs-comment,
.hljs-quote {
  color: #a0a1a7;
  font-style: italic;
}
.hljs-doctag,
.hljs-keyword,
.hljs-link,
.hljs-formula {
  color: #a626a4;
}
.hljs-section,
.hljs-name,
.hljs-selector-tag,
.hljs-deletion,
.hljs-subst {
  color: #e45649;
}
.hljs-literal {
  color: #0184bb;
}
.hljs-string,
.hljs-regexp,
.hljs-addition,
.hljs-attribute,
.hljs-meta-string {
  color: #50a14f;
}
.hljs-built_in,
.hljs-class .hljs-title {
  color: #c18401;
}
.hljs-attr,
.hljs-variable,
.hljs-template-variable,
.hljs-type,
.hljs-selector-class,
.hljs-selector-attr,
.hljs-selector-pseudo,
.hljs-number {
  color: #986801;
}
.hljs-symbol,
.hljs-bullet,
.hljs-meta,
.hljs-selector-id,
.hljs-title {
  color: #4078f2;
}
.hljs-emphasis {
  font-style: italic;
}
.hljs-strong {
  font-weight: bold;
}
.callout {
  margin-top: 3rem;
  background: #f4f1eb;
  padding: 1rem;
  text-align: center;
}
footer {
  border-top: 1px solid #ede7dc;
  color: #475569;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 2rem 2rem 6rem;
  font-size: 0.875rem;
}
footer a {
  color: #475569;
  display: inline-flex;
  line-height: 0;
}
footer a:hover {
  color: #0f172a;
}
footer a:focus-visible {
  color: #0f172a;
  outline: 2px solid #64748b;
  outline-offset: 0.25rem;
}
footer svg {
  width: 1.5rem;
  height: 1.5rem;
}
@media (max-width: 640px) {
  header { padding-top: 5rem; }
  h1 { font-size: 3.5rem; }
  main { padding-top: 3rem; }
}
[data-theme="dark"] body {
    color: #fff;
    background: #0e1a23;
  }
[data-theme="dark"] h1 {
    color: #fff;
  }
[data-theme="dark"] h2 {
    color: #fff;
  }
[data-theme="dark"] a {
    color: #9cc2cc;
  }
[data-theme="dark"] header nav .brand {
    color: #fff;
  }
[data-theme="dark"] p,
[data-theme="dark"] li {
    color: rgb(255 255 255 / 70%);
  }
[data-theme="dark"] strong,
[data-theme="dark"] code {
    color: #fff;
  }
[data-theme="dark"] .inline-link {
    text-decoration: underline;
    text-underline-offset: 0.125em;
  }
[data-theme="dark"] code,
[data-theme="dark"] .callout {
    background: #081118;
  }
[data-theme="dark"] .hljs-listing {
    background: #081118;
    color: #d5ced9;
  }
[data-theme="dark"] .hljs-comment,
[data-theme="dark"] .hljs-quote {
    color: #a0a1a7cc;
  }
[data-theme="dark"] .hljs-doctag,
[data-theme="dark"] .hljs-keyword,
[data-theme="dark"] .hljs-link,
[data-theme="dark"] .hljs-formula {
    color: #c74ded;
  }
[data-theme="dark"] .hljs-section {
    color: #ff00aa;
  }
[data-theme="dark"] .hljs-name,
[data-theme="dark"] .hljs-selector-tag {
    color: #f92672;
  }
[data-theme="dark"] .hljs-deletion {
    color: #ee5d43;
  }
[data-theme="dark"] .hljs-subst {
    color: #d5ced9;
  }
[data-theme="dark"] .hljs-literal {
    color: #ee5d43;
  }
[data-theme="dark"] .hljs-symbol,
[data-theme="dark"] .hljs-selector-id {
    color: #ee5d43;
  }
[data-theme="dark"] .hljs-bullet,
[data-theme="dark"] .hljs-title {
    color: #ffe66d;
  }
[data-theme="dark"] .hljs-meta {
    color: #c74ded;
  }
[data-theme="dark"] .hljs-string,
[data-theme="dark"] .hljs-addition,
[data-theme="dark"] .hljs-meta-string {
    color: #96e072;
  }
[data-theme="dark"] .hljs-regexp {
    color: #7cb7ff;
  }
[data-theme="dark"] .hljs-attribute {
    color: #ffe66d;
  }
[data-theme="dark"] .hljs-built_in,
[data-theme="dark"] .hljs-class .hljs-title {
    color: #ffe66d;
  }
[data-theme="dark"] .hljs-attr,
[data-theme="dark"] .hljs-variable,
[data-theme="dark"] .hljs-template-variable,
[data-theme="dark"] .hljs-type,
[data-theme="dark"] .hljs-selector-class,
[data-theme="dark"] .hljs-selector-attr,
[data-theme="dark"] .hljs-selector-pseudo {
    color: #00e8c6;
  }
[data-theme="dark"] .hljs-number {
    color: #f39c12;
  }
[data-theme="dark"] footer {
    border-color: #223645;
    color: rgb(255 255 255 / 70%);
  }
[data-theme="dark"] footer a {
    color: #fff;
  }
[data-theme="dark"] footer a:hover,
[data-theme="dark"] footer a:focus-visible {
    color: #fff;
  }
[data-theme="dark"] footer a:focus-visible {
    outline-color: #a3a3a3;
  }
`;
