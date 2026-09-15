/**
 * Dispatch-claim boundary for POST /api/notify.
 *
 * The route runs against the real database and the real Supabase session
 * reader: the actor signs in for real, the group event is produced by the
 * real create_expense RPC, and the claim is the route's real conditional
 * update on group_events.notified_at. Only the outbound push transport is
 * stubbed (notifyUser) — the route requires a deliverable recipient, but a
 * test must not send actual web pushes.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isIntegrationTestReady, adminClient } from "@/test/integration-setup";
import {
  createExpense,
  createGroupWithMembers,
  createTestUsers,
  equalSplitPayload,
  type TestUser,
} from "@/test/integration-helpers";

vi.mock("server-only", () => ({}));

const notifyUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/push/notify-user", () => ({
  notifyUser: (userId: string, payload: unknown) => notifyUserMock(userId, payload),
}));

const cookieJar: Array<{ name: string; value: string }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...cookieJar],
    set: () => {
      // Writes back into a request-scoped cookie store carry no session
      // change these assertions depend on.
    },
  }),
}));

// Imported after the vi.mock factories and the cookieJar declaration: the
// factories close over module state, so the route module must only evaluate
// once that state exists (a static import would resolve them against
// uninitialized bindings).
const { POST } = await import("@/app/api/notify/route");

const AUTH_COOKIE_NAME = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;

/** exp claim of the real access token — the session's true expiry second. */
function accessTokenExpiry(accessToken: string): number {
  const payloadSegment = accessToken.split(".")[1];
  const payload = JSON.parse(
    Buffer.from(payloadSegment, "base64url").toString("utf8"),
  ) as { exp?: unknown };
  if (typeof payload.exp !== "number") {
    throw new Error("access token carries no exp claim");
  }
  return payload.exp;
}

function actAs(user: TestUser): void {
  if (!user.accessToken || !user.refreshToken) {
    throw new Error(`user ${user.handle} has no sign-in tokens`);
  }
  const session = {
    access_token: user.accessToken,
    refresh_token: user.refreshToken,
    token_type: "bearer",
    expires_at: accessTokenExpiry(user.accessToken),
  };
  cookieJar.splice(0, cookieJar.length, {
    name: AUTH_COOKIE_NAME,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
  });
}

function notifyRequest(eventId: number): Request {
  return new Request("http://localhost/api/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId }),
  });
}

async function claimState(eventId: number): Promise<string | null> {
  const { data, error } = await adminClient!
    .from("group_events")
    .select("notified_at")
    .eq("id", eventId)
    .single();
  if (error) throw new Error(`claim read failed: ${error.message}`);
  return data.notified_at;
}

describe.skipIf(!isIntegrationTestReady)("notify dispatch claim boundary", () => {
  let actor: TestUser;
  let member: TestUser;
  let claimedEventId: number;

  beforeAll(async () => {
    [actor, member] = await createTestUsers(2);
    const groupId = await createGroupWithMembers(actor, [member]);
    const { eventId } = await createExpense(actor, {
      groupId,
      totalCents: 5000,
      payload: equalSplitPayload([actor.id, member.id], 5000),
    });
    claimedEventId = eventId;
    expect(await claimState(eventId)).toBeNull();
    actAs(actor);
  });

  beforeEach(() => {
    notifyUserMock.mockReset();
    notifyUserMock.mockResolvedValue({ sent: 0, cleaned: 0, failed: 0 });
  });

  it("lets exactly one of two concurrent requests claim the dispatch", async () => {
    notifyUserMock.mockResolvedValue({ sent: 1, cleaned: 0, failed: 0 });

    const [first, second] = await Promise.all([
      POST(notifyRequest(claimedEventId)),
      POST(notifyRequest(claimedEventId)),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 204]);

    const winner = first.status === 200 ? first : second;
    const body = (await winner.json()) as { recipients: number; sent: number };
    expect(body.recipients).toBe(1); // the other member, never the actor
    expect(body.sent).toBe(1);
    expect(notifyUserMock).toHaveBeenCalledTimes(1);
    expect(notifyUserMock).toHaveBeenCalledWith(member.id, expect.anything());

    // Single state transition: the claim is held after exactly one dispatch.
    expect(await claimState(claimedEventId)).not.toBeNull();
  });

  it("releases the claim when delivery fails, so a retry can claim again", async () => {
    const groupId = await createGroupWithMembers(actor, [member]);
    const { eventId } = await createExpense(actor, {
      groupId,
      totalCents: 5000,
      payload: equalSplitPayload([actor.id, member.id], 5000),
    });
    expect(await claimState(eventId)).toBeNull();

    notifyUserMock.mockResolvedValue({ sent: 0, cleaned: 0, failed: 2 });

    const failed = await POST(notifyRequest(eventId));
    expect(failed.status).toBe(200);
    expect(await failed.json()).toEqual({
      sent: 0,
      cleaned: 0,
      failed: 2,
      recipients: 1,
      skipped: 0,
    });
    // The failed delivery must not wedge the event: the claim is released.
    expect(await claimState(eventId)).toBeNull();

    notifyUserMock.mockResolvedValue({ sent: 1, cleaned: 0, failed: 0 });
    const retried = await POST(notifyRequest(eventId));
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(await claimState(eventId)).not.toBeNull();
  });
});
