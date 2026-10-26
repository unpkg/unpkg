# Supply Chain Security

A compromised npm release can reach production pages in minutes. UNPKG Shield watches every release as it publishes and can substitute a known-good version at the edge before a browser ever executes the bad one.

Source page: https://unpkg.com/guides/supply-chain-security

## UNPKG Shield

[UNPKG Shield](https://shield.unpkg.com/) watches every npm release the moment it publishes and judges each change with a diff-aware classifier informed by OSV, the GitHub Advisory Database, and the OpenSSF malicious-packages feed.

- **Armed domains** get a compromised version pinned or swapped to the last known-good release at the edge (or blocked) before a browser executes it.
- **Monitoring domains** stay unarmed and simply observe, so you can watch first and enforce when ready.
- **Package owners** can see which domains serve their packages and which versions are live, so a hijacked release stops being invisible.

## Why not just use SRI?

Subresource Integrity is a good tool, and the two approaches solve different problems. An SRI hash proves the bytes you received are the bytes you pinned, and nothing more. It can't tell you whether a new release is safe, and every update, including critical bug fixes, waits on someone updating hashes across every page and dependency.

Shield takes the other direction: instead of each site verifying bytes by hand, every release is judged once, centrally, as it publishes, and a bad one is stopped at the edge for everyone armed against it. No hash maintenance, and no deploy on your side when something goes wrong.

It's a genuine choice. If you pin and verify hashes yourself, keep doing that. It's the right model when you want to trust no intermediary. If you'd rather not maintain hashes across every dependency and update, Shield is the barrier that stays current for you.

Enforcement happens on the normal request path described on the [network page](https://unpkg.com/network.md): the check runs before any cache is consulted, and a pinned response is served under the clean version's cache key. Join the beta at https://shield.unpkg.com/register.
