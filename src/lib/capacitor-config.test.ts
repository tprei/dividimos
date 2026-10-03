import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ANDROID_ONLY_PLUGINS = ["@capacitor-community/contacts"];

function readPackageJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function installedIosPlugins(): string[] {
  const root = readPackageJson(join(process.cwd(), "package.json"));
  const dependencies = Object.keys(root.dependencies as Record<string, string>);
  return dependencies.filter((name) => {
    const manifest = readPackageJson(join(process.cwd(), "node_modules", name, "package.json"));
    const capacitor = manifest.capacitor as { ios?: unknown } | undefined;
    return capacitor?.ios !== undefined;
  });
}

describe("capacitor.config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEV_SERVER_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadConfig() {
    const mod = await import("../../capacitor.config");
    return mod.default;
  }

  it("ships every installed iOS plugin except the Android-only ones", async () => {
    const config = await loadConfig();
    const expected = installedIosPlugins().filter((name) => !ANDROID_ONLY_PLUGINS.includes(name));

    expect([...(config.ios?.includePlugins ?? [])].sort()).toEqual(expected.sort());
  });

  it("uses production URL when CAPACITOR_DEV is not set", async () => {
    delete process.env.CAPACITOR_DEV;
    const config = await loadConfig();
    expect(config.server?.url).toBe("https://www.dividimos.ai");
  });

  it("uses Android emulator IP when CAPACITOR_DEV=true and no LAN_IP", async () => {
    process.env.CAPACITOR_DEV = "true";
    delete process.env.CAPACITOR_IOS_SIMULATOR;
    delete process.env.LAN_IP;
    const config = await loadConfig();
    expect(config.server?.url).toBe("http://10.0.2.2:3000");
  });

  it("uses LAN_IP when CAPACITOR_DEV=true and LAN_IP is set", async () => {
    process.env.CAPACITOR_DEV = "true";
    delete process.env.CAPACITOR_IOS_SIMULATOR;
    process.env.LAN_IP = "192.168.1.42";
    const config = await loadConfig();
    expect(config.server?.url).toBe("http://192.168.1.42:3000");
  });

  it("prefers an https DEV_SERVER_URL over LAN_IP, and only in dev mode", async () => {
    process.env.CAPACITOR_DEV = "true";
    process.env.LAN_IP = "192.168.1.42";
    process.env.DEV_SERVER_URL = "https://dev-tunnel.example.com";
    expect((await loadConfig()).server?.url).toBe("https://dev-tunnel.example.com");

    vi.resetModules();
    delete process.env.CAPACITOR_DEV;
    expect((await loadConfig()).server?.url).toBe("https://www.dividimos.ai");
  });

  it("uses localhost when CAPACITOR_DEV=true and CAPACITOR_IOS_SIMULATOR=true", async () => {
    process.env.CAPACITOR_DEV = "true";
    process.env.CAPACITOR_IOS_SIMULATOR = "true";
    const config = await loadConfig();
    expect(config.server?.url).toBe("http://localhost:3000");
  });

  it("has PushNotifications plugin config with presentation options", async () => {
    const config = await loadConfig();
    expect(config.plugins?.PushNotifications).toEqual({
      presentationOptions: ["badge", "sound", "alert"],
    });
  });

  it("enables cleartext only in dev mode", async () => {
    delete process.env.CAPACITOR_DEV;
    const prodConfig = await loadConfig();
    expect(prodConfig.server?.cleartext).toBe(false);

    vi.resetModules();
    process.env.CAPACITOR_DEV = "true";
    const devConfig = await loadConfig();
    expect(devConfig.server?.cleartext).toBe(true);
  });
});
