# Status & Reliability

The surfaces behind UNPKG, how changes ship safely to production, and how to check the service's health yourself.

Source page: https://unpkg.com/status

## Surfaces checked from the status page

The status page at https://unpkg.com/status runs live checks from the visitor's own browser against:

- The UNPKG website and file CDN (`unpkg.com`)
- The package browser (`app.unpkg.com`)
- The browser-modules service (`esm.unpkg.com`, beta)

Each check reports Operational or Not reachable from that visitor's network. It is a per-visitor reachability signal, not a global uptime figure or an SLO.

## How changes ship

Changes to the UNPKG workers are deployed to a staging environment first and verified there before production. Supply-chain enforcement (UNPKG Shield) runs on the normal request path, before cache lookups.

## Contact

- Support: support@unpkg.com
- About and project details: https://unpkg.com/about.md
