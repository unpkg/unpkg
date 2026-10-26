import { type VNode } from "preact";
import { useState } from "preact/hooks";

const link = "inline-link text-accent dark:text-dark-link hover:underline break-all";

/** Homepage try-it: build UNPKG URLs for a package name, live. */
export function UrlBuilder({ esmOrigin, origin }: { esmOrigin: string; origin: string }): VNode {
  let [pkg, setPkg] = useState("preact");
  let name = pkg.trim() || "preact";
  let encoded = name
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  let fileUrl = `${origin}/${encoded}`;
  let metaUrl = `${origin}/${encoded}/?meta`;
  let esmUrl = `${esmOrigin}/${encoded}`;

  return (
    <div class="border border-hairline-strong dark:border-dark-border-strong bg-white dark:bg-dark-panel p-4 text-slate-900 dark:text-dark-secondary">
      <label class="block text-base font-semibold text-ink dark:text-dark-foreground" htmlFor="url-builder-package">
        Try it: build a URL
      </label>
      <input
        id="url-builder-package"
        type="text"
        value={pkg}
        onInput={(event) => setPkg((event.target as HTMLInputElement).value)}
        placeholder="package name, e.g. react"
        class="mt-2 w-full px-3 py-2 text-base bg-paper dark:bg-dark-page border border-hairline-strong dark:border-dark-border-strong text-ink dark:text-dark-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-deep"
      />
      <ul class="mt-3 text-base space-y-1.5">
        <li>
          File:{" "}
          <a class={link} href={`/${encoded}`}>
            {fileUrl}
          </a>
        </li>
        <li>
          Metadata:{" "}
          <a class={link} href={`/${encoded}/?meta`}>
            {metaUrl}
          </a>
        </li>
        <li>
          ES module:{" "}
          <a class={link} href={esmUrl}>
            {esmUrl}
          </a>
        </li>
      </ul>
    </div>
  );
}
