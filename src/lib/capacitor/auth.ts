import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { createClient } from '@/lib/supabase/client';

const GOOGLE_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
const GOOGLE_IOS_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
const GOOGLE_ANDROID_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || '';

let initialized = false;

/**
 * Initialize the SocialLogin plugin with platform-specific credentials
 */
export async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (!Capacitor.isNativePlatform()) return;

  try {
    const config: any = {
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID,
      },
    };

    if (Capacitor.getPlatform() === 'ios') {
      config.google.iOSClientId = GOOGLE_IOS_CLIENT_ID;
      config.google.iOSServerClientId = GOOGLE_WEB_CLIENT_ID;
    }

    if (Capacitor.getPlatform() === 'android') {
      config.google.androidClientId = GOOGLE_ANDROID_CLIENT_ID;
      config.google.androidServerClientId = GOOGLE_WEB_CLIENT_ID;
    }

    await SocialLogin.initialize(config);
    initialized = true;
  } catch (error) {
    console.warn('[Capacitor] Failed to initialize SocialLogin:', error);
  }
}

/**
 * Sign in with Google via native provider
 * Handles iOS token caching issue with automatic retry
 */
export async function nativeGoogleSignIn(): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native sign-in only available on mobile');
  }

  await ensureInitialized();

  try {
    const result = await SocialLogin.login({
      provider: 'google',
    });

    if (!result.idToken) {
      throw new Error('No ID token returned');
    }

    return result.idToken;
  } catch (error: unknown) {
    // iOS token caching issue: if nonce validation fails, clear cached tokens and retry
    if (Capacitor.getPlatform() === 'ios' && error instanceof Error && error.message.includes('nonce')) {
      console.warn('[Capacitor] iOS nonce mismatch, clearing cache and retrying...');

      try {
        await SocialLogin.logout({ provider: 'google' });
        // Re-login and retry
        const retryResult = await SocialLogin.login({
          provider: 'google',
        });

        if (!retryResult.idToken) {
          throw new Error('No ID token returned on retry');
        }

        return retryResult.idToken;
      } catch (retryError) {
        console.error('[Capacitor] iOS sign-in retry failed:', retryError);
        throw retryError;
      }
    }

    throw error;
  }
}

/**
 * Sign in to Supabase using native Google ID token
 */
export async function signInWithNativeGoogle(): Promise<void> {
  const idToken = await nativeGoogleSignIn();
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });

  if (error) {
    throw error;
  }

  return;
}

/**
 * Logout from native auth and Supabase
 */
export async function nativeLogout(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const supabase = createClient();
  await supabase.auth.signOut();

  try {
    await SocialLogin.logout({ provider: 'google' });
  } catch (error) {
    console.warn('[Capacitor] Failed to logout from SocialLogin:', error);
  }
}
