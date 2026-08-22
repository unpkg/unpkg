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
      <Document>
        <Header />
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

              <div class="code-block hljs-listing">
                <code dangerouslySetInnerHTML={{ __html: exampleHtml }} />
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
                  Add <code>?bundle</code>, <code>?standalone</code>, or <code>?no-bundle</code> to control bundling.
                </li>
                <li>
                  Add <code>?meta</code> to inspect resolved module metadata.
                </li>
              </ul>
            </section>

            <section>
              <h2>Documentation</h2>
              <p>
                For official UNPKG documentation, including package URLs, exports, metadata, import maps, and browser
                module options, visit the <a href={`${wwwOrigin}/`}>main UNPKG home page</a>. The browser modules section
                is available at <a href={`${wwwOrigin}/#browser-modules`}>{wwwOrigin}/#browser-modules</a>.
              </p>
            </section>
          </div>
        </main>
        <Footer />
      </Document>
    )
  );
}

function Document({ children }: { children: ComponentChildren }): VNode {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Browser-ready npm package imports from UNPKG." />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <title>UNPKG ESM</title>
        <style dangerouslySetInnerHTML={{ __html: pageStyles }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

function Header(): VNode {
  return (
    <header>
      <h1>UNPKG ESM</h1>
    </header>
  );
}

function Footer(): VNode {
  return (
    <footer>
      <a href="https://github.com/unpkg" title="UNPKG on GitHub" aria-label="UNPKG on GitHub">
        <GitHubIcon />
      </a>
      <a href="https://x.com/unpkg" title="UNPKG on X" aria-label="UNPKG on X">
        <XIcon />
      </a>
    </footer>
  );
}

const pageStyles = `
* { box-sizing: border-box; }
body {
  margin: 0;
  color: #0f172a;
  background: white;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.625;
}
header, main, footer {
  max-width: 768px;
  margin-left: auto;
  margin-right: auto;
}
header {
  padding: 8rem 2rem 0;
  text-align: center;
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
  color: #2563eb;
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
code {
  border-radius: 0;
  background: #f1f5f9;
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
  background: #f1f5f9;
  padding: 1rem;
  text-align: center;
}
footer {
  border-top: 1px solid #e2e8f0;
  color: #475569;
  display: flex;
  align-items: center;
  justify-content: center;
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
@media (prefers-color-scheme: dark) {
  body {
    color: #fff;
    background: #000;
  }
  h1 {
    color: #fff;
  }
  h2 {
    color: #fff;
  }
  a {
    color: #7cb7ff;
  }
  main a {
    text-decoration: underline;
    text-underline-offset: 0.125em;
  }
  code,
  .callout {
    background: #111;
  }
  .hljs-listing {
    background: #000;
    color: #d5ced9;
  }
  .hljs-comment,
  .hljs-quote {
    color: #a0a1a7cc;
  }
  .hljs-doctag,
  .hljs-keyword,
  .hljs-link,
  .hljs-formula {
    color: #c74ded;
  }
  .hljs-section {
    color: #ff00aa;
  }
  .hljs-name,
  .hljs-selector-tag {
    color: #f92672;
  }
  .hljs-deletion {
    color: #ee5d43;
  }
  .hljs-subst {
    color: #d5ced9;
  }
  .hljs-literal {
    color: #ee5d43;
  }
  .hljs-symbol,
  .hljs-selector-id {
    color: #ee5d43;
  }
  .hljs-bullet,
  .hljs-title {
    color: #ffe66d;
  }
  .hljs-meta {
    color: #c74ded;
  }
  .hljs-string,
  .hljs-addition,
  .hljs-meta-string {
    color: #96e072;
  }
  .hljs-regexp {
    color: #7cb7ff;
  }
  .hljs-attribute {
    color: #ffe66d;
  }
  .hljs-built_in,
  .hljs-class .hljs-title {
    color: #ffe66d;
  }
  .hljs-attr,
  .hljs-variable,
  .hljs-template-variable,
  .hljs-type,
  .hljs-selector-class,
  .hljs-selector-attr,
  .hljs-selector-pseudo {
    color: #00e8c6;
  }
  .hljs-number {
    color: #f39c12;
  }
  footer {
    border-color: #262626;
    color: #d4d4d4;
  }
  footer a {
    color: #fff;
  }
  footer a:hover,
  footer a:focus-visible {
    color: #fff;
  }
  footer a:focus-visible {
    outline-color: #a3a3a3;
  }
}
`;
