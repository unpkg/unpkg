## UNPKG

Welcome to UNPKG!

UNPKG is a fast, global content delivery network for everything on npm. Use it to quickly and easily load any file from [npm](https://npmjs.com) using a URL like:

```
https://unpkg.com/:package@:version/:file
```

Where `:package` is the package name, `:version` is the version range, and `:file` is the path to the file in the package.

You can learn more about UNPKG [on the website](https://unpkg.com).

## Development

This repository contains the source for the unpkg.com production server. The source is divided into two [Cloudflare Workers](https://workers.cloudflare.com/):

- [`unpkg-www-worker`](./workers/www/) serves all files on npm and the main homepage
- [`unpkg-app-worker`](./workers/app/) serves the package detail pages

To run everything locally, you'll first need to do an install:

```sh
pnpm install
```

Then start each worker along with its assets server (you'll need 4 terminal tabs):

```sh
cd workers/www && pnpm dev
cd workers/www && pnpm dev:assets
cd workers/app && pnpm dev
cd workers/app && pnpm dev:assets
```

The dev server will be listening on `http://localhost:3000`. [Wrangler](https://developers.cloudflare.com/workers/cli-wrangler) allows the workers to find and communicate with each other in dev.

## Deploying

To deploy the workers, you'll need to have a [Cloudflare](https://cloudflare.com) account. You will also need to edit the `wrangler.json` file in each worker and update its [`routes`](https://developers.cloudflare.com/workers/wrangler/configuration/) to your own domain(s). You'll also need to adjust each worker's environment `vars` (in `wrangler.json`) so they can find one another in production.

Once you've done that, you can deploy each worker with:

```sh
cd workers/www && pnpm deploy
cd workers/app && pnpm deploy
```

## License

Please see [LICENSE](./LICENSE) for more information.
