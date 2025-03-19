import { type VNode, Fragment } from "preact";

import { CodeBlock } from "./code-block.tsx";
import { HomeNav } from "./home-nav.tsx";
import { Hydrate } from "./hydrate.tsx";

export function Home(): VNode {
  let navItems = {
    overview: "Overview",
    "buildless-apps": "Buildless Apps",
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

              <ul class="mt-12 ml-6 list-disc list-outside">
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

              <p class="mt-4">For example:</p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/preact@10.26.4/dist/preact.min.js">
                    unpkg.com/preact@10.26.4/dist/preact.min.js
                  </a>
                </li>
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react@18.3.1/umd/react.production.min.js">
                    unpkg.com/react@18.3.1/umd/react.production.min.js
                  </a>
                </li>
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/three@0.174.0/build/three.module.min.js">
                    unpkg.com/three@0.174.0/build/three.module.min.js
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
                  <a class="text-blue-600 hover:underline" href="/preact@latest/dist/preact.min.js">
                    unpkg.com/preact@latest/dist/preact.min.js
                  </a>
                </li>
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react@^18/umd/react.production.min.js">
                    unpkg.com/react@^18/umd/react.production.min.js
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

              <div class="mt-4 bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4" role="alert">
                <p>
                  <span class="font-bold">Note:</span> According to{" "}
                  <a href="https://semver.org" class="underline underline-offset-4 decoration-dashed pb-2">
                    semver
                  </a>
                  , packages are allowed to publish breaking changes with a major release. This includes changes to
                  public API, but also may include moving files around inside a package. So it's always a good idea to
                  include a specific version number (or at least a version range) in your URLs.
                </p>
              </div>

              <p class="mt-4">
                If you don't specify a file path, UNPKG will resolve the file based on the package's default{" "}
                <a
                  class="text-blue-600 hover:underline"
                  href="https://nodejs.org/api/packages.html#package-entry-points"
                >
                  entry point
                </a>
                . In older packages like jQuery, this will be the value of{" "}
                <a class="text-blue-600 hover:underline" href="https://nodejs.org/api/packages.html#main">
                  the <code class="text-sm bg-slate-100">main</code> field
                </a>{" "}
                in the <code class="text-sm bg-slate-100">package.json</code> file.
              </p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li>
                  <a class="text-blue-600 hover:underline" href="/jquery">
                    unpkg.com/jquery
                  </a>
                </li>
              </ul>

              <p class="mt-4">
                In modern packages that use{" "}
                <a class="text-blue-600 hover:underline" href="https://nodejs.org/api/packages.html#exports">
                  exports
                </a>
                , UNPKG will resolve the file using the <code class="text-sm bg-slate-100">default</code>{" "}
                <a
                  class="text-blue-600 hover:underline"
                  href="https://nodejs.org/api/packages.html#conditional-exports"
                >
                  export condition
                </a>
                .
              </p>

              <p class="mt-4">
                So, for example if you publish a package with the following{" "}
                <code class="text-sm bg-slate-100">package.json</code>:
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  {
                    "name": "my-package",
                    "exports": {
                      "default": "./dist/index.js"
                    }
                  }
                `}
                </CodeBlock>
              </div>

              <p class="mt-8">You would be able to load your package from UNPKG using a script tag like this:</p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  <script src="https://unpkg.com/my-package"></script>
                `}
                </CodeBlock>
              </div>

              <p class="mt-8">
                The full <code class="text-sm bg-slate-100">exports</code> spec is supported, including subpaths. So if
                your <code class="text-sm bg-slate-100">package.json</code> looks like this:
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  {
                    "name": "my-package",
                    "exports": {
                      "./exp": {
                        "default": "./dist/exp.js"
                      }
                    }
                  }
                `}
                </CodeBlock>
              </div>

              <p class="mt-8">
                You can load the <code class="text-sm bg-slate-100">exp</code> subpath like this:
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  <script src="https://unpkg.com/my-package/exp"></script>
                `}
                </CodeBlock>
              </div>

              <p class="mt-8">
                Custom export conditions are supported via the <code class="text-sm bg-slate-100">?conditions</code>{" "}
                query parameter. This allows you to load a different file based on the environment or other conditions.
                For example, to fetch React using the <code class="text-sm bg-slate-100">react-server</code> condition:
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  fetch("https://unpkg.com/react?conditions=react-server")
                `}
                </CodeBlock>
              </div>

              <p class="mt-8">Or link to it:</p>

              <ul class="mt-4 ml-6 list-disc list-outside">
                <li>
                  <a class="text-blue-600 hover:underline" href="/react?conditions=react-server">
                    unpkg.com/react?conditions=react-server
                  </a>
                </li>
              </ul>

              <p class="mt-8">
                If you'd like to specify a custom build of your package that should be used as the default entry point
                on UNPKG, you can use either the <code class="text-sm bg-slate-100">unpkg</code> field in your{" "}
                <code class="text-sm bg-slate-100">package.json</code> or the{" "}
                <code class="text-sm bg-slate-100">unpkg</code> export condition in your{" "}
                <code class="text-sm bg-slate-100">exports</code> field.
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  {
                    "name": "my-package",
                    "unpkg": "./dist/index.unpkg.js", // This works
                    "exports": {
                      "unpkg": "./dist/index.unpkg.js" // This works, too
                      "default": "./dist/index.js"
                    }
                  }
                `}
                </CodeBlock>
              </div>
            </section>

            <section id="buildless-apps">
              <SectionHeading id="buildless-apps">Buildless Apps</SectionHeading>

              <p class="mt-4">
                UNPKG is ideal for building apps that run entirely in the browser without a build step. You can load{" "}
                <a
                  class="text-blue-600 hover:underline"
                  href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules"
                >
                  JavaScript modules
                </a>{" "}
                from UNPKG directly in your HTML using an{" "}
                <a
                  class="text-blue-600 hover:underline"
                  href="https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap"
                >
                  import map
                </a>
                .
              </p>

              <div class="mt-8">
                <CodeBlock>
                  {`
                  <!doctype html>
                  <html lang="en">
                    <head>
                      <meta charset="UTF-8" />
                      <script type="importmap">
                        {
                          "imports": {
                            "preact": "https://unpkg.com/preact@10.25.4/dist/preact.module.js",
                            "preact/hooks": "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js",
                            "htm": "https://unpkg.com/htm@3.1.1/dist/htm.module.js"
                          }
                        }
                      </script>
                    </head>
                    <body>
                      <script type="module">
                        import { h, render } from "preact";
                        import { useState } from "preact/hooks";
                        import htm from "htm";

                        const html = htm.bind(h);

                        function App() {
                          let [count, setCount] = useState(0);

                          return html\`
                            <div>
                              <p>Count: $\{count\}</p>
                              <button onClick=$\{() => setCount(count + 1)\}>Increment</button>
                            </div>
                          \`;
                        }

                        render(html\`<$\{App\} />\`, document.body);
                      </script>
                    </body>
                  </html>

                `}
                </CodeBlock>
              </div>

              <p class="mt-8">
                No bundler required! This is ideal for small projects, prototypes, or any situation where you'd like to
                get something up and running quickly without setting up a build pipeline.
              </p>
            </section>

            <section id="browsing-files">
              <SectionHeading id="browsing-files">Browsing Files</SectionHeading>

              <p class="mt-4">
                In addition to loading files, UNPKG is also allows you to browse and link to individual files on npm.
                Just append a <code class="text-sm bg-slate-100">/</code> at the end of any directory URL to view a
                listing of all the files in a package or any of its folders.
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
                If you'd like to browse an older version of a package, include a version number in the URL.
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
                minutes of being published.
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
