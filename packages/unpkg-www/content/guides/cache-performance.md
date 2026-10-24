# Cache Performance

UNPKG is fast because most requests are answered from cache at the edge. This guide explains what gets cached, for how long, and how to write URLs that hit it.

Source page: https://unpkg.com/guides/cache-performance

## Permanent URLs are the fast path

npm never lets a published version be overwritten, so an exact-version file URL is permanent. UNPKG caches those responses at the edge for a year. URLs without a fully resolved version — e.g. `https://unpkg.com/preact@10` — must resolve first and redirect, so they are never the direct cache hit. **For the best chance of a cache hit, use the full package version and file path in production URLs**, like `https://unpkg.com/preact@10.5.0/dist/preact.min.js`.

That speed is a trade-off, not a free win: a fully pinned URL never changes, so bug fixes and patches only arrive when you update it. Looser specifiers flow updates to you automatically, at the cost of a redirect on the way in. A middle path is a patch-level specifier (such as `preact@10.26`), which takes bug fixes within a release line while major and minor changes stay deliberate. Which side you choose is a judgment call — and the security side of it is exactly the risk [UNPKG Shield](https://unpkg.com/guides/supply-chain-security.md) exists to carry, by watching new releases and stopping the bad ones at the edge whichever way you pin.

## Verified, self-healing entries

Before a file enters any cache layer it is length- and digest-verified against the origin's response. An entry that fails verification later is evicted and refetched rather than served. If a version has to be withdrawn, operators can evict that exact `package@version` from every layer without disturbing any other version. The [network page](https://unpkg.com/network.md) explains the machinery.
