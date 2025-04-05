# unpkg-app

This packages is the UNPKG web app. It is built and deployed as a [Cloudflare Worker](https://workers.cloudflare.com/).

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
