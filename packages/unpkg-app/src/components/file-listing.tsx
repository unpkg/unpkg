import { type VNode, Fragment } from "preact";
import prettyBytes from "pretty-bytes";
import type { PackageInfo, PackageFileMetadata } from "unpkg-worker";

import { parseGitHubRepo, createGitHubUrl } from "../github.ts";
import { useHrefs } from "../hooks.ts";

import { FilesHeader } from "./files-header.tsx";
import { FilesLayout } from "./files-layout.tsx";
import { FilesNav } from "./files-nav.tsx";
import { FileCodeIcon, FileLinesIcon, FolderIcon, GitHubIcon, LinkIcon } from "./icons.tsx";

export function FileListing({
  packageInfo,
  version,
  dirname,
  files,
}: {
  packageInfo: PackageInfo;
  version: string;
  dirname: string;
  files: PackageFileMetadata[];
}): VNode {
  let hrefs = useHrefs();

  return (
    <FilesLayout>
      <FilesHeader packageInfo={packageInfo} version={version} filename={dirname} />

      <FilesNav packageInfo={packageInfo} version={version} filename={dirname} />

      {dirname === "/" ? (
        <div class="lg:grid lg:grid-cols-4 lg:gap-8">
          <div class="lg:col-span-3">
            <FileListingContent packageInfo={packageInfo} version={version} dirname={dirname} files={files} />
          </div>

          <div class="hidden lg:block lg:col-span-1">
            <FileListingSidebar packageInfo={packageInfo} version={version} />
          </div>
        </div>
      ) : (
        <FileListingContent packageInfo={packageInfo} version={version} dirname={dirname} files={files} />
      )}
    </FilesLayout>
  );
}

function FileListingContent({
  packageInfo,
  version,
  dirname,
  files,
}: {
  packageInfo: PackageInfo;
  version: string;
  dirname: string;
  files: PackageFileMetadata[];
}): VNode {
  let hrefs = useHrefs();

  let parentHref: string | null = null;
  if (dirname !== "/") {
    let names = dirname.split("/").filter(Boolean);
    names.pop();
    parentHref = hrefs.files(packageInfo.name, version, "/" + names.join("/"));
  }

  let subdirs: Record<string, { href: string; size: number }> = {};
  let dirFiles: Record<string, { href: string; size: number; type: string }> = {};

  for (let entry of files) {
    let filename = entry.path.slice(dirname.length);

    if (filename.includes("/")) {
      let folderName = filename.slice(0, filename.indexOf("/"));

      if (subdirs[folderName] == null) {
        subdirs[folderName] = {
          href: hrefs.files(packageInfo.name, version, dirname + folderName),
          size: 0,
        };
      }

      subdirs[folderName].size += entry.size;
    } else {
      dirFiles[filename] = {
        href: hrefs.files(packageInfo.name, version, dirname + filename),
        size: entry.size,
        type: entry.type,
      };
    }
  }

  let folderNames = Object.keys(subdirs).sort();
  let fileNames = Object.keys(dirFiles).sort();

  let rowData: {
    icon: VNode;
    filename: string;
    href: string;
    size: string;
    contentType: string;
  }[] = [];

  folderNames.forEach((key) => {
    rowData.push({
      icon: <FolderIcon class="w-6 h-6" />,
      filename: `${key}/`,
      href: subdirs[key].href,
      size: prettyBytes(subdirs[key].size),
      contentType: "–",
    });
  });

  fileNames.forEach((key) => {
    let ext = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : "";
    let icon: VNode;
    if (ext === "" || ext === "txt" || ext === "md") {
      icon = <FileLinesIcon class="w-6 h-6" />;
    } else {
      icon = <FileCodeIcon class="w-6 h-6" />;
    }

    rowData.push({
      icon,
      filename: key,
      href: dirFiles[key].href,
      size: prettyBytes(dirFiles[key].size),
      contentType: dirFiles[key].type,
    });
  });

  return (
    <Fragment>
      <header class="py-3 px-4 border border-slate-300 bg-slate-100 text-sm select-none">
        {folderNames.length > 0 ? (
          <span>
            {folderNames.length} {plural("folder", folderNames.length)},{" "}
          </span>
        ) : null}
        <span>
          {fileNames.length} {plural("file", fileNames.length)}
        </span>
      </header>

      <main>
        {files.length === 0 ? (
          <p class="p-4 border-x border-b border-slate-200 w-full bg-white">No files found.</p>
        ) : (
          <table class="border-x border-b border-slate-300 w-full max-w-full bg-white">
            <thead class="hidden">
              <tr>
                <th></th>
                <th>Filename</th>
                <th>Content Type</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {parentHref != null && (
                <tr class="hover:bg-slate-50">
                  <td class="pl-4 border-b border-slate-200 text-sm w-12">
                    <span class="text-slate-600">
                      <FolderIcon class="w-6 h-6" />
                    </span>
                  </td>
                  <td colspan={3} class="pr-2 border-b border-slate-200 text-sm">
                    <a href={parentHref} class="py-3 w-full inline-block text-blue-600 hover:underline">
                      ../
                    </a>
                  </td>
                </tr>
              )}
              {rowData.map((row) => (
                <tr class="hover:bg-slate-50">
                  <td class="pl-4 border-b border-slate-200 text-sm w-12">
                    <span class="text-slate-600">{row.icon}</span>
                  </td>
                  <td class="pr-2 border-b border-slate-200 text-sm max-w-60 sm:max-w-xl">
                    <div class="overflow-hidden whitespace-nowrap text-ellipsis">
                      <a href={row.href} class="py-3 w-full inline-block text-blue-600 hover:underline">
                        {row.filename}
                      </a>
                    </div>
                  </td>
                  <td class="pr-2 border-b border-slate-200 text-sm hidden sm:table-cell">{row.contentType}</td>
                  <td class="pr-4 border-b border-slate-200 text-sm text-right">{row.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </Fragment>
  );
}

function FileListingSidebar({ packageInfo, version }: { packageInfo: PackageInfo; version: string }): VNode {
  let hrefs = useHrefs();

  let latestVersion = packageInfo["dist-tags"]!.latest;
  let latestVersionDate = new Date(packageInfo.time[latestVersion]);
  let packageJson = packageInfo.versions![version];

  let websiteUrl: URL | null = null;
  let websiteText: string | null = null;
  if (packageJson.homepage != null && packageJson.homepage !== "") {
    try {
      websiteUrl = new URL(packageJson.homepage);
      websiteText = websiteUrl.hostname;
      if (websiteUrl.pathname !== "/") {
        websiteText += websiteUrl.pathname;
      }
    } catch (error) {
      // Ignore invalid package.homepage URLs
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
    <div>
      <div class="border-b border-slate-300 pt-2 pb-1 mb-4">
        <h2 class="text-lg font-semibold">About</h2>
      </div>

      {websiteUrl != null && websiteText != null && (!githubUrl || websiteUrl.href !== githubUrl.href) ? (
        <p class="pt-2 text-sm">
          <a
            href={websiteUrl.href}
            title={`Visit the ${packageInfo.name} website`}
            class="inline-flex items-center hover:text-slate-950 hover:underline"
          >
            <LinkIcon class="w-6 h-6" />
            <span class="ml-1">{websiteText}</span>
          </a>
        </p>
      ) : null}

      {githubUrl != null && githubText != null ? (
        <p class="pt-2 text-sm">
          <a
            href={githubUrl.href}
            title={`View the ${packageInfo.name} repository on GitHub`}
            class="inline-flex items-center hover:text-slate-950 hover:underline"
          >
            <GitHubIcon class="w-6 h-6" />
            <span class="ml-1">{githubText}</span>
          </a>
        </p>
      ) : null}

      <div class="border-b border-slate-300 pt-4 pb-1 mb-4">
        <h2 class="text-lg font-semibold">Releases</h2>
      </div>

      <p class="pt-2">
        <a
          href={hrefs.files(packageInfo.name, latestVersion)}
          title={`View the ${packageInfo.name} ${latestVersion} release`}
          class="hover:underline"
        >
          Latest: <span class="font-semibold">{latestVersion}</span>
        </a>
      </p>
      <p class="text-sm">
        <span class="text-slate-500">{formatTimeAgo(latestVersionDate)}</span>
      </p>
    </div>
  );
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

const oneMinuteSeconds = 60;
const oneHourSeconds = 60 * oneMinuteSeconds;
const oneDaySeconds = 24 * oneHourSeconds;
const oneWeekSeconds = 7 * oneDaySeconds;
const oneMonthSeconds = 30 * oneDaySeconds;
const oneYearSeconds = 365 * oneDaySeconds;

function formatTimeAgo(date: Date, before = Date.now()): string {
  let secondsAgo = Math.round((before - date.getTime()) / 1000);
  let formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (secondsAgo < oneMinuteSeconds) {
    return formatter.format(-secondsAgo, "second");
  } else if (secondsAgo < oneHourSeconds) {
    return formatter.format(-Math.round(secondsAgo / oneMinuteSeconds), "minute");
  } else if (secondsAgo < oneDaySeconds) {
    return formatter.format(-Math.round(secondsAgo / oneHourSeconds), "hour");
  } else if (secondsAgo < oneWeekSeconds) {
    return formatter.format(-Math.round(secondsAgo / oneDaySeconds), "day");
  } else if (secondsAgo < oneMonthSeconds) {
    return formatter.format(-Math.round(secondsAgo / oneWeekSeconds), "week");
  } else if (secondsAgo < oneYearSeconds) {
    return formatter.format(-Math.round(secondsAgo / oneMonthSeconds), "month");
  }

  return formatter.format(-Math.round(secondsAgo / oneYearSeconds), "year");
}
