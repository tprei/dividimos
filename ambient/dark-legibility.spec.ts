import { expect, test } from "@playwright/test";
import { loginInContext } from "../e2e/fixtures";
import { ensureTroupe, type Troupe } from "./bots";
import { note } from "./diary";

// Opt-in: a contrast finding should be triaged by a person, not turn the
// scheduled board red. Run with AMBIENT_EXPERIMENTAL=1 or the workflow's
// "experimental" input.
test.skip(process.env.AMBIENT_EXPERIMENTAL !== "1", "set AMBIENT_EXPERIMENTAL=1 to run");

let troupe: Troupe;

test.beforeAll(async () => {
  troupe = await ensureTroupe();
});

interface IllegibleText {
  selector: string;
  text: string;
  ratio: number;
  need: number;
  size: number;
  weight: number;
}

interface DarkScan {
  checked: number;
  offenders: IllegibleText[];
}

/**
 * Walks every visible text node in the page and compares its computed paint
 * against the first opaque background under it: alpha backgrounds composite
 * on the way up and a gradient stands in as the mean of its stops. Runs
 * inside the page, where the live computed styles are.
 *
 * Chromium hands computed colors back as lab()/oklab() (oklch tokens and
 * color-mix() both land there), so the parser covers every form the app can
 * meet, and converts through CSS Color 4 to sRGB.
 */
function scanDarkText(): DarkScan {
  interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
  }

  const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

  const NUMBER = "[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?%?";
  const ALPHAS = "(?:[\\s,/]+(" + NUMBER + "))?";
  const RGB = new RegExp(`^rgba?\\(\\s*(${NUMBER})[\\s,]+(${NUMBER})[\\s,]+(${NUMBER})${ALPHAS}\\s*\\)$`);
  const LAB = new RegExp(`^lab\\(\\s*(${NUMBER}|none)[\\s]+(${NUMBER}|none)[\\s]+(${NUMBER}|none)${ALPHAS}\\s*\\)$`);
  const OKLAB = new RegExp(`^oklab\\(\\s*(${NUMBER}|none)[\\s]+(${NUMBER}|none)[\\s]+(${NUMBER}|none)${ALPHAS}\\s*\\)$`);
  const OKLCH = new RegExp(
    `^oklch\\(\\s*(${NUMBER}|none)[\\s]+(${NUMBER}|none)[\\s]+(${NUMBER}|none)(?:\\s*\\/\\s*(${NUMBER}|none))?\\s*\\)$`,
  );
  const SRGB = new RegExp(`^color\\(\\s*srgb\\s+(${NUMBER})[\\s]+(${NUMBER})[\\s]+(${NUMBER})${ALPHAS}\\s*\\)$`);

  const number = (token: string | undefined, scale: number): number => {
    if (token === undefined || token === "none") return 0;
    const value = parseFloat(token);
    return token.endsWith("%") ? (value / 100) * scale : value;
  };
  const alpha = (token: string | undefined): number =>
    token === undefined ? 1 : clamp(number(token, 1), 1);

  const gamma = (v: number): number =>
    v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  const toRgba = (linear: number[], a: number): Rgba => ({
    r: Math.round(255 * gamma(clamp(linear[0], 1))),
    g: Math.round(255 * gamma(clamp(linear[1], 1))),
    b: Math.round(255 * gamma(clamp(linear[2], 1))),
    a,
  });

  // OKLab to linear sRGB (Ottosson's coefficients); channels leave [0,1] only
  // for out-of-gamut colors, which the display clamps anyway.
  const oklabToLinear = (l: number, a: number, b: number): number[] => {
    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;
    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;
    return [
      4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
      -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
      -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    ];
  };

  // CIELAB with the CSS Color 4 D50 white, Bradford-adapted to D65 sRGB.
  const labToLinear = (lightness: number, a: number, b: number): number[] => {
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const cube = (t: number): number => (t * t * t > epsilon ? t * t * t : (116 * t - 16) / kappa);
    const fy = (lightness + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const x = cube(fx) * 0.9642956764295677;
    const y = lightness > kappa * epsilon ? Math.pow((lightness + 16) / 116, 3) : lightness / kappa;
    const z = cube(fz) * 0.8251046025104602;
    const x65 = 0.9554734527042182 * x - 0.023098536874261423 * y + 0.0632593086610217 * z;
    const y65 = -0.028369706963208136 * x + 1.0099954580058226 * y + 0.021041398966943008 * z;
    const z65 = 0.012314001688319268 * x - 0.020507696433477912 * y + 1.3303659366080753 * z;
    return [
      3.2409699419045213 * x65 - 1.5373831775700946 * y65 - 0.49861076029300328 * z65,
      -0.96924363628087983 * x65 + 1.8759675015077207 * y65 + 0.041555057407175613 * z65,
      0.055630079696993609 * x65 - 0.20397695888897657 * y65 + 1.0569715142428786 * z65,
    ];
  };

  // null means "nothing painted": for a background, keep walking up; for
  // text, nothing to measure.
  const parseColor = (value: string): Rgba | null => {
    const v = value.trim().toLowerCase();
    if (v === "" || v === "none" || v === "transparent") return null;

    const hex = /^#([0-9a-f]{3,8})$/.exec(v);
    if (hex) {
      const digits = hex[1];
      const expanded =
        digits.length === 3 || digits.length === 4
          ? [...digits].map((d) => d + d).join("")
          : digits;
      if (expanded.length === 6 || expanded.length === 8) {
        const byte = (index: number): number =>
          parseInt(expanded.slice(index * 2, index * 2 + 2), 16);
        return {
          r: byte(0),
          g: byte(1),
          b: byte(2),
          a: expanded.length === 8 ? byte(3) / 255 : 1,
        };
      }
      return null;
    }

    const rgb = RGB.exec(v);
    if (rgb) {
      return {
        r: clamp(number(rgb[1], 255), 255),
        g: clamp(number(rgb[2], 255), 255),
        b: clamp(number(rgb[3], 255), 255),
        a: alpha(rgb[4]),
      };
    }

    const srgb = SRGB.exec(v);
    if (srgb) {
      return {
        r: clamp(number(srgb[1], 1), 1) * 255,
        g: clamp(number(srgb[2], 1), 1) * 255,
        b: clamp(number(srgb[3], 1), 1) * 255,
        a: alpha(srgb[4]),
      };
    }

    const oklab = OKLAB.exec(v);
    if (oklab) {
      return toRgba(
        oklabToLinear(number(oklab[1], 1), number(oklab[2], 0.4), number(oklab[3], 0.4)),
        alpha(oklab[4]),
      );
    }

    const oklch = OKLCH.exec(v);
    if (oklch) {
      const radians = (number(oklch[3], 360) * Math.PI) / 180;
      const chroma = number(oklch[2], 0.4);
      return toRgba(
        oklabToLinear(
          number(oklch[1], 1),
          chroma * Math.cos(radians),
          chroma * Math.sin(radians),
        ),
        alpha(oklch[4]),
      );
    }

    const lab = LAB.exec(v);
    if (lab) {
      return toRgba(
        labToLinear(number(lab[1], 100), number(lab[2], 125), number(lab[3], 125)),
        alpha(lab[4]),
      );
    }
    return null;
  };

  const luminance = (color: Rgba): number => {
    const linear = (v: number): number => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
  };

  const compositeOver = (src: Rgba, dst: Rgba): Rgba => {
    const a = src.a + dst.a * (1 - src.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (s: number, d: number): number => (s * src.a + d * dst.a * (1 - src.a)) / a;
    return { r: mix(src.r, dst.r), g: mix(src.g, dst.g), b: mix(src.b, dst.b), a };
  };

  // Hero surfaces paint short gradient ramps; the alpha-weighted stop mean is
  // an honest stand-in for the pixels behind the glyphs.
  const gradientAverage = (image: string): Rgba | null => {
    const stops: Rgba[] = [];
    const pattern = /rgba?\([^()]*\)|(?:ok)?lab\([^()]*\)|oklch\([^()]*\]|color\([^()]*\)|#[0-9a-fA-F]{3,8}/g;
    for (const match of image.matchAll(pattern)) {
      const color = parseColor(match[0]);
      if (color !== null) stops.push(color);
    }
    if (stops.length === 0) return null;
    const total = stops.reduce(
      (sum, stop) => ({
        r: sum.r + stop.r * stop.a,
        g: sum.g + stop.g * stop.a,
        b: sum.b + stop.b * stop.a,
        a: sum.a + stop.a,
      }),
      { r: 0, g: 0, b: 0, a: 0 },
    );
    if (total.a === 0) return null;
    return {
      r: total.r / total.a,
      g: total.g / total.a,
      b: total.b / total.a,
      a: total.a / stops.length,
    };
  };

  const effectiveBackground = (el: Element): Rgba | null => {
    let acc: Rgba | null = null;
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parseColor(style.backgroundColor);
      if (color !== null) acc = acc === null ? color : compositeOver(color, acc);
      if (style.backgroundImage !== "none") {
        const gradient = gradientAverage(style.backgroundImage);
        if (gradient !== null) acc = acc === null ? gradient : compositeOver(gradient, acc);
      }
      if (acc !== null && acc.a >= 0.999) return acc;
    }
    if (acc === null || acc.a <= 0.001) return null;
    return compositeOver(acc, { r: 255, g: 255, b: 255, a: 1 });
  };

  const fontWeight = (style: CSSStyleDeclaration): number => {
    if (style.fontWeight === "bold") return 700;
    const parsed = parseFloat(style.fontWeight);
    return Number.isFinite(parsed) ? parsed : 400;
  };

  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].slice(0, 3).join(".");
    return classes === "" ? tag : `${tag}.${classes}`;
  };

  const offenders: IllegibleText[] = [];
  const seen = new Set<string>();
  let checked = 0;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let text: Node | null;
  while ((text = walker.nextNode()) !== null) {
    const raw = (text.nodeValue ?? "").trim();
    if (raw === "") continue;
    const el = text.parentElement;
    if (el === null) continue;
    if (el.closest("script, style, noscript, template, title") !== null) continue;
    if (el.closest('[aria-hidden="true"]') !== null) continue;
    if (el.closest(".sr-only") !== null) continue;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (el.getClientRects().length === 0) continue;

    let opacity = 1;
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      opacity *= parseFloat(getComputedStyle(node).opacity);
    }
    if (opacity < 0.05) continue;

    // SVG glyphs paint with fill, HTML with color.
    const svg = el.namespaceURI === "http://www.w3.org/2000/svg";
    const paint = parseColor(svg ? style.fill : style.color);
    const background = effectiveBackground(el);
    if (paint === null || paint.a < 0.05 || background === null) continue;

    checked += 1;

    const size = parseFloat(style.fontSize);
    const weight = fontWeight(style);
    const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
    const l1 = luminance(paint);
    const l2 = luminance(background);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio + 0.01 >= need) continue;

    const key = `${describe(el)}|${raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offenders.push({
      selector: describe(el),
      text: raw.slice(0, 60),
      ratio: Math.round(ratio * 100) / 100,
      need,
      size,
      weight,
    });
    if (offenders.length >= 12) break;
  }

  return { checked, offenders };
}

function format(offender: IllegibleText): string {
  return `${offender.selector} "${offender.text}" ${offender.ratio}:1 needs ${offender.need}:1 at ${offender.size}px/${offender.weight}`;
}

/**
 * One bot walks the four core screens with the stored theme dark and the
 * system scheme dark. Every visible text node has to clear WCAG contrast
 * against its real background, and every reload has to keep the dark class:
 * the stored choice is only applied by the theme bootstrap, so a route that
 * reloads into light mode is a regression the screenshot board cannot catch.
 */
test("[experimental] dark-mode text stays legible", async ({ browser }) => {
  test.setTimeout(150_000);

  const ctx = await browser.newContext({ colorScheme: "dark" });
  const page = await ctx.newPage();

  try {
    // The stored choice is what the theme bootstrap reads; the emulated
    // scheme matches the phone a dark-mode user actually holds.
    await ctx.addInitScript(() => localStorage.setItem("theme", "dark"));
    await loginInContext(ctx, page, troupe.bots[0]);

    const routes = ["/app", "/app/groups", `/app/groups/${troupe.groupId}`, "/app/activity"];
    let checked = 0;

    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);

      const scan = await page.evaluate(scanDarkText);
      checked += scan.checked;
      expect(
        scan.offenders.map(format),
        `dark-mode contrast on ${route} (${scan.checked} text nodes checked)`,
      ).toEqual([]);

      const keptDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      );
      expect(keptDark, `stored dark theme survives a reload on ${route}`).toBe(true);
    }

    note(`Escuro: ${checked} textos em ${routes.length} telas legíveis no tema escuro`);
  } finally {
    await ctx.close();
  }
});
