import { getSupabase } from "@/lib/sync/client";
import {
  loadLinkedProviders as loadLinkedProvidersCapacitor,
  linkAppleIdentity as linkAppleIdentityCapacitor,
  linkGoogleIdentity as linkGoogleIdentityCapacitor,
  type NativeLinkResult,
} from "@/lib/capacitor/auth";

export async function fetchLinkedProviders(): Promise<{ apple: boolean; google: boolean }> {
  return loadLinkedProvidersCapacitor(getSupabase());
}

export async function linkAppleAccount(): Promise<NativeLinkResult> {
  return linkAppleIdentityCapacitor(getSupabase());
}

export async function linkGoogleAccount(): Promise<NativeLinkResult> {
  return linkGoogleIdentityCapacitor(getSupabase());
}
