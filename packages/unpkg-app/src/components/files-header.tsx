import { type VNode } from "preact";
import { compare as compareVersions } from "semver";
import { type PackageInfo } from "unpkg-worker";

import { parseGitHubRepo, createGitHubUrl } from "../github.ts";
import { useHrefs } from "../hooks.ts";

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
  let hrefs = useHrefs();

  let availableTags = packageInfo["dist-tags"]!;
  let availableVersions = Object.keys(packageInfo.versions!).sort((a, b) => compareVersions(b, a));
  let pathnameFormat = new URL(hrefs.files(packageInfo.name, "%s", filename)).pathname;

  let packageJson = packageInfo.versions![version];

  let websiteUrl: URL | null = null;
  let websiteText: string | null = null;
  if (packageJson.homepage != null) {
    try {
      websiteUrl = new URL(packageJson.homepage);
      websiteText = websiteUrl.hostname;
      if (websiteUrl.pathname !== "/") {
        websiteText += websiteUrl.pathname;
      }
    } catch (error) {
      // Ignore invalid URLs in package.json "homepage" field
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
        <h1 class="text-black dark:text-dark-foreground text-3xl leading-tight font-semibold">{packageInfo.name}</h1>

        <div class="ml-4 shrink-0 text-right flex items-center gap-3">
          <button
            type="button"
            id="theme-toggle"
            aria-label="Toggle dark mode"
            title="Toggle dark mode"
            class="p-1.5 rounded-md hover:bg-paper-alt dark:hover:bg-dark-panel cursor-pointer"
          >
            <svg class="theme-icon-moon w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
            </svg>
            <svg class="theme-icon-sun w-5 h-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            </svg>
          </button>
          <span>Version: </span>
          <Hydrate container={<span />}>
            <VersionSelector
              availableTags={availableTags}
              availableVersions={availableVersions}
              currentVersion={version}
              pathnameFormat={pathnameFormat}
              class="version-selector p-1 border border-slate-300 dark:border-dark-border bg-slate-100 dark:bg-dark-chrome text-sm"
            />
          </Hydrate>
        </div>
      </div>

      <div class="mt-2">
        <p class="mb-3 leading-tight dark:text-dark-secondary">
          <span>{packageJson.description}</span>
        </p>

        <div class="lg:hidden">
          {websiteUrl != null && websiteText != null ? (
            <p class="mt-1 text-sm leading-4">
              <a
                href={websiteUrl.href}
                title={`Visit the ${packageInfo.name} website`}
                class="inline-flex items-center hover:text-slate-950 dark:hover:text-dark-foreground hover:underline"
              >
                <LinkIcon class="w-6 h-6" />
                <span class="ml-1">{websiteText}</span>
              </a>
            </p>
          ) : null}

          {githubUrl != null && githubText != null ? (
            <p class="mt-1 text-sm leading-4">
              <a
                href={githubUrl.href}
                title={`View the ${packageInfo.name} repository on GitHub`}
                class="inline-flex items-center hover:text-slate-950 dark:hover:text-dark-foreground hover:underline"
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
