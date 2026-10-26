# Nobuild Apps

You don't need a bundler to use npm packages in the browser. With import maps, the browser itself resolves your dependencies from UNPKG.

Source page: https://unpkg.com/guides/nobuild-apps

## Import maps do the bundler's job

An import map tells the browser where bare imports like `preact` should load from. Point them at UNPKG and a plain HTML file becomes a working app:

```html
<script type="importmap">
  {
    "imports": {
      "preact": "https://unpkg.com/preact@10.25.4/dist/preact.module.js",
      "preact/hooks": "https://unpkg.com/preact@10.25.4/hooks/dist/hooks.module.js",
      "htm": "https://unpkg.com/htm@3.1.1/dist/htm.module.js"
    }
  }
</script>
<script type="module">
  import { h, render } from "preact";
  // your app here
</script>
```

## Version specifiers in the map

Pinning exact versions in the map keeps the browser cache and the edge cache hot, with the same trade-off as any pinned URL: patches only arrive when you update the map. Looser specifiers, especially patch-level ones (e.g. `preact@10.25`), flow bug fixes to you automatically, at the cost of a redirect on the way in. The security side of letting versions move is what [supply-chain defense at the edge](https://unpkg.com/guides/supply-chain-security.md) is for.

For packages that aren't published as browser modules, [esm.unpkg.com converts them first](https://unpkg.com/guides/browser-modules.md).
