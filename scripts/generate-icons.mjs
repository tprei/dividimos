#!/usr/bin/env node
/**
 * Generate PWA icons (regular + maskable) and a placeholder screenshot.
 * Run: node scripts/generate-icons.mjs
 */
import { readFileSync, mkdirSync } from "fs";
import sharp from "sharp";

const regularSvg = readFileSync("public/icon.svg");
const maskableSvg = readFileSync("public/icon-maskable.svg");

// Regular icons
for (const size of [192, 512]) {
  await sharp(regularSvg)
    .resize(size, size)
    .png()
    .toFile(`public/icon-${size}.png`);
  console.log(`✓ generated public/icon-${size}.png`);
}

// Maskable icons (extra padding baked into the SVG)
for (const size of [192, 512]) {
  await sharp(maskableSvg)
    .resize(size, size)
    .png()
    .toFile(`public/icon-maskable-${size}.png`);
  console.log(`✓ generated public/icon-maskable-${size}.png`);
}

// Placeholder screenshot for richer Android install UI (540x960)
mkdirSync("public/screenshots", { recursive: true });
const screenshotSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 960">
  <rect width="540" height="960" fill="#f5fdfc"/>
  <rect y="0" width="540" height="64" fill="#0d9488"/>
  <text x="270" y="40" text-anchor="middle" font-size="22" font-weight="bold" fill="#fff" font-family="sans-serif">Pixwise</text>
  <g transform="translate(270, 400)">
    <rect x="-80" y="-80" width="160" height="160" rx="32" fill="#0d9488" opacity="0.1"/>
    <text x="0" y="8" text-anchor="middle" font-size="48" font-weight="bold" fill="#0d9488" font-family="sans-serif">₱W</text>
  </g>
  <text x="270" y="560" text-anchor="middle" font-size="20" fill="#0d9488" font-family="sans-serif">Divida a conta sem estresse</text>
  <text x="270" y="600" text-anchor="middle" font-size="14" fill="#64748b" font-family="sans-serif">Escaneie, divida e pague via Pix</text>
</svg>`);
await sharp(screenshotSvg)
  .resize(540, 960)
  .png()
  .toFile("public/screenshots/narrow.png");
console.log("✓ generated public/screenshots/narrow.png");

console.log("Done!");
