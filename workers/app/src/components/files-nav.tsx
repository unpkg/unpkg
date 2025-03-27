import { type VNode } from "preact";
import { useContext } from "preact/hooks";
import { type PackageInfo } from "unpkg-worker";

import { HrefsContext } from "../hrefs.ts";

export function FilesNav({
  packageInfo,
  version,
  filename,
}: {
  packageInfo: PackageInfo;
  version: string;
  filename: string;
}): VNode {
  let hrefs = useContext(HrefsContext);

  let breadcrumbs = [
    filename === "/" ? (
      <span>{packageInfo.name}</span>
    ) : (
      <span>
        <a href={hrefs.files(packageInfo.name, version, "/")} class="text-blue-600 hover:underline">
          {packageInfo.name}
        </a>
      </span>
    ),
  ].concat(
    filename
      .split("/")
      .filter(Boolean)
      .reduce((acc, part, index, parts) => {
        acc.push(<span> / </span>);

        if (index === parts.length - 1) {
          acc.push(<span>{part}</span>);
        } else {
          let href = hrefs.files(packageInfo.name, version, "/" + parts.slice(0, index + 1).join("/"));
          acc.push(
            <span>
              <a href={href} class="text-blue-600 hover:underline">
                {part}
              </a>
            </span>,
          );
        }

        return acc;
      }, [] as VNode[]),
  );

  return <nav class="py-2">{breadcrumbs}</nav>;
}
