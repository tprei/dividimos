import { describe, expect, it } from "vitest";
import { readAmbientEnv } from "./env";

const env = readAmbientEnv();

describe("production probes", () => {
  it("serves the app with the production supabase ref", async () => {
    const res = await fetch(`${env.baseUrl}/auth`);
    expect(res.status).toBe(200);

    const html = await res.text();
    // Match every chunk reference, not just `src=` script tags: preload links
    // point at the same bundles and a src-only regex finds a single file,
    // which would make the assertions below vacuous.
    const paths = [...new Set(html.match(/\/_next\/static\/[A-Za-z0-9_./-]+\.js/g) ?? [])];
    expect(paths.length).toBeGreaterThan(0);

    const chunks = (
      await Promise.all(paths.map((path) => fetch(env.baseUrl + path).then((r) => r.text())))
    ).join("\n");
    // The client bundle must embed the live Supabase ref; a deploy still
    // pointing at the retired project ref must fail this probe.
    expect(chunks).toContain(env.supabaseRef);
    expect(chunks).not.toContain("yqhsqkrxgafrifephppa");
  });

  it("redirects supabase authorize to google with the configured client", async () => {
    const res = await fetch(
      `${env.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${env.baseUrl}/auth/callback`)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);

    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://accounts.google.com/o/oauth2/v2/auth")).toBe(true);
    expect(location).toContain(`client_id=${env.googleClientId}`);
  });

  it("gets the supabase callback accepted by google", async () => {
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${env.googleClientId}&redirect_uri=${encodeURIComponent(`${env.supabaseUrl}/auth/v1/callback`)}&response_type=code&scope=openid`;
    const res = await fetch(url, { redirect: "manual" });
    expect(res.status).toBeLessThan(400);

    const location = res.headers.get("location") ?? "";
    const body = res.status >= 300 ? location : await res.text();
    expect(body.length).toBeGreaterThan(0);

    if (res.status >= 300) {
      expect(new URL(location).hostname).toBe("accounts.google.com");
    } else {
      expect(body.toLowerCase()).toContain("google");
    }

    // Catches an OAuth client whose redirect list no longer contains the
    // Supabase callback (redirect_uri_mismatch) or a dead client id
    // (invalid_client): Google reports both in the redirect target or body.
    expect(body).not.toContain("redirect_uri_mismatch");
    expect(body).not.toContain("invalid_client");
  });
});
