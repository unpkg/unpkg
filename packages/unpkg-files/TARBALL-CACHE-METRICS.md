# Tarball cache: before/after metrics

Evidence for the origin tarball cache (`src/lib/tarball-cache.ts`, wired into
`src/lib/npm-files.ts`). All numbers below were measured; each section names
its source and window. Nothing here is projected except where marked
"estimate".

## Provenance

- Baseline fleet sample: `fly logs -a unpkg`, 2026-10-27 05:37–05:40 UTC,
  19,465 requests over 126 s, 23 machines on
  `unpkg:deployment-01M0ZY4KJER62WMRBYJA9784ZQ` (`performance-2x`, 4096 MB).
- Canary window: 2026-10-27 06:15 UTC → 14:41 UTC. Two clone machines on
  `unpkg:deployment-01M5XZSXQZEDGBCC1NQNRRT9SJ`, each with a 30 GB Fly
  Volume at `/data`: `87e124a02460d8` (sjc), `837e23a77e4918` (ewr).
  Original 23 machines were never modified.
- Warm latency sample: `fly logs -a unpkg`, 2026-10-27 14:28–14:38 UTC,
  63,567 log lines, canaries ~8 h warm.
- Offline bench: pre-change HEAD vs cached build, stub registry (30 ms
  artificial latency, download-counting), synthetic tarball 8.19 MB /
  3,000 files, 720 distinct-file requests at concurrency 24.

## OOMs and machine lifetimes

Machine event history (`fly machine list --json`, 2026-10-27 14:21 UTC):

| Group | Completed lifetimes before OOM `exit_code=137, oom_killed=true` |
| --- | --- |
| Old fleet (n=23) | median 0.68 h, mean 4.67 h (mean skewed by two low-traffic syd machines at ~40 h; busy-region medians ≈ 0.5 h; min 0.01 h) |
| Canary sjc | first lifetime 7.20 h, then OOM at 13:27 UTC |
| Canary ewr | completed lifetimes ≈ 3.4 h (×2 observed), latest OOM 13:04 UTC |

21 of 23 old machines recorded at least one OOM exit in the 8.1 h canary
window. Interpretation: the cache extends time-to-OOM roughly 5–10× in busy
regions but does **not** eliminate OOMs. Parse concurrency (hard limit 100)
is the remaining driver; a semaphore is the follow-up, not part of this PR.

## Downloads and bytes (the mechanism)

Baseline: every `/file` or `/list` request re-downloads the full tarball.
In the 126 s baseline sample, 19,418 requests covered only 6,444 distinct
package@versions — 66.8% were repeat tarball downloads. Worst case:
`@dnb/eufemia@11.5.1` (20 MB .tgz, 119 MB unpacked, 26,391 files) was
downloaded 2,820 times in 126 s, median request duration 15.4 s.

Offline bench (same workload, before vs after):

| Metric | Before (HEAD) | After (cache) |
| --- | --- | --- |
| Tarball downloads for 720 file requests | 720 | 1 |
| Bytes served by registry | 5.90 GB | 8.19 MB |
| Peak process RSS | 592 MB | 242 MB |
| Warm p50 latency | 48–78 ms | 13 ms |
| Warm round wall time | 697–938 ms | 129–131 ms |
| Downloads after process restart (warm volume) | n/a | 0 |

Canary production counters (per current process incarnation; counters
reset on restart):

| Machine | Hits | Downloads | Hit/download | Downloaded | Entries | Retained |
| --- | --- | --- | --- | --- | --- | --- |
| sjc (since 13:27 UTC) | 17,619 | 6,334 | 2.78 | 15.59 GB | 11,942 | 25.0 GB (at cap) |
| ewr (since 13:04 UTC) | 26,105 | 20,872 | 1.25 | 46.85 GB | 6,998 | 24.95 GB (at cap) |

Estimate: valuing each hit at that machine's average downloaded tarball
size (sjc 2.46 MB, ewr 2.24 MB), hits avoided ≈ 43 GB (sjc) and ≈ 59 GB
(ewr) of registry downloads in those incarnations.

## Memory

Same-age comparison (~10 min after (re)start, `cat /proc/meminfo`):

| Machine | AnonPages |
| --- | --- |
| Old code, sjc | 2.77 GB |
| Old code, ewr | 2.98 GB (OOM minutes later) |
| Canary sjc | 324 MB |
| Canary ewr | 485 MB |

Download-to-disk + parse-from-disk removes the in-memory fetch/gunzip
buffering, so RSS drops even while the cache is cold. Under sustained
hot-region load the canaries still climb over hours (ewr reached
2.35 GB AnonPages before its 13:04 OOM) — see the semaphore follow-up.

## Latency (production, concurrent same-region pairs)

Warm sample 2026-10-27 14:28–14:38 UTC, durations from origin logs:

| Pair | Median | Mean | p90 | p99 | >1 s |
| --- | --- | --- | --- | --- | --- |
| sjc canary (n=3,251) | 62 ms | 166 ms | 381 ms | 1,830 ms | 2.4% |
| sjc old (n=6,190) | 114 ms | 210 ms | 478 ms | 1,400 ms | 2.5% |
| ewr canary (n=7,196) | 297 ms | 2,840 ms | 6,640 ms | 32,960 ms | 29.9% |
| ewr old (n=9,891) | 332 ms | 1,886 ms | 4,590 ms | 22,690 ms | 29.9% |

sjc (warm, moderate load): median −46%, mean −21%, p90 −20%.
ewr (saturated hotspot): median slightly better, mean and p90 worse, and
10 hard-limit (100 concurrent) warnings vs 6 for old ewr in the window.
Latency is therefore **mixed**: a clear win where a machine is not
saturated, no win yet in the saturated region, where unbounded parse
concurrency dominates. Baseline fleet-wide pre-cache sample for context:
median 267 ms, mean 3,173 ms, p90 13.0 s, p99 32.9 s (05:37 UTC sample).

Errors: in the first canary watch, 11,955/11,955 canary requests returned
200 with zero hard-limit warnings. No correctness regressions observed;
files are served from the identical parse path, and cached tarballs that
fail to parse are evicted and re-downloaded once.

## Sizing (how 30 GB was chosen)

LRU simulation over the 19,418-request baseline sequence with exact
compressed sizes for the 800 hottest tarballs (median 0.68 MB, mean
4.02 MB, max 124.7 MB; median-imputed beyond):

| Cap | 1 GB | 2 GB | 5 GB | 10 GB | 20 GB | 30 GB | 50 GB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Request hit rate | 51.1% | 57.9% | 65.7% | 66.8% | 66.8% | 66.8% | 66.8% |

66.8% is the ceiling for that window (distinct/request ratio). Production
hit/download ratios above 1.0 confirm the shape. Volumes observed at
24 GB / 30 GB used after ~8 h with the 25 GB cap actively evicting.

## Cost

Fly Volumes are $0.15/GB/month provisioned (docs.fly.io/about/pricing,
checked 2026-10-27): 30 GB = $4.50 per machine/month; 23–25 machines
≈ $104–$113/month. Disable scheduled snapshots on cache volumes
(data is disposable).

## Tests

- `unpkg-files`: 98 pass, 0 fail, including 4 new `TarballCache` unit
  tests (hit, single-flight, admission, LRU eviction) and 1 integration
  test (3 distinct lodash files cost exactly 2 downloads).
- Workspace gate (`pnpm run build` + `pnpm -r test`): 446 pass, 0 fail.

## Known limitations / follow-ups

1. OOMs persist under parse concurrency (see lifetimes). Next: bounded
   parse semaphore (~12–16) with a bounded queue; ewr data sizes it.
2. Staging downloads are not counted against the cache byte cap;
   consider lowering the cap to 20 GB (staging headroom 5 GB → 10 GB)
   and clamping the cap to free disk space at startup.
3. The HTTP handler hardcodes the npm registry, so the offline bench
   drives `getFile` directly rather than end-to-end HTTP.
4. No refetch-after-eviction counter yet; that number decides whether
   volumes larger than 30 GB would pay for themselves.

## Addendum: concurrency semaphore (follow-up canary)

Implemented after the overnight result (`src/lib/concurrency.ts`):
FIFO limiter around all tarball download+parse work, default 16 slots,
20 s bounded queue, then `OverloadedError` → HTTP 429 + `Retry-After`
(the edge workers retry 5xx but not 429, so shedding cannot amplify).
Deployed 2026-10-27 15:18 UTC to the same two canaries as
`deployment-01M5YZ089SA5M7J4092PM1APX8`, cache cap lowered to 20 GB.

Offline (bench, concurrency 100, cache warm): peak RSS 556 MB with the
limiter effectively off vs 215 MB at 16 slots; latency unchanged or
slightly better.

Production watch 15:18–15:38 UTC:

| Machine | Median | p99 | >1 s | AnonPages | Limiter |
| --- | --- | --- | --- | --- | --- |
| sjc canary (16 slots) | 51 ms (old pair: 125 ms) | 863 ms | 0.7% | 194 MB | mostly idle |
| ewr canary (16 slots) | 3,860 ms | 13.9 s | 99.8% | 631 MB | saturated, waiting=84, shed=0 |
| ewr canary (raised to 32) | 3,180 ms | 16.8 s | 79.8% | 477 MB | queue drains between bursts |

ewr context: old ewr machine `32876e01` was health-critical (check
timeout) during the watch, so the canary was effectively carrying the
region alone at ~17 req/s of crawl traffic. Memory stayed flat and no
429s were shed; the cost shows up as queue wait on the saturated
machine instead of memory growth. Fleet rollout (2+ limited machines
per region) is the real test; suggested starting limit 32/machine.
Tests: 103 pass in `unpkg-files` (3 new limiter tests, 1 new 429 test).

## Addendum: extracted-tree tier (Tier 2)

`src/lib/extracted-cache.ts`: tarballs crossing 5 requests are extracted
once (single-flight) to a shared tree on the volume; `/file` then reads
directly and `/list` answers from the listing captured during that one
extraction. Packages over 5,000 files stay in the compressed tier
(inode guard). Caps: 8 GB extracted, LRU-evicted, persisted index.

Offline bench (monster tarball, concurrency 32, warm):

| Metric | Compressed tier only | + Extracted tier |
| --- | --- | --- |
| Warm round wall (240 files) | 125–129 ms | 2 ms |
| Warm p50 | 15–17 ms | <1 ms |
| Peak RSS | 226 MB | 73 MB |

Canary production watch 2026-10-27 15:53–16:02 UTC (image
`deployment-01M5Z0Z9F8TJQS5Y2YTV57VG4E`, same two machines, cache +
semaphore at 32 slots also active):

| Machine | Median | p90 | >1 s | vs same-window old pair |
| --- | --- | --- | --- | --- |
| sjc canary | 41 ms | 316 ms | 1.4% | old sjc median 121 ms |
| ewr canary | 57 ms | 788 ms | 7.6% | old ewr median 139 ms, >1 s 10.4% |

ewr comparison point: with semaphore alone (previous watch) the ewr
canary median was 3,180 ms with a saturated queue. With Tier 2 its
limiter reads active=0–3, waiting=0 — the queue drained because hits
no longer pay gunzip + tar scan. Extracted tier after ~9 minutes:
ewr 77 extractions, 1,417 hits, 1.52 GB retained, 44 packages rejected
by the file-count ceiling (served from the compressed tier as designed).
Memory: AnonPages 253 MB (sjc) / 450 MB (ewr). Disk: 21 GB / 30 GB
(20 GB compressed cap + extracted tier). Tests: 106 pass in
`unpkg-files` (2 new ExtractedCache unit tests, 1 integration test).

## Addendum: disk-churn instrumentation and first tuning (2026-10-27 16:34 UTC)

Motivation: both canary volumes reached 94% / 99% full under the
20 GB + 8 GB caps, with Fly disk-throttling events rising. Stats lines
now also report `promotedBytes`, `evictions`, and `evictedBytes` for
both tiers, so write churn is measurable per interval.

First tuning applied to both canaries (env only, image
`deployment-01M5Z3B6H9HH0KQ030H3NDK1DP`): compressed cap 20 GB → 14 GB,
extracted cap 8 GB → 6 GB (20 GB total on the 30 GB volume), extracted
promotion threshold 5 → 15 requests.

Immediate effect (5 min): volume use 99% → 75% (ewr) and 94% → 74%
(sjc) as eviction enforced the new caps; zero shed, zero errors.
Baseline churn reading (ewr, first ~5 min, includes the one-time cap
shrink): 1,352 downloads / 3.42 GB downloaded, 2,184 evictions /
6.21 GB evicted (compressed tier). Steady-state lever decisions need
a 30–60 min delta after the shrink transient: compare
`evictedBytes/min` against `promotedBytes/min` (churn vs useful
retention) and `downloadBytes/min` (staging write floor; motivates
parsing sub-1 MB tarballs from memory instead of disk staging).

## Addendum: disk-throttling tuning loop (2026-10-27 16:34–17:28 UTC)

Changes: (a) stats lines gained promoted/evicted byte counters;
(b) caps retuned to 14 GB compressed + 6 GB extracted, extracted
promotion 5 → 15; (c) first-seen tarballs stream-parse from the
network with no staging write (`UNPKG_STREAM_FIRST_SIGHTINGS`, tried
at 1, then 2); (d) extracted entries get a 30-minute minimum
residence before eviction.

Measured write rates (ewr canary, per-minute deltas):

| Configuration | Downloads/min | Written MB/min | Hits/min |
| --- | --- | --- | --- |
| Caps 20+8 GB, all disk staging (16:39 baseline) | ~270 | ~680 (3.42 GB / 5 min) | — |
| Caps 14+6 GB, stream first 1 sighting | 45 | 166 | 188 |
| Caps 14+6 GB, stream first 2 sightings | 6.7 | 30 | 188 |

Same hit throughput, ~5.5x less disk write from the second-sighting
change alone (downloads per hit 0.24 → 0.035). Volume use stabilized
at 73–75% (was 94–99%). Extracted evictions fell to zero in the
hysteresis windows except for trees older than the residence floor.
Latency in sampled windows: medians 20 ms (sjc) / 49 ms (ewr),
>1 s under 1%, zero shed, zero errors. Recommendation: ship
`UNPKG_STREAM_FIRST_SIGHTINGS=2` in the rollout env (code default
remains 1). Tests: 108 pass in `unpkg-files`; workspace gate green.

## Addendum: ewr region test (2026-10-27 18:51 UTC)

Cloned both old ewr machines onto fresh 30 GB volumes, updated the
clones to the combined stack, cordoned the old pair (reversible).
Region then ran on 3 new-stack machines during the evening peak
(~36 req/s regional). ewr canary `837e23a7` reached 3.51 GB AnonPages
at 1.5 h and was proactively restarted under cover of the uncordoned
old pair at 18:57 UTC (no OOM exit recorded; came back warm).

Post-restart 4.5 min window: combined ewr median 613 ms, >1 s 41%,
9,733/9,733 requests 200. Still CPU-bound at peak, but no deaths and
no shed-driven errors; compare old-code ewr at peak (median 866 ms,
>1 s 46.5%, machines mid-OOM-cycle). New-clone disk throttling was
confirmed warm-up churn: `e82676db` wrote 2.72 GB of downloads in
~11 min filling an empty volume (14% full, 0 evictions, hits already
6x downloads), expected to decay to the ~30 MB/min steady state
measured earlier once the cache is full.

## Addendum: heap-growth investigation (2026-10-27)

Two unbounded `seen` maps (one per cache tier) retained ~115 bytes
per distinct package@version forever. Proven locally: 200k distinct
keys grew heapUsed 1 MB -> 24 MB, surviving forced GC; under crawl
enumeration (millions of distinct keys/day fleet-wide) that is a
slow, real leak. Fixed: both maps capped (100k keys FIFO, plus the
extracted tier's rejected set), with `seen=` added to stats lines.
Local parse churn by contrast is clean: heapUsed flat over 12 rounds
of mixed getFile/listFiles, RSS plateaued, forced GC released it.

Production telemetry (`[memory]` line every 60s, added to server.ts)
on ewr at peak, first 14 minutes after the fix deployed
(`deployment-01M5ZCQF2…`): RSS 607 MB -> 988 MB while heapUsed
oscillated 193–298 MB with GC sawtooth and external/arrayBuffers
swung with in-flight concurrency. Classification: the remaining
growth is allocator/native high-water retention, not retained JS
objects. It is GC-responsive locally. Options if overnight data
shows it still reaching the ceiling: periodic forced GC, `--smol`,
or the RSS watchdog from the backlog. Tests: 109 pass in
`unpkg-files` (new seen-cap test).

## Addendum: periodic GC experiment (2026-10-27 21:04 UTC, negative)

Env-gated forced GC every 60s (`UNPKG_PERIODIC_GC_MS`, `[memory]`
lines now include `gc=` count) enabled on the three ewr machines
only; sjc remained the no-GC control on the previous image. Result
after ~45 min at peak: GC machines' AnonPages reached 2.33–2.92 GB
(age 0.70 h), on the same trajectory that OOM'd them at 1.1–1.6 h
pre-GC (all three died 20:25–20:51 UTC on the seen-map-fix image).
`heapUsed` stayed 149–298 MB on both GC and control while RSS
climbed to 1.66–1.93 GB. Verdict: periodic JS GC does not mitigate
the growth; the retained memory is native-side (consistent with
mimalloc buffer pools from Buffer.concat/readFile churn at 32-way
concurrency), which JS GC cannot release. GC should not ship
enabled. Remaining levers: stream large responses instead of
buffering bodies (attacks the churn), `--smol`, lower hot-region
limiter ceiling, or the RSS watchdog graceful restart.

## Addendum: streaming, --smol, watchdog, disk tuning (2026-10-27/28)

GC code removed (experiment stayed negative). Then, in order:

1. Streamed bodies: extracted-tier `getFile` serves a lazy
   `Bun.file` blob (`PackageFile.bodyStream`) instead of reading
   whole files into Buffers; handler prefers it. Test asserts exact
   bytes via the streamed body.
2. Disk-write cuts: removed per-hit `utimes` (a metadata write per
   cache hit), debounced index persists to 5 s with orphan cleanup
   on load. Extracted-tier churn was the throttle driver (314
   extractions / 276 evictions in 13 min at promotion=8): admission
   tightened to 25 requests / 1,500 files max. Measured volume write
   rate on ewr fell from ~37 MB/s to ~5 MB/s; sjc ~1.3 MB/s.
3. `--smol` (machine command override) on all new-stack machines:
   heapTotal ~41 MB vs ~90-160 MB; anon slope roughly halved at
   equal load, not eliminated.
4. RSS watchdog: at 3 GB RSS the origin stops accepting, drains
   10 s, exits 1 (Fly on-failure restart, warm cache). Local proof
   caught a real bug - the exit timer was unref'd and the process
   exited 0, which Fly would not restart; fixed and re-proven
   (EXIT_CODE=1). Armed on all four new-stack machines
   (`UNPKG_RSS_WATCHDOG_BYTES=3221225472`) with the final image
   `deployment-01M5ZZ2H351ANQ5T348H6MBVC6`.

Context: fleet traffic grew sharply on 2026-10-27 (chart: ~10k to
~60k responses/5 min vs two days prior; sampled 106-155 req/s at
origin, rotating icon/design-package crawl). Slopes and lifetimes
must be read against that escalation. Workspace gate: all packages
pass (files 109). Remaining honest unknown: whether smol+streaming
plateaus anon growth overnight; the watchdog bounds the blast
radius either way (clean restart, no truncated bodies).

## Addendum: PR #522 merged and fleet-wide rollout (2026-10-28)

PR #522 (`perf(files): tarball + extracted caching, parse semaphore,
and origin memory/disk hardening`) merged to `unpkg/unpkg:main`
(merge commit `3a6e811`). Rollout image:
`registry.fly.io/unpkg:deployment-01M61REG41QF40F8ES7GNQTYCP`,
built from merged main.

Rollout method (fleet-wide `fly deploy` was never run, because the
`mounts` block in `fly.json` fails until volumes exist): per region,
per machine — create a 30 GB `unpkg_cache` volume in that region
first, clone the old machine with `--attach-volume <vol>:/data`,
update the clone to the merged image with
`bun --smol run ./dist/server.js` and the combined cache/limiter/
watchdog env, verify `started` + health check `passing`, then
cordon the old machine. The 4 pre-existing canaries (sjc
`87e124a02460d8`, ewr trio) were updated in place to the merged
image, one at a time, with passing checks between updates.

Final fleet state (verified 2026-10-28 ~17:40 UTC,
`fly machine list -a unpkg --json`):

- 47 machines total: 24 serving (non-cordoned), 23 old machines
  cordoned as rollback (none destroyed yet).
- Serving per region: ams 2, cdg 2, dfw 2, ewr 3, gru 2, lax 2,
  lhr 1, nrt 2, sin 4, sjc 2, syd 2.
- Every serving machine: merged image, `/data` volume mount,
  `bun --smol` command, `started`, check `passing`. No exceptions.
- Smoke: `GET https://unpkg.fly.dev/file/react@18.3.1/package.json`
  → 200 in 0.12 s with correct body. (The origin requires the
  `/file/` prefix; a bare `/react@...` path 404s by design.)

Post-rollout latency (two `fly logs` samples, 2026-10-28
~17:45–17:50 UTC, 8,668 GETs parsed from origin duration logs;
all 8,668 returned 200, zero 429, zero limiter shed):

| Scope | n | p50 | p95 | p99 | ≥1 s | ≥5 s |
| --- | --- | --- | --- | --- | --- | --- |
| Fleet | 8,668 | 142 ms | 2,456 ms | 13,986 ms | 9.4% | 3.47% |
| Excl. ewr | 5,115 | 113 ms | 582 ms | 1,140 ms | 1.5% | 0.08% |
| ewr only | 3,553 | 190 ms | 10,488 ms | 17,274 ms | 20.6% | 8.36% |

Baseline for comparison (pre-change fleet sample, 2026-10-27
05:37 UTC, see Provenance): median 267 ms, mean 3,173 ms,
p90 13.0 s, p99 32.9 s. Fleet p50 improved ~47% and p99 ~57%
despite the ~6x traffic escalation noted above; excluding the
ewr hot spot, p99 improved ~97% (32.9 s → 1.14 s). Windows and
traffic mix differ, so these are directional, not lab-identical.

Reliability post-rollout: zero `exit` events on any serving
machine at verification time (all exit events in machine history
belong to the cordoned old machines, `exit_code=137,
oom_killed=true`). Restarts on the new stack are the RSS
watchdog's deliberate `exit 1` at 3 GB RSS with a warm volume —
a clean drain-and-restart, not a kernel OOM.

ewr remains the hot spot (~38–43% of origin requests across both
samples, stable before and after rollout). Fly's proxy routes by
proximity to the requester and knows nothing about cache warmth,
so this is demand geography (plus likely transatlantic spillover
at European peaks), not the warm cache attracting traffic. Its
slow tail is concentrated in huge-tarball enumerations — in the
17:45 UTC sample, 190 of 293 ewr requests ≥5 s were `openclaw`,
followed by `@pulumi/azure-native` and `gdal-async` (21 each).
The tarball cache is effective there (e.g. `e82676db334418`:
2,127 hits vs 162 downloads) but the extracted tier gets few
hits for this pattern (~180/machine), so distinct files still
pay large-tarball parse cost split across 3 machines.

Current CPU snapshot (2026-10-28 ~17:55 UTC, `/proc/loadavg`
via `fly ssh console`, machines are 2 vCPU): ewr 1.44–2.06
(run-queue saturated), sin 0.84, sjc 0.44. No %CPU pre-change
baseline was ever captured — instrumentation was log-based —
so no CPU improvement percentage should be quoted; use Grafana
panels for any CPU slide.

Cost: 30 GB volumes at $0.15/GB/month = $4.50/machine/month,
~$108/month for the 24 serving machines (scheduled snapshots
disabled; cache data is disposable).

Cleanup / follow-ups:

- The ewr trio still carries the leftover `UNPKG_PERIODIC_GC_MS`
  env var from the negative GC experiment. The merged code does
  not read it; it is inert and should be stripped.
- Do not destroy the 23 cordoned old machines until the new
  fleet has soaked; they are the instant rollback (uncordon to
  rejoin).
- Watch: per-machine `[memory]` slope and watchdog restart
  cadence (especially ewr at crawl peaks), disk-throttle events
  as new volumes warm (expected to decay as on ewr), and
  `extractions` vs `evictions` on the extracted tier.
- Next optimization candidate for the ewr tail: hash affinity
  so one package@version's enumeration lands on one machine,
  plus extracted-tier promotion/max-files tuning for
  mega-tarballs such as `openclaw`.

## Addendum: file tier (uncompressed tar + offset index), canary (2026-10-28)

Design (user-directed simplification of the earlier three-tier
sketch): one unified tier replaces the whole-tree extracted tier.
`src/lib/file-cache.ts`: on admission (default 10 sightings and
compressed tarball >= 256 KB), gunzip the cached `.tgz` once to an
uncompressed `.tar` on the volume and index every file as
`{path, offset, size, integrity}` (`indexTarFile`, a raw tar
parser handling ustar prefixes, pax 'x' path overrides, GNU
longname 'L', and base-256 sizes). `getFile` serves
`Bun.file(tar).slice(offset, offset+size)` via the existing
`bodyStream` path; `/list` answers from the index. No file-count
ceiling — the class the extracted tier permanently rejects
(>1,500 files: `openclaw`, `@pulumi/*`, `gdal-async`) is exactly
the target. Lookup is a precomputed lowercase-path map per entry
(a linear `find` over a 26k-entry listing cost ~34 ms p50 in the
first bench; the map brought it to 0.32 ms). Kill switches:
`UNPKG_FILE_CACHE=off`; canaries ran with
`UNPKG_EXTRACTED_CACHE=off` so the comparison is file tier vs
extracted tier, not both.

Motivating telemetry (fleet log sample, 2026-10-28): 8,668 GETs
covered 8,531 distinct paths but only 4,766 distinct tarballs;
exact-repeat paths were 1.6% of requests, while tarballs seen
>= 10x were 19.3%. The win is avoiding the re-scan, not caching
repeat files. `/list` was only 3.7% of slow requests.

Tests: 118 pass in `unpkg-files` (was 109), workspace gate 492
pass / 0 fail. New: oracle equivalence — `indexTarFile` vs system
`tar` extraction for every file in the lodash/react/preact
fixtures (bytes, size, SRI integrity all compared; 4,871 expects)
plus a synthetic long-path/empty/binary tar; unit tests for
single-flight, admission, declined-build-as-skip, byte-cap
rejection, residence hysteresis; integration test asserting
distinct files cost 1 download + 1 build and `/list` (1,054
files) is served from the index.

Offline bench (synthetic, distinct-file workload, concurrency
32, 240 files; macOS `tar` adds `._*` AppleDouble entries to the
synthetic tarballs, inflating file counts equally for all arms):

| Arm | Warm p50 | Warm p99 | Wall |
| --- | --- | --- | --- |
| Tarball only (3,001 files) | 369 ms | 594 ms | 3,001 ms |
| Extracted tier (3,001 files) | 4.4 ms | 9.2 ms | 35 ms |
| File tier (3,001 files) | 0.32 ms | 0.87 ms | 3 ms |
| Extracted, prod cap (26,001 files, rejected) | 2,906 ms | 4,694 ms | 23,464 ms |
| File tier (26,001 files) | 0.32 ms | 0.68 ms | 3 ms |

Canary (clones with fresh 30 GB volumes, current-stack machines
as same-region controls; per-machine percentiles from origin
duration logs, ~60 s windows):

- v1 (promotion 3, image `deployment-01M61Z2VVRS8ZFNGMFWGQ7B741`):
  sjc canary no regression. ewr canary cold sample was worse
  (paying builds), warmed sample best p50 (46 ms). But builds
  were too eager: 154 builds / 5.3 GB written in ~7 min on the
  ewr canary — disk-throttle territory, the failure mode this
  project has already fought.
- Revision: promotion 3 -> 10, >= 256 KB compressed size gate
  (declined builds are skips, not rejections), and a periodic
  eviction sweep (eviction previously only ran after builds, so
  the byte cap stopped self-enforcing once builds got rare).
- v3 (image `deployment-01M620NVE5KDBFVSAPY4EDGWN2`), warmed:
  ewr canary `2862175c115378` p50 29 ms / p95 322 ms / p99
  713 ms / >=1 s 0.7% vs current-stack ewr controls p50 45–77 /
  p95 534–918 / p99 930–2,284 / >=1 s 1.1–4.6%. sjc canary
  `e826333fd9e528` p50 45 / p95 245 / p99 414 vs controls
  49–58 / 304–393 / 537–837. Zero 429/5xx on both canaries,
  limiter shed=0 throughout.
- Eviction verified live: ewr canary entries 360 -> 255,
  4.05 GB evicted, `totalBytes` 11.1 -> 7.3 GB converging on the
  6 GB cap (overage was v1-built entries inside their 30-min
  residence), volume 39% -> 27% used.
- Memory watch item: ewr canary heapUsed peaked 1.12 GB before
  eviction freed listings, settling ~459 MB (listings + lookup
  maps are held in RAM, as extracted listings were); RSS
  ~1.19 GB vs 3 GB watchdog. Higher than extracted machines
  (~80–220 MB heap) — acceptable headroom, but the reason the
  byte cap and sweep matter.

`fly.json` now ships the file tier as the production default
(extracted off, promotion 10, size gate 256 KB, 6 GB cap);
`fly config validate` passes. Decision: hard data supports
drafting the PR. Not yet done: fleet rollout of this tier
(same clone/cordon playbook), stripping the two canary clones
back out after rollout, and a longer ewr peak soak to confirm
the heap plateau. Cordoned pre-#522 machines remain the
rollback fleet.

## Addendum: file-tier correctness protections (2026-10-28, post-canary)

Added after the canary, before drafting the PR, to close the
one silent-corruption failure mode (an exotic tar variant
mis-indexed would serve wrong bytes with a valid-looking
integrity string):

- Indexer hardening: pax `size=` overrides are honored (offsets
  stay correct for >8 GB files); GNU sparse entries (`S`,
  `GNU.sparse*` pax keys) throw `TarIndexUnsupportedError`
  instead of being guessed at.
- Fail-safe builds: any build error is counted
  (`[file-cache] failures=`), the staging file is dropped, and
  the request falls back to the tar-stream parse path. A build
  can never 500 a request again.
- Build-time cross-validation: every admitted build re-parses
  the original `.tgz` with the proven tar-stream parser and
  requires exact agreement on path/size/integrity for every
  regular file. Mismatch = build failure + fallback. Residual
  risk becomes two independent tar implementations agreeing on
  the same wrong bytes. `UNPKG_FILE_CACHE_VALIDATE=off` disables
  (not recommended).

Tests: 122 pass in `unpkg-files`, workspace gate green. New:
sparse rejection, pax-size override offsets, throwing-build
fallback counting, and an end-to-end sparse-tarball integration
test proving the request is served correctly by the parse
fallback with `buildFailures > 0` and no entry built. Bench
note: the first bench run after the size gate landed showed the
monster arm at parse speed — the synthetic `xxxx…` payload
gzips below the 256 KB gate, so builds were correctly declined;
with the gate disabled for synthetic data the file tier is back
at 0.30 ms p50 (validation active during those builds).

Canary v4 (`deployment-01M622NPXJ6N1RKGX3DRXAJQA4`, both
canaries updated in place, volumes/entries retained):
`failures=0` on sjc and ewr under real traffic, zero 429/5xx,
ewr canary entries 183 at 6.87 GB with eviction active. Latency
in the v4 window was parity with current-stack controls (calm
window; the v3 window above holds the clearer win). Serving
cost is unchanged — validation runs at build time only.
