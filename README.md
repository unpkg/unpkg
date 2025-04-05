## UNPKG

Welcome to UNPKG!

UNPKG is a fast, global content delivery network for everything on npm. Use it to quickly and easily load any file from [npm](https://npmjs.com) using a URL like:

```
https://unpkg.com/:package@:version/:file
```

Where `:package` is the package name, `:version` is the version range, and `:file` is the path to the file in the package.

You can [learn more about UNPKG on the website](https://unpkg.com).

## Development

This repository contains the production source for UNPKG. There are 4 packages:

- [`unpkg-app`](./packages/unpkg-app/) is the UNPKG web app (file browser)
- [`unpkg-files`](./packages/unpkg-files/) is the file server backend that fetches tarballs from npm and extracts their contents
- [`unpkg-worker`](./packages/unpkg-worker/) is a shared set of utilites between the web apps (Cloudflare workers)
- [`unpkg-www`](./packages/unpkg-www/) is the main UNPKG app

We use [Bun](https://bun.sh/) in development, as well as [pnpm](https://pnpm.io/). Install these first.

Next, install all dependencies and run the tests:

```sh
pnpm install
pnpm test
```

Then start the file server and each worker along with its assets server (you'll need 5 terminal tabs):

```sh
cd packages/unpkg-files && pnpm dev
cd packages/unpkg-www && pnpm dev
cd packages/unpkg-www && pnpm dev:assets
cd packages/unpkg-app && pnpm dev
cd packages/unpkg-app && pnpm dev:assets
```

The dev server will be listening on `http://localhost:3000`.

## Deploying

The `unpkg-files` backend is deployed on [Fly.io](https://fly.io). You'll need an account.

Next, adjust the Fly config in `packages/unpkg-files/fly.json` (you'll need your own app `name`) and deploy:

```sh
cd packages/unpkg-files && pnpm run deploy
```

To deploy the workers, you'll need a [Cloudflare](https://cloudflare.com) account. You will also need to (1) edit the `wrangler.json` file in each worker and update its [`routes`](https://developers.cloudflare.com/workers/wrangler/configuration/) to your own domain(s) and (2) adjust each worker's environment `vars` (in `wrangler.json`) so they can find one another in production.

Once you've done that, you can deploy each worker with:

```sh
cd packages/unpkg-www && pnpm run deploy
cd packages/unpkg-app && pnpm run deploy
```

## License

Please see [LICENSE](./LICENSE) for more information.
