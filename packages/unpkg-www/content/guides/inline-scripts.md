# Inline Scripts

The `/run` helper finds inline TypeScript and JSX script blocks in your page, transforms them, and executes them as modules, with no build step and no separate files.

Source page: https://unpkg.com/guides/inline-scripts

## The /run helper

Load `https://unpkg.com/run` as a module script. It scans the page for inline scripts of type `text/ts`, `text/jsx`, and `text/tsx`, transforms them through esm.unpkg.com, and inserts executable module scripts in their place.

```html
<script type="module" src="https://unpkg.com/run"></script>
<script type="text/ts">
  import confetti from "canvas-confetti";
  confetti({ particleCount: 80, spread: 70 });
</script>
```

## Script attributes

| Attribute | Use |
|---|---|
| `data-filename` | Names the inline file for extension inference and clearer diagnostics. |
| `data-target` | Sets the JavaScript output target, such as `es2022`. |
| `data-jsx` | Chooses JSX mode, such as `automatic`. |
| `data-jsx-import-source` | Sets the JSX import source, such as `preact`. |
| `data-dev` | Enables development-mode JSX output. |
