import { type VNode, Fragment } from "preact";

import { CodeBlock } from "./code-block.tsx";
import { HomeNav } from "./home-nav.tsx";
import { Hydrate } from "./hydrate.tsx";

export function Home(): VNode {
  let navItems = {
    overview: "Overview",
    "browsing-files": "Browsing Files",
    "metadata-api": "Metadata API",
    "cache-performance": "Cache Performance",
    about: "About",
  };

  return (
    <Fragment>
      <header class="mx-auto lg:max-w-screen-md">
        <h1 class="mt-32 text-7xl text-center font-black text-black">UNPKG</h1>
      </header>

      <main class="mx-auto lg:max-w-screen-md text-slate-900 leading-relaxed">
        <div class="relative mt-16 mb-32 px-8 lg:mt-32">
          <div>
            <section id="overview">
              <p>
                UNPKG is a fast, global content delivery network for everything on{" "}
                <a class="text-blue-600 hover:underline" href="https://www.npmjs.com/">
                  npm
                </a>{" "}
                . Use it to quickly and easily load any file on npm using a URL like:
              </p>

              <p class="mt-12 p-4 text-center bg-slate-100">
                <code class="text-sm sm:hidden">unpkg.com/:pkg@:ver/:file</code>
                <code class="text-sm hidden sm:block">https://unpkg.com/:package@:version/:file</code>
              </p>

              <p class="mt-12">Where:</p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li class="marker:pr-2">
                  <span>
                    <code class="text-sm bg-slate-100 sm:hidden">:pkg</code>
                    <code class="text-sm bg-slate-100 hidden sm:inline">:package</code>
                  </span>{" "}
                  is the name of the package on npm
                </li>
                <li class="marker:pr-2">
                  <span>
                    <code class="text-sm bg-slate-100 sm:hidden">:ver</code>
                    <code class="text-sm bg-slate-100 hidden sm:inline">:version</code>
                  </span>{" "}
                  is the version of the package
                </li>
                <li>
                  <code class="text-sm bg-slate-100">:file</code> is the path to a file in the package
                </li>
              </ul>

              <p class="mt-4">Using a fixed version number:</p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react@18.3.1/umd/react.production.min.js">
                    unpkg.com/react@18.3.1/umd/react.production.min.js
                  </a>
                </li>
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/preact@10.26.4/dist/preact.min.js">
                    unpkg.com/preact@10.26.4/dist/preact.min.js
                  </a>
                </li>
              </ul>

              <p class="mt-4">
                You can also use any valid{" "}
                <a class="text-blue-600 hover:underline" href="https://docs.npmjs.com/about-semantic-versioning">
                  semver
                </a>{" "}
                range or{" "}
                <a class="text-blue-600 hover:underline" href="https://docs.npmjs.com/adding-dist-tags-to-packages">
                  npm tag
                </a>
                :
              </p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react@^18/umd/react.production.min.js">
                    unpkg.com/react@^18/umd/react.production.min.js
                  </a>
                </li>
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/preact@latest/dist/preact.min.js">
                    unpkg.com/preact@latest/dist/preact.min.js
                  </a>
                </li>
              </ul>

              <p class="mt-4">
                If you don't specify a version, the <code class="text-sm bg-slate-100">latest</code> tag is used by
                default:
              </p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li>
                  <a class="text-blue-600 hover:underline" href="/preact/dist/preact.min.js">
                    unpkg.com/preact/dist/preact.min.js
                  </a>
                </li>
                <li>
                  <a class="text-blue-600 hover:underline" href="/vue/dist/vue.esm-browser.prod.js">
                    unpkg.com/vue/dist/vue.esm-browser.prod.js
                  </a>
                </li>
              </ul>

              <p class="mt-4">If you don't specify a file path, </p>
            </section>

            <section id="browsing-files">
              <SectionHeading id="browsing-files">Browsing Files</SectionHeading>

              <p class="mt-4">
                In addition to being a global content-delivery network, UNPKG is also allows you to browse and link to
                individual files on npm. Just append a <code class="text-sm bg-slate-100">/</code> at the end of any
                directory URL to view a listing of all the files in a package or any of its folders.
              </p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react/">
                    unpkg.com/react/
                  </a>
                </li>
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/preact/src/">
                    unpkg.com/preact/src/
                  </a>
                </li>
                <li>
                  <a class="text-blue-600 hover:underline" href="/react-router/">
                    unpkg.com/react-router/
                  </a>
                </li>
              </ul>

              <p class="mt-4">
                If you'd like to browse an older version of a package, include the version number in the URL.
              </p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react@18/">
                    unpkg.com/react@18/
                  </a>
                </li>
                <li>
                  <a class="text-blue-600 hover:underline" href="/react-router@5/">
                    unpkg.com/react-router@5/
                  </a>
                </li>
              </ul>
            </section>

            <section id="metadata-api">
              <SectionHeading id="metadata-api">Metadata API</SectionHeading>

              <p class="mt-4">
                UNPKG serves metadata about the files in a package when you append{" "}
                <code class="text-sm bg-slate-100">?meta</code> to any package root or subdirectory URL.
              </p>

              <p class="mt-4">For example:</p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li>
                  <a class="text-blue-600 hover:underline" href="/react@19.0.0/?meta">
                    unpkg.com/react@19.0.0/?meta
                  </a>
                </li>
                <li>
                  <a class="text-blue-600 hover:underline" href="/react@19.0.0/cjs/?meta">
                    unpkg.com/react@19.0.0/cjs/?meta
                  </a>
                </li>
              </ul>

              <p class="mt-4">
                This will return a JSON object with information about the files in that directory, including path, size,
                type, and{" "}
                <a
                  class="text-blue-600 hover:underline"
                  href="https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity"
                >
                  subresource integrity
                </a>{" "}
                value.
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                {
                  package: "react",
                  version: "19.0.0",
                  prefix: "/",
                  files: [
                    {
                      path: "/LICENSE",
                      size: 1088,
                      type: "text/plain",
                      integrity: "sha256-2m03A+0Ry+Qr0hLHJZV8mNojy/8ZmMBfpLPZdtGljpM="
                    },
                    {
                      path: "/index.js",
                      size: 186,
                      type: "text/javascript",
                      integrity: "sha256-YMr/3svcXbO8TsToPflIg0XMsnHQdTO5IQv1dQkY2X4="
                    },
                    // ...
                  ]
                }`}
                </CodeBlock>
              </div>
            </section>

            <section id="cache-performance">
              <SectionHeading id="cache-performance">Cache Performance</SectionHeading>

              <p class="mt-2">
                UNPKG is a mirror of everything on npm. Every file on npm is automatically available on unpkg.com within
                minutes of it being published.
              </p>

              <p class="mt-2">
                Additionally, UNPKG runs on{" "}
                <a class="text-blue-600 hover:underline" href="https://www.cloudflare.com">
                  Cloudflare's
                </a>{" "}
                global edge network using{" "}
                <a class="text-blue-600 hover:underline" href="https://workers.cloudflare.com/">
                  Cloudflare Workers
                </a>
                , which allow UNPKG to serve billions of requests every day with low latency from hundreds of locations
                worldwide. The "serverless" nature of Cloudflare Workers also allows UNPKG to scale immediately to
                satisfy sudden spikes in traffic.
              </p>

              <p class="mt-2">
                Files are cached on Cloudflare's global content-delivery network based on their permanent URL, which
                includes the npm package version. This works because npm does not allow package authors to overwrite a
                package that has already been published with a different one at the same version number.
              </p>

              <p class="mt-2">
                URLs that do not specify a fully resolved package version number redirect to one that does. This is the{" "}
                <code class="text-sm bg-slate-100">latest</code> version when none is specified, or the maximum
                satisfying version when a semver range is given.{" "}
                <span class="font-semibold">
                  For the best chance of getting a cache hit, use the full package version number and file path in your
                  UNPKG URLs instead of an npm tag or semver range
                </span>
                .
              </p>

              <p class="mt-2">
                For example, a URL like{" "}
                <a class="text-blue-600 hover:underline" href="/preact@10">
                  unpkg.com/preact@10
                </a>{" "}
                will not be a direct cache hit because UNPKG needs to resolve the version{" "}
                <code class="text-sm bg-slate-100">10</code> to the latest matching version of Preact published with
                that major, plus it needs to figure out which file to serve. So a short URL like this will always cause
                a redirect to the permanent URL for that resource. If you need to make sure you hit the cache, use a
                fixed version number and the full file path, like{" "}
                <a class="text-blue-600 hover:underline" href="/preact@10.5.0/dist/preact.min.js">
                  unpkg.com/preact@10.5.0/dist/preact.min.js
                </a>
                .
              </p>
            </section>

            <section id="about">
              <SectionHeading id="about">About</SectionHeading>

              <p class="mt-2">
                UNPKG is an{" "}
                <a class="text-blue-600 hover:underline" href="https://github.com/unpkg" title="UNPKG on GitHub">
                  open source project
                </a>{" "}
                from{" "}
                <a class="text-blue-600 hover:underline" href="https://x.com/mjackson" title="mjackson on X">
                  @mjackson
                </a>
                . UNPKG is not affiliated with or supported by npm in any way. Please do not contact npm for help with
                UNPKG. Instead, please reach out to{" "}
                <a class="text-blue-600 hover:underline" href="https://x.com/unpkg" title="UNPKG on X">
                  @unpkg
                </a>{" "}
                with any questions or concerns.
              </p>
            </section>
          </div>

          <div class="hidden xl:block absolute h-full w-48 top-0 -right-52">
            <div class="sticky top-12">
              <Hydrate>
                <HomeNav items={navItems} />
              </Hydrate>
            </div>
          </div>
        </div>
      </main>
    </Fragment>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }): VNode {
  return (
    <h2 class="mt-16 mb-8 text-lg font-semibold group">
      {children}{" "}
      <a
        class="outline-none after:content-['#'] after:ml-1 after:text-slate-300 after:opacity-0 group-hover:after:opacity-100 after:transition-opacity"
        href={`#${id}`}
      />
    </h2>
  );
}
