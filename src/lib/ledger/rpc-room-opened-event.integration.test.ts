import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isIntegrationTestReady } from "@/test/integration-setup";
import {
  authenticateAs,
  createGroupWithMembers,
  createTestUsers,
  withPg,
  type TestUser,
} from "@/test/integration-helpers";

type Client = SupabaseClient<Database>;

async function rpc<T>(
  client: Client,
  name: keyof Database["public"]["Functions"],
  args: Record<string, unknown>
): Promise<T> {
  const { data, error } = await client.rpc(name, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

describe.skipIf(!isIntegrationTestReady)(
  "assignment_room_opened event visibility",
  () => {
    let host: TestUser;
    let member: TestUser;
    let memberClient: Client;
    let groupId: string;

    beforeAll(async () => {
      [host, member] = await createTestUsers(2);
      memberClient = authenticateAs(member);
      groupId = await createGroupWithMembers(host, [member], "Grupo eventos");
    });

    async function insertRoomOpenedEvent(): Promise<void> {
      await withPg((client) =>
        client.query(
          "insert into public.group_events (group_id, actor_id, kind, payload) " +
            "values ($1, $2, 'assignment_room_opened', $3::jsonb)",
          [
            groupId,
            host.id,
            JSON.stringify({
              roomId: crypto.randomUUID(),
              title: "Conta do grupo",
              totalCents: 4500,
            }),
          ],
        )
      );
    }

    it("hides the opened event from feeds while ordinary events still appear", async () => {
      await insertRoomOpenedEvent();

      const activity = await rpc<Array<{ kind: string }>>(memberClient, "get_activity", {
        p_before_id: null,
        p_limit: 200,
      });
      expect(activity.some((event) => event.kind === "assignment_room_opened")).toBe(false);
      expect(activity.some((event) => event.kind === "member_invited")).toBe(true);

      const conversation = await rpc<{ events: Array<{ kind: string }> }>(
        memberClient,
        "get_conversation",
        { p_group_id: groupId }
      );
      expect(
        conversation.events.some((event) => event.kind === "assignment_room_opened")
      ).toBe(false);
      expect(conversation.events.some((event) => event.kind === "member_invited")).toBe(true);
    });

    it("advances lastEventId without moving lastActivityAt", async () => {
      interface SnapshotRead {
        snapshot: { lastEventId: number; lastActivityAt: string | null };
      }
      const before = await rpc<SnapshotRead>(memberClient, "get_group_overview", {
        p_group_id: groupId,
      });

      await insertRoomOpenedEvent();

      const after = await rpc<SnapshotRead>(memberClient, "get_group_overview", {
        p_group_id: groupId,
      });
      expect(after.snapshot.lastEventId).toBeGreaterThan(before.snapshot.lastEventId);
      expect(after.snapshot.lastActivityAt).toBe(before.snapshot.lastActivityAt);
    });
  }
);
