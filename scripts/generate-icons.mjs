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
  <rect width="540" height="960" fill="#F9F9FB"/>
  <rect y="0" width="540" height="64" fill="#FEA101"/>
  <text x="270" y="40" text-anchor="middle" font-size="22" font-weight="bold" fill="#fff" font-family="sans-serif">Pagajaja</text>
  <g transform="translate(270, 380)">
    <circle cx="0" cy="0" r="80" fill="#FEA101" opacity="0.1"/>
    <circle cx="0" cy="0" r="60" fill="none" stroke="#FEA101" stroke-width="6" opacity="0.5"/>
    <text x="0" y="12" text-anchor="middle" font-size="44" font-weight="bold" fill="#FEA101" font-family="sans-serif">R$</text>
  </g>
  <text x="270" y="520" text-anchor="middle" font-size="22" font-weight="bold" fill="#1a1d2e" font-family="sans-serif">Ja te pago</text>
  <text x="270" y="560" text-anchor="middle" font-size="14" fill="#64748b" font-family="sans-serif">Racha a conta e paga via Pix na hora</text>
</svg>`);
await sharp(screenshotSvg)
  .resize(540, 960)
  .png()
  .toFile("public/screenshots/narrow.png");
console.log("✓ generated public/screenshots/narrow.png");

console.log("Done!");
