import * as path from "node:path";

import { Resvg } from "@resvg/resvg-js";

// Generates the 1200x630 social card images (og:image / twitter:card) served at
// /social-card.png by the www and esm workers (app pages reference the www card).
// Run with `pnpm run build:social-cards` from the repo root after changing any of
// the variants below.

const SANS = "Helvetica Neue, Helvetica, Arial, sans-serif";
const MONO = "Menlo, Monaco, Consolas, monospace";

const BLUE = "#5da9ff";
const GRAY = "#9ca3af";
const DIM = "#6b7280";

interface Variant {
  file: string;
  title: string;
  tagline: string;
  url: Array<[text: string, color: string]>;
}

const variants: Variant[] = [
  {
    file: "packages/unpkg-www/public/social-card.png",
    title: "UNPKG",
    tagline: "The CDN for everything on npm",
    url: [
      ["unpkg.com/", GRAY],
      [":package", BLUE],
      ["@", DIM],
      [":version", BLUE],
      ["/", DIM],
      [":file", BLUE],
    ],
  },
  {
    file: "packages/unpkg-esm/public/social-card.png",
    title: "UNPKG ESM",
    tagline: "Browser-ready ES modules for every npm package",
    url: [
      ["esm.unpkg.com/", GRAY],
      [":package", BLUE],
      ["@", DIM],
      [":version", BLUE],
      ["/", DIM],
      [":subpath", BLUE],
    ],
  },
];

function createSvg(variant: Variant): string {
  let urlSpans = variant.url
    .map(([text, color]) => `<tspan fill="${color}">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</tspan>`)
    .join("");

  // Menlo advances ~0.603em per character, so size the chip to fit the URL text
  let urlChars = variant.url.reduce((n, [text]) => n + text.length, 0);
  let chipWidth = 64 + Math.round(urlChars * 30 * 0.603);

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#000000"/>

  <!-- giant cropped U watermark bleeding off the right edge -->
  <text x="1265" y="660" text-anchor="end" font-family="${SANS}" font-weight="bold" font-size="860"
        fill="#101010">U</text>

  <!-- wordmark -->
  <text x="80" y="330" font-family="${SANS}" font-weight="bold" font-size="148" letter-spacing="-4"
        fill="#ffffff">${variant.title}</text>

  <!-- tagline -->
  <text x="84" y="410" font-family="${SANS}" font-weight="normal" font-size="42"
        fill="#a3a3a3">${variant.tagline}</text>

  <!-- URL pattern chip -->
  <rect x="80" y="472" rx="14" width="${chipWidth}" height="76" fill="#0d0d0d" stroke="#262626" stroke-width="2"/>
  <text x="112" y="521" font-family="${MONO}" font-size="30">${urlSpans}</text>
</svg>`;
}

let rootDir = path.resolve(import.meta.dirname, "..");

for (let variant of variants) {
  let resvg = new Resvg(createSvg(variant), {
    fitTo: { mode: "width", value: 1200 },
    font: { loadSystemFonts: true },
  });

  let png = resvg.render().asPng();
  let file = path.join(rootDir, variant.file);
  await Bun.write(file, png);
  console.log(`Wrote ${variant.file} (${png.length} bytes)`);
}
