#!/usr/bin/env node
/**
 * Renders every raster icon, badge, and splash from the SVG sources.
 * SVGs are rasterised directly at the target resolution (density derived
 * from the intrinsic viewBox) rather than resampled from a 72dpi bitmap.
 *
 * Run: npm run icons
 * Then regenerate the native launcher/splash resources: npm run cap:assets
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const MARK = readFileSync("public/icon.svg");
const MASKABLE = readFileSync("public/icon-maskable.svg");
const BADGE = readFileSync("public/badge.svg");
const FOREGROUND = readFileSync("resources/icon-foreground.svg");

const BRAND = "#FEA101";
const SPLASH_LIGHT = "#F9F9FB";
const SPLASH_DARK = "#09243F";

/** Rasterise a square SVG at exactly `size` px without upscaling. */
async function rasterise(svg, size) {
  const { width } = await sharp(svg).metadata();
  if (!width) throw new Error("svg has no intrinsic width");
  const density = Math.ceil((72 * size) / width);
  return sharp(svg, { density })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writePng(svg, size, outPath) {
  writeFileSync(outPath, await rasterise(svg, size));
  console.log(`✓ ${outPath} (${size}x${size})`);
}

async function writeSolid(size, background, outPath) {
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size} ${background})`);
}

/** Flat-colour 2732² canvas with the mark centred, sized for @capacitor/assets. */
async function writeSplash(background, outPath) {
  const canvas = 2732;
  const mark = await rasterise(MARK, 512);
  await sharp({ create: { width: canvas, height: canvas, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(`✓ ${outPath} (${canvas}x${canvas} ${background})`);
}

for (const size of [96, 128, 192, 256, 384, 512]) {
  await writePng(MARK, size, `public/icon-${size}.png`);
}
for (const size of [192, 512]) {
  await writePng(MASKABLE, size, `public/icon-maskable-${size}.png`);
}
await writePng(MARK, 180, "public/apple-touch-icon.png");
await writePng(BADGE, 72, "public/badge-72.png");

await writePng(MARK, 1024, "resources/icon.png");
await writePng(FOREGROUND, 1024, "resources/icon-foreground.png");
await writeSolid(1024, BRAND, "resources/icon-background.png");
await writeSplash(SPLASH_LIGHT, "resources/splash.png");
await writeSplash(SPLASH_DARK, "resources/splash-dark.png");

// Placeholder PWA install screenshot (540x960).
mkdirSync("public/screenshots", { recursive: true });
const screenshotSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 960">
  <rect width="540" height="960" fill="#F9F9FB"/>
  <rect y="0" width="540" height="64" fill="#FEA101"/>
  <text x="270" y="40" text-anchor="middle" font-size="22" font-weight="bold" fill="#fff" font-family="sans-serif">Dividimos</text>
  <g transform="translate(270, 380)">
    <circle cx="0" cy="0" r="80" fill="#FEA101" opacity="0.1"/>
    <circle cx="0" cy="0" r="60" fill="none" stroke="#FEA101" stroke-width="6" opacity="0.5"/>
    <text x="0" y="12" text-anchor="middle" font-size="44" font-weight="bold" fill="#FEA101" font-family="sans-serif">R$</text>
  </g>
  <text x="270" y="520" text-anchor="middle" font-size="22" font-weight="bold" fill="#1a1d2e" font-family="sans-serif">Vamos dividir</text>
  <text x="270" y="560" text-anchor="middle" font-size="14" fill="#64748b" font-family="sans-serif">Racha a conta e paga via Pix na hora</text>
</svg>`);
await sharp(screenshotSvg).resize(540, 960).png({ compressionLevel: 9 }).toFile("public/screenshots/narrow.png");
console.log("✓ public/screenshots/narrow.png (540x960)");
