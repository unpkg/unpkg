# unpkg-www

This is the main home page and file server for UNPKG. It is built and deployed as a Cloudflare Worker.

## Development

Install dependencies and run the tests:

```
pnpm install
pnpm test
```

Boot the dev server and assets server (two separate tabs):

```
pnpm dev
pnpm dev:assets
```

## Deploying

Edit the worker configuration in `wrangler.json`, then:

```
pnpm run deploy
```
