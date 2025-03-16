import { type VNode, Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Hydrate } from "./hydrate.tsx";

export function Home(): VNode {
  return (
    <Fragment>
      <header class="mx-auto lg:max-w-screen-lg">
        <h1 class="mt-32 text-7xl text-center font-black text-black">UNPKG</h1>
      </header>

      <main class="mx-auto lg:max-w-screen-lg text-slate-900 leading-relaxed">
        <div class="pt-16 pb-32 px-8 lg:pt-32 lg:grid lg:grid-cols-4 lg:gap-14">
          <div class="lg:col-span-3">
            <p>
              UNPKG is a fast, global content delivery network for everything on npm. Use it to quickly and easily load
              any file on npm using a URL like:
            </p>

            <p class="mt-12 p-4 text-center bg-slate-100">
              <code class="text-sm">unpkg.com/:pkg@:ver/:file</code>
            </p>

            <section id="overview">
              <SectionHeading id="overview">Overview</SectionHeading>

              <p class="mt-2">This is the overview.</p>
            </section>

            <section id="package-indexes">
              <SectionHeading id="package-indexes">Package Indexes</SectionHeading>

              <p class="mt-2">
                Append a <code class="text-sm bg-slate-100">/</code> at the end of a URL to view a listing of all the
                files in a package root or subdirectory.
              </p>

              <ul class="mt-2 ml-2 list-disc list-inside">
                <li class="marker:pr-2">
                  <a class="text-blue-600 hover:underline" href="/react/">
                    unpkg.com/react/
                  </a>
                </li>
                <li>
                  <a class="text-blue-600 hover:underline" href="/react-router/">
                    unpkg.com/react-router/
                  </a>
                </li>
              </ul>
            </section>

            <section id="package-metadata">
              <SectionHeading id="package-metadata">Package Metadata</SectionHeading>

              <p class="mt-2">
                You can get metadata about the files in any npm package by appending{" "}
                <code class="text-sm bg-slate-100">?meta</code> to any root package URL or subdirectory URL.
              </p>

              <p class="mt-2">For example:</p>

              <ul class="mt-2 ml-2 list-disc list-inside">
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
            </section>

            <section id="cache-performance">
              <SectionHeading id="cache-performance">Cache Performance</SectionHeading>

              <p class="mt-2">
                UNPKG runs entirely on{" "}
                <a class="text-blue-600 hover:underline" href="https://www.cloudflare.com">
                  Cloudflare's
                </a>{" "}
                global edge network using{" "}
                <a class="text-blue-600 hover:underline" href="https://workers.cloudflare.com/">
                  Cloudflare Workers
                </a>
                . This allows UNPKG to scale to serve billions of requests every day with low latency from hundreds of
                locations worldwide. In addition, the "serverless" architecture of Cloudflare Workers allows UNPKG to
                scale immediately to satisfy sudden spikes in traffic.
              </p>

              <p class="mt-2">
                Files are cached based on their permanent URL, which includes the npm package version. This works
                because npm does not allow package authors to overwrite a package that has already been published with a
                different one at the same version number.
              </p>

              <p class="mt-2">
                URLs that do not specify a fully resolved package version number redirect to one that does. This is the{" "}
                <code class="text-sm bg-slate-100">latest</code> version when none is specified, or the maximum
                satisfying version when a semver range is given. For the best chance of getting a cache hit, use the
                full package version number in your UNPKG URLs instead of an npm tag or semver range.
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

          <div class="hidden lg:block lg:col-span-1">
            <div class="sticky top-12">
              <Hydrate>
                <HomeNav
                  items={{
                    overview: "Overview",
                    "package-indexes": "Package Indexes",
                    "package-metadata": "Package Metadata",
                    "cache-performance": "Cache Performance",
                    about: "About",
                  }}
                />
              </Hydrate>
            </div>
          </div>
        </div>
      </main>
    </Fragment>
  );
}

export function HomeNav({ items }: { items: Record<string, string> }): VNode {
  let [currentSectionId, setCurrentSectionId] = useState<string | null>(null);

  useEffect(() => {
    function handleScroll() {
      let sections = document.querySelectorAll("main section");
      let currentSectionId: string | undefined;

      let lastSection = sections[sections.length - 1];
      if (lastSection != null && window.scrollY + window.innerHeight >= document.body.scrollHeight - 100) {
        // Quick check to see if the window is scrolled close to the bottom. If so, just select the last section.
        currentSectionId = lastSection.id;
      } else {
        // Otherwise, find the first section whose header is close to the top of the window.
        for (let section of sections) {
          let rect = section.getBoundingClientRect();

          if (rect.top < 120 && rect.bottom > 40) {
            currentSectionId = section.id;
            break;
          }
        }

        // If we didn't find one, default to the first section.
        if (currentSectionId == null) {
          currentSectionId = sections[0]?.id;
        }
      }

      setCurrentSectionId(currentSectionId);
    }

    // Call it manually once up front
    handleScroll();

    document.addEventListener("scroll", handleScroll);

    return () => document.removeEventListener("scroll", handleScroll);
  }, []);

  let markerTop = 0;
  if (currentSectionId != null) {
    let navItem = document.getElementById(`${currentSectionId}-nav-item`)!;
    markerTop = navItem.offsetTop;
  }

  return (
    <nav class="relative border-l-1 border-gray-300 text-slate-600">
      <div class="absolute w-1 h-6.5 transition-all duration-300 bg-gray-600" style={{ top: markerTop }} />
      <ol>
        {Object.entries(items).map(([id, title]) => (
          <li id={`${id}-nav-item`} class={id === currentSectionId ? "my-2 pl-8 text-slate-900" : "my-2 pl-8"}>
            <a href={`#${id}`}>{title}</a>
          </li>
        ))}
      </ol>
    </nav>
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
