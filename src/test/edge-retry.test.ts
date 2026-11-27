import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { edgeRetryFetch } from "../../ambient/edge-retry";

function replies(...statuses: number[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const status of statuses) {
    fetchMock.mockResolvedValueOnce(new Response("body", { status }));
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function settle(promise: Promise<Response>): Promise<Response> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("edgeRetryFetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends a request again after Cloudflare could not reach Supabase", async () => {
    const fetchMock = replies(522, 521, 200);

    const response = await settle(edgeRetryFetch("https://x.supabase.co/rest/v1/rpc/a", { method: "POST", body: "{}" }));

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]).toEqual(["https://x.supabase.co/rest/v1/rpc/a", { method: "POST", body: "{}" }]);
  });

  it("gives up after three attempts and returns the last answer", async () => {
    const fetchMock = replies(522, 522, 523);

    const response = await settle(edgeRetryFetch("https://x.supabase.co/rest/v1/rpc/a"));

    expect(response.status).toBe(523);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("never resends a request Supabase may have run", async () => {
    for (const status of [500, 502, 503, 520, 524]) {
      const fetchMock = replies(status);

      const response = await settle(edgeRetryFetch("https://x.supabase.co/rest/v1/rpc/a"));

      expect(response.status).toBe(status);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});
