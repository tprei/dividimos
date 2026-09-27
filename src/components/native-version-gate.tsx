"use client";

import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NativeUpdateScreen } from "@/components/shared/native-update-screen";
import type { NativeUpdateScreenProps } from "@/components/shared/native-update-screen";
import {
  compareNativeBuild,
  MINIMUM_NATIVE_BUILDS,
} from "@/lib/native-version";
import type { NativePlatform } from "@/lib/native-version";

type GateState =
  | { status: "supported" }
  | { status: "check-error" }
  | { status: "update-required"; platform: NativePlatform };

type StoreState = Extract<
  NativeUpdateScreenProps,
  { state: "update-required" }
>["storeState"];

const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=ai.dividimos.app";

async function readNativeVersion(): Promise<GateState> {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") {
    return { status: "supported" };
  }
  if (MINIMUM_NATIVE_BUILDS[platform] === 0) {
    return { status: "supported" };
  }
  const info = await App.getInfo();
  const result = compareNativeBuild(platform, info.build, MINIMUM_NATIVE_BUILDS);
  if (result === "invalid-build") return { status: "check-error" };
  if (result === "update-required") return { status: "update-required", platform };
  return { status: "supported" };
}

export function NativeVersionGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>({ status: "supported" });
  const [storeState, setStoreState] = useState<StoreState>("idle");

  useEffect(() => {
    let active = true;
    void readNativeVersion().then(
      (result) => {
        if (active) setGate(result);
      },
      () => {
        if (active) setGate({ status: "check-error" });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function openStore(): Promise<void> {
    if (gate.status !== "update-required" || gate.platform !== "android") return;
    if (storeState === "opening") return;
    setStoreState("opening");
    try {
      await Browser.open({ url: PLAY_STORE_URL });
      setStoreState("opened");
    } catch {
      setStoreState("error");
    }
  }

  if (gate.status === "supported") return children;
  if (gate.status === "check-error") {
    return (
      <NativeUpdateScreen
        state="check-error"
        onReload={() => window.location.reload()}
      />
    );
  }
  return (
    <NativeUpdateScreen
      state="update-required"
      canOpenStore={gate.platform === "android"}
      storeState={storeState}
      onOpenStore={() => {
        void openStore();
      }}
    />
  );
}
