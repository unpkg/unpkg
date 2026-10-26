import { type VNode, Fragment } from "preact";

/**
 * Shared site chrome for the marketing pages (home, /network, /status,
 * /guides, /about). Branding intentionally matches the long-standing
 * homepage: black UNPKG wordmark, slate text, blue links, slate panels,
 * and the dark-mode tokens from assets/styles.css. No new colors/fonts.
 */

export const btnPrimary =
  "inline-block px-5 py-2.5 rounded-md bg-accent-deep text-white font-semibold hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-deep";
export const btnSecondary =
  "inline-block px-5 py-2.5 rounded-md border border-hairline-strong dark:border-dark-border-strong bg-white dark:bg-dark-panel text-ink dark:text-dark-foreground font-semibold hover:border-accent dark:hover:border-dark-link focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-deep";

export const SITE_NAV = [
  { path: "/", label: "Overview" },
  { path: "/network", label: "Network" },
  { path: "/guides", label: "Guides" },
  { path: "/status", label: "Status" },
  { path: "/about", label: "About" },
] as const;

export function SiteHeader({ current }: { current: string }): VNode {
  return (
    <header class="sticky top-0 z-10 bg-paper dark:bg-dark-page border-b border-hairline dark:border-dark-border">
      <div class="mx-auto lg:max-w-screen-md px-8 py-4 flex items-center justify-between gap-6">
        <a href="/" class="text-2xl font-black text-ink dark:text-dark-foreground" aria-label="UNPKG home">
          UNPKG
        </a>
        <nav aria-label="Site">
          <ul class="flex flex-wrap items-center gap-x-5 gap-y-1 text-base text-slate-600 dark:text-dark-secondary">
            {SITE_NAV.filter((item) => item.path !== "/").map((item) => (
              <li key={item.path}>
                <a
                  href={item.path}
                  aria-current={current === item.path ? "page" : undefined}
                  class={
                    current === item.path
                      ? "text-accent-deep dark:text-dark-link font-semibold hover:underline"
                      : "hover:text-slate-900 dark:hover:text-dark-foreground hover:underline"
                  }
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href="https://shield.unpkg.com/"
                class="hover:text-slate-900 dark:hover:text-dark-foreground hover:underline"
              >
                Shield
              </a>
            </li>
            <li>
              <button
                type="button"
                id="theme-toggle"
                aria-label="Toggle dark mode"
                title="Toggle dark mode"
                class="block p-1.5 rounded-md hover:bg-paper-alt dark:hover:bg-dark-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-deep"
              >
                <svg class="theme-icon-moon w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
                </svg>
                <svg class="theme-icon-sun w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
                </svg>
              </button>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter(): VNode {
  return (
    <footer class="border-t border-hairline dark:border-dark-border text-slate-600 dark:text-dark-secondary">
      <div class="mx-auto lg:max-w-screen-md px-8 pt-10 pb-24 flex flex-wrap items-start justify-between gap-6">
        <div>
          <p class="text-lg font-black text-ink dark:text-dark-foreground">UNPKG</p>
          <p class="mt-2 text-sm">The CDN for everything on npm. Open source and free to use.</p>
          <p class="mt-4 flex items-center gap-4">
            <a
              class="text-slate-600 dark:text-dark-foreground hover:text-slate-950 dark:hover:text-dark-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-500 dark:focus-visible:outline-dark-muted"
              href="https://github.com/unpkg"
              title="UNPKG on GitHub"
              aria-label="UNPKG on GitHub"
            >
              <GitHubIcon class="w-6 h-6" />
            </a>
            <a
              class="text-slate-600 dark:text-dark-foreground hover:text-slate-950 dark:hover:text-dark-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-slate-500 dark:focus-visible:outline-dark-muted"
              href="https://x.com/unpkg"
              title="UNPKG on X"
              aria-label="UNPKG on X"
            >
              <XIcon class="w-6 h-6" />
            </a>
          </p>
        </div>
        <p class="text-sm sm:text-right">
          <span class="block font-semibold text-ink dark:text-dark-foreground">Contact us</span>
          <a class="inline-link text-accent dark:text-dark-link hover:underline" href="mailto:support@unpkg.com">
            support@unpkg.com
          </a>
        </p>
      </div>
    </footer>
  );
}

/** Layout shared by the standalone marketing pages (not the homepage). */
export function MarketingPage({
  current,
  heading,
  intro,
  children,
}: {
  current: string;
  heading: string;
  intro: string;
  children: VNode;
}): VNode {
  return (
    <Fragment>
      <SiteHeader current={current} />
      <main class="mx-auto lg:max-w-screen-md text-lg text-slate-900 dark:text-dark-secondary leading-relaxed max-w-full px-8">
        <h1 class="mt-16 text-4xl font-black text-ink dark:text-dark-foreground">{heading}</h1>
        <p class="mt-6 text-xl leading-relaxed">{intro}</p>
        {children}
      </main>
      <div class="mt-24">
        <SiteFooter />
      </div>
    </Fragment>
  );
}

export function PageSection({ id, title, children }: { id: string; title: string; children: VNode }): VNode {
  return (
    <section id={id}>
      <h2 class="mt-16 mb-6 text-2xl font-semibold text-ink dark:text-dark-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function GitHubIcon(props: { class?: string }): VNode {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24" class={props.class}>
      <path
        fill-rule="evenodd"
        d="M12.006 2a9.847 9.847 0 0 0-6.484 2.44 10.32 10.32 0 0 0-3.393 6.17 10.48 10.48 0 0 0 1.317 6.955 10.045 10.045 0 0 0 5.4 4.418c.504.095.683-.223.683-.494 0-.245-.01-1.052-.014-1.908-2.78.62-3.366-1.21-3.366-1.21a2.711 2.711 0 0 0-1.11-1.5c-.907-.637.07-.621.07-.621.317.044.62.163.885.346.266.183.487.426.647.71.135.253.318.476.538.655a2.079 2.079 0 0 0 2.37.196c.045-.52.27-1.006.635-1.37-2.219-.259-4.554-1.138-4.554-5.07a4.022 4.022 0 0 1 1.031-2.75 3.77 3.77 0 0 1 .096-2.713s.839-.275 2.749 1.05a9.26 9.26 0 0 1 5.004 0c1.906-1.325 2.74-1.05 2.74-1.05.37.858.406 1.828.101 2.713a4.017 4.017 0 0 1 1.029 2.75c0 3.939-2.339 4.805-4.564 5.058a2.471 2.471 0 0 1 .679 1.897c0 1.372-.012 2.477-.012 2.814 0 .272.18.592.687.492a10.05 10.05 0 0 0 5.388-4.421 10.473 10.473 0 0 0 1.313-6.948 10.32 10.32 0 0 0-3.39-6.165A9.847 9.847 0 0 0 12.007 2Z"
        clip-rule="evenodd"
      />
    </svg>
  );
}

export function XIcon(props: { class?: string }): VNode {
  return (
    <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24" class={props.class}>
      <path d="M13.795 10.533 20.68 2h-3.073l-5.255 6.517L7.69 2H1l7.806 10.91L1.47 22h3.074l5.705-7.07L15.31 22H22l-8.205-11.467Zm-2.38 2.95L9.97 11.464 4.36 3.627h2.31l4.528 6.317 1.443 2.02 6.018 8.409h-2.31l-4.934-6.89Z" />
    </svg>
  );
}
