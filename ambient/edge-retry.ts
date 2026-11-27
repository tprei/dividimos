const ORIGIN_NEVER_REACHED = new Set([521, 522, 523]);
const RETRY_DELAYS_MS = [1_000, 3_000];

/**
 * Retries a request Cloudflare answered with 521, 522 or 523: it never reached
 * Supabase, so sending it again cannot repeat a write. Every other response,
 * 520 and 524 included, goes back to the caller untouched.
 */
export const edgeRetryFetch: typeof fetch = async (input, init) => {
  for (const delayMs of RETRY_DELAYS_MS) {
    const response = await fetch(input, init);
    if (!ORIGIN_NEVER_REACHED.has(response.status)) {
      return response;
    }
    await response.body?.cancel();
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, delayMs);
    await promise;
  }
  return fetch(input, init);
};
