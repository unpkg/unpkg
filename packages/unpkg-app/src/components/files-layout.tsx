import { type VNode, Fragment } from "preact";

import * as hrefs from "../hrefs.ts";
import { GitHubIcon } from "./icons.tsx";

export function FilesLayout({ children }: { children: VNode | VNode[] }): VNode {
  return (
    <Fragment>
      <header class="border-b border-slate-300 bg-slate-100 text-slate-950">
        <div class="p-4 mx-auto flex justify-between items-center lg:max-w-screen-xl">
          <h1 class="text-2xl font-bold inline-block">
            <a href={hrefs.home()}>UNPKG</a>
          </h1>
          <span class="inline-block h-full">
            <a href="https://github.com/unpkg">
              <GitHubIcon class="w-6 h-6" />
            </a>
          </span>
        </div>
      </header>

      <main class="px-4 pb-24 mx-auto lg:max-w-screen-xl lg:pb-44">{children}</main>
    </Fragment>
  );
}
