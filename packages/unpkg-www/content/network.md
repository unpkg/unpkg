# Network & Architecture

How UNPKG serves npm files: Cloudflare's global edge, digest-verified origin fetches, self-healing caches, and Shield supply-chain defense.

Source page: https://unpkg.com/network

## The path of a request

1. **Browser cache.** A permanent, exact-version URL may already be on the visitor's device; then nothing below runs.
2. **Cloudflare edge cache.** Most requests are answered from the cache at the Cloudflare data center nearest the visitor.
3. **The UNPKG Worker.** When a request reaches the Worker, it enforces UNPKG Shield rules before any cache is consulted, resolves the version, and decides exactly which file should be served.
4. **Origin fetch.** On a genuine miss, the file is fetched from a multi-region origin (11 regions across the Americas, Europe, Asia, and Australia), length- and digest-verified, then cached.

If a needed version is compromised, Shield enforcement happens at step 3 — before cache lookup — so a pinned or swapped response is served under the clean version's cache key and a blocked version never executes.

## Caching that can be trusted

- Every file is digest-checked before it enters any cache layer; corrupt entries are evicted and refetched rather than served (self-healing).
- Exact-version file URLs are cached at the edge for a year. Range and tag URLs redirect to the resolved permanent URL first.
- Operators can evict one exact `package@version` from every cache layer without disturbing other versions (cache generations).

## Behavior summary

| Request | What happens |
|---|---|
| Exact version + file | Served from the nearest cache; permanent URL |
| Range or dist-tag | Redirects to the resolved exact-version URL |
| Missing file | Resolves entry points from `package.json` (`exports`, then `main`, honoring the `unpkg` field) |
| Compromised version on an armed domain | Pinned/swapped to the last known-good release, or blocked, at the edge |
| Withdrawn version | Evictable per exact `package@version` without touching other versions |

## The trade-off, plainly

UNPKG is a single global edge network in front of a multi-region origin, not a multi-CDN federation. Exact pinning maximizes cache hits and reproducibility; looser specifiers trade a redirect for automatic updates. See the cache performance guide: https://unpkg.com/guides/cache-performance.md

## Related

- Status: https://unpkg.com/status.md
- Supply chain security: https://unpkg.com/guides/supply-chain-security.md
