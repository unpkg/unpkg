---
name: unpkg-deploy
description: Deploy, verify, or troubleshoot UNPKG services on Cloudflare Workers and Fly.io, and map code changes to the correct service using the repository architecture. Use for UNPKG deployment planning, staging or production releases, service ownership, environment configuration, health checks, and rollback preparation.
---

# UNPKG Deploy

Operate this repository as a group of four deployable services plus one shared library. Preserve the user's requested environment and service scope; a request to inspect, explain, or plan a deployment does not authorize a live deployment.

## Route the task

- Read [references/architecture.md](references/architecture.md) when identifying service ownership, tracing requests, deciding what a change affects, or explaining the system.
- Read [references/deployment.md](references/deployment.md) before executing a deployment, preparing a release plan, checking credentials or configuration, validating a release, or investigating a rollback.

## Operating rules

1. Work from the repository root and inspect the current `package.json` scripts and relevant `wrangler.json` or Fly config before acting. Treat those files as source of truth if a reference has become stale.
2. Inspect `git status` and the relevant diff before choosing deployment scope. Preserve unrelated or user-owned changes.
3. Map runtime changes to deployables. In particular, `unpkg-worker` is not deployed by itself; deploy every runtime that consumes the changed shared code. Root `deploy:workers` deploys only the three Cloudflare Workers and never `unpkg-files`.
4. Validate in proportion to risk. Prefer staging before production for cross-service, origin-contract, routing, caching, asset-pipeline, or ESM-transform changes. Do not represent health checks alone as sufficient validation.
5. Use the checked-in pnpm scripts. They encode asset builds, environment loading, Docker build context, app names, routes, and provider flags that direct CLI calls can bypass.
6. Keep credentials local. Never print, copy, commit, or rewrite secret values. Cloudflare deploy scripts load the gitignored root `.env.local`; Fly authentication is managed by the Fly CLI.
7. For an ambiguous live request such as “deploy UNPKG,” establish the environment and affected services before mutating external state. Do not change production route names, domains, Fly app names, or environment origins merely to make a deploy succeed.
8. After a deploy, verify provider success, service health, and at least one behavior exercising the changed path. Report the environment, deployed services, observed revisions or versions when available, checks performed, and any remaining risk.

## Failure handling

Stop rollout when a dependency, build, test, deploy, or smoke check fails. Capture the failing service and command, inspect provider output without exposing secrets, and avoid continuing dependent deployments unless the user explicitly accepts the risk. For rollback, identify a known-good revision and the affected services first; use provider deployment history or redeploy that revision rather than improvising destructive repository changes.
