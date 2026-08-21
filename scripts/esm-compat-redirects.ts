export function compareFinalPathAndQuery(leftUrl: string, rightUrl: string): string | null {
  let left = normalizePathAndQuery(leftUrl);
  let right = normalizePathAndQuery(rightUrl);

  return left === right ? null : `final redirect target mismatch: esm.sh=${left}, esm.unpkg.com=${right}`;
}

export function comparePreservedQueryParams(
  requestUrl: string,
  finalUrl: string,
  paramNames: readonly string[]
): string | null {
  let request = new URL(requestUrl);
  let final = new URL(finalUrl);

  for (let name of paramNames) {
    let expected = request.searchParams.getAll(name).sort();
    if (expected.length === 0) {
      return `redirect query expectation references missing request parameter: ${name}`;
    }

    let actual = final.searchParams.getAll(name).sort();
    if (!equalStrings(expected, actual)) {
      return `redirect dropped or changed query parameter ${name}: expected=${formatValues(expected)}, actual=${formatValues(actual)}`;
    }
  }

  return null;
}

export function comparePreservedQueryParamsAcrossRedirects(
  requestUrl: string,
  redirectChain: readonly { location: string | null; url: string }[],
  finalUrl: string,
  paramNames: readonly string[]
): string | null {
  for (let [index, hop] of redirectChain.entries()) {
    if (hop.location == null) {
      return `redirect hop ${index + 1} is missing a Location header`;
    }

    let destinationUrl = new URL(hop.location, hop.url).toString();
    let mismatch = comparePreservedQueryParams(requestUrl, destinationUrl, paramNames);
    if (mismatch != null) {
      return `redirect hop ${index + 1}: ${mismatch}`;
    }
  }

  let finalMismatch = comparePreservedQueryParams(requestUrl, finalUrl, paramNames);
  return finalMismatch == null ? null : `final response: ${finalMismatch}`;
}

function normalizePathAndQuery(value: string): string {
  let url = new URL(value);
  let entries = Array.from(url.searchParams.entries()).sort(([leftName, leftValue], [rightName, rightValue]) => {
    if (leftName === rightName) {
      return leftValue.localeCompare(rightValue);
    }

    return leftName.localeCompare(rightName);
  });
  let searchParams = new URLSearchParams(entries);
  let search = searchParams.size === 0 ? "" : `?${searchParams.toString()}`;
  return `${url.pathname}${search}`;
}

function equalStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function formatValues(values: readonly string[]): string {
  return JSON.stringify(values);
}
