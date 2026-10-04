"use client";

import { useEffect, useState } from "react";
import {
  LinkedAccountsSection,
  linkFailureMessage,
  type LinkedAccountProvider,
} from "@/components/settings/linked-accounts-section";
import { useClientOnly } from "@/hooks/use-client-only";
import { haptics } from "@/hooks/use-haptics";
import { isAppleSignInAvailable, isNativeGoogleSignInAvailable } from "@/lib/capacitor/auth";
import { storeAppleAuthorization } from "@/lib/sync/apple-credential";
import { fetchLinkedProviders, linkAppleAccount, linkGoogleAccount } from "@/lib/sync/identity-links";

type LinkedProviders = { apple: boolean; google: boolean };

// Linking only exists inside the iOS app, where Sign in with Apple does; on
// web and Android the person keeps signing in with Google.
export function LinkedAccountsSettings() {
  const nativeIos = useClientOnly(isAppleSignInAvailable);
  const googleLinkable = useClientOnly(isNativeGoogleSignInAvailable);
  const [providers, setProviders] = useState<LinkedProviders | null>(null);
  const [pendingProvider, setPendingProvider] = useState<LinkedAccountProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!nativeIos) return;
    let cancelled = false;
    fetchLinkedProviders().then(
      (linked) => {
        if (!cancelled) setProviders(linked);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [nativeIos, loadAttempt]);

  if (!nativeIos) return null;

  async function link(provider: LinkedAccountProvider) {
    setError(null);
    setPendingProvider(provider);
    const result = provider === "apple" ? await linkAppleAccount() : await linkGoogleAccount();
    setPendingProvider(null);
    if (result.status === "linked") {
      storeAppleAuthorization(result.authorizationCode);
      haptics.success();
      setProviders((current) => (current === null ? current : { ...current, [provider]: true }));
    } else if (result.status === "failed") {
      haptics.error();
      setError(linkFailureMessage(result.reason));
    }
  }

  return (
    <LinkedAccountsSection
      providers={providers}
      loadFailed={loadFailed}
      onRetryLoad={() => {
        setLoadFailed(false);
        setLoadAttempt((attempt) => attempt + 1);
      }}
      linkable={{ apple: true, google: googleLinkable }}
      pendingProvider={pendingProvider}
      onLink={(provider) => void link(provider)}
      error={error}
      onDismissError={() => setError(null)}
    />
  );
}
