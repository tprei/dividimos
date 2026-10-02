import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

function runsProxy(url: string): boolean {
  return unstable_doesMiddlewareMatch({ config, url });
}

describe("proxy matcher", () => {
  it.each([
    "/item-icons/coffee.svg",
    "/icon.svg",
    "/apple-touch-icon.png",
    "/icon-maskable-192.png",
    "/badge.svg",
    "/favicon.ico",
    "/images/hero.webp",
    "/screenshots/narrow.png",
  ])("serves the static file %s without the auth session check", (url) => {
    expect(runsProxy(url)).toBe(false);
  });

  it.each([
    "/",
    "/app",
    "/app/bill/new",
    "/room/4d57c465-28ca-4070-b8eb-6e1941bfe6cb",
    "/api/users/lookup",
    "/auth",
    "/app/bill/receipt.png",
    "/room/4d57c465-28ca-4070-b8eb-6e1941bfe6cb.svg",
  ])("still runs on the page or route %s", (url) => {
    expect(runsProxy(url)).toBe(true);
  });
});
