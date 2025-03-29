import { type VNode } from "preact";

export interface VersionSelectorProps {
  availableTags: Record<string, string>;
  availableVersions: string[];
  currentVersion: string;
  pathnameFormat: string;
  class?: string;
}

export function VersionSelector({
  availableTags,
  availableVersions,
  currentVersion,
  pathnameFormat,
  class: className,
}: VersionSelectorProps): VNode {
  function navigateToVersion(event: Event): void {
    let select = event.target as HTMLSelectElement;
    let version = select.value;

    let url = new URL(window.location.href);
    url.pathname = pathnameFormat.replace("%s", version);

    window.location.href = url.href;
  }

  let tagNames = Object.keys(availableTags).sort();

  return (
    <select name="version" value={currentVersion} class={className} onChange={navigateToVersion}>
      <optgroup label="Tags">
        {tagNames.map((tag) => (
          <option value={availableTags[tag]}>
            {tag} ({availableTags[tag]})
          </option>
        ))}
      </optgroup>
      <optgroup label="Versions">
        {availableVersions.map((version) => (
          <option value={version}>{version}</option>
        ))}
      </optgroup>
    </select>
  );
}
