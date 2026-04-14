import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("capacitor.config", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  async function loadConfig() {
    const mod = await import("../../capacitor.config");
    return mod.default;
  }

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

  it("uses localhost when CAPACITOR_DEV=true and CAPACITOR_IOS_SIMULATOR=true", async () => {
    process.env.CAPACITOR_DEV = "true";
    process.env.CAPACITOR_IOS_SIMULATOR = "true";
    const config = await loadConfig();
    expect(config.server?.url).toBe("http://localhost:3000");
  });

  it("has iOS config block", async () => {
    const config = await loadConfig();
    expect(config.ios).toBeDefined();
    expect(config.ios?.backgroundColor).toBe("#F9F9FB");
    expect(config.ios?.contentInset).toBe("automatic");
    expect(config.ios?.preferredContentMode).toBe("mobile");
    expect(config.ios?.scheme).toBe("Dividimos");
  });

  it("has Android config block", async () => {
    const config = await loadConfig();
    expect(config.android).toBeDefined();
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
