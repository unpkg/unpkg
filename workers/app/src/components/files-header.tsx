import { type VNode } from "preact";
import { compare as compareVersions } from "semver";
import { type PackageInfo } from "unpkg-core";

import { parseGitHubRepo, createGitHubUrl } from "../github.ts";
import { HrefsContext } from "../hrefs.ts";

import { getContext } from "./app-context.ts";
import { Hydrate } from "./hydrate.tsx";
import { VersionSelector } from "./version-selector.tsx";
import { GitHubIcon, LinkIcon } from "./icons.tsx";

export function FilesHeader({
  packageInfo,
  version,
  filename,
}: {
  packageInfo: PackageInfo;
  version: string;
  filename: string;
}): VNode {
  let hrefs = getContext(HrefsContext);

  let availableTags = packageInfo["dist-tags"]!;
  let availableVersions = Object.keys(packageInfo.versions!).sort((a, b) => compareVersions(b, a));

  let packageJson = packageInfo.versions![version];

  let websiteUrl: URL | null = null;
  let websiteText: string | null = null;
  if (packageJson.homepage != null) {
    websiteUrl = new URL(packageJson.homepage);
    websiteText = websiteUrl.hostname;
    if (websiteUrl.pathname !== "/") {
      websiteText += websiteUrl.pathname;
    }
  }

  let githubUrl: URL | null = null;
  let githubText: string | null = null;
  let repository = packageJson.repository;
  if (repository != null && repository.type === "git") {
    let githubRepo = parseGitHubRepo(repository.url);
    if (githubRepo != null) {
      githubUrl = createGitHubUrl(githubRepo);
      githubText = `${githubRepo.owner}/${githubRepo.repo}`;
    }
  }

  return (
    <header class="pt-6 pb-4 lg:pt-16">
      <div class="mb-6 flex justify-between items-center">
        <h1 class="text-black text-3xl leading-tight font-semibold">{packageInfo.name}</h1>

        <div class="text-right w-48">
          <span>Version: </span>
          <Hydrate container={<span />}>
            <VersionSelector
              availableTags={availableTags}
              availableVersions={availableVersions}
              currentVersion={version}
              pathnameFormat={hrefs.files(packageInfo.name, "%s", filename)}
              class="w-28 p-1 border border-slate-300 bg-slate-100 text-sm"
            />
          </Hydrate>
        </div>
      </div>

      <div class="mt-2">
        <p class="mb-3 leading-tight">
          <span>{packageJson.description}</span>
        </p>

        <div class="lg:hidden">
          {websiteUrl != null && websiteText != null ? (
            <p class="mt-1 text-sm leading-4">
              <a
                href={websiteUrl.toString()}
                title={`Visit the ${packageInfo.name} website`}
                class="inline-flex items-center hover:text-slate-950 hover:underline"
              >
                <LinkIcon class="w-6 h-6" />
                <span class="ml-1">{websiteText}</span>
              </a>
            </p>
          ) : null}

          {githubUrl != null && githubText != null ? (
            <p class="mt-1 text-sm leading-4">
              <a
                href={githubUrl.toString()}
                title={`View the ${packageInfo.name} repository on GitHub`}
                class="inline-flex items-center hover:text-slate-950 hover:underline"
              >
                <GitHubIcon class="w-6 h-6" />
                <span class="ml-1">{githubText}</span>
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </header>
  );
}
