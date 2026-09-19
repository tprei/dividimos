import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

vi.mock("@/lib/financial-compatibility", () => ({ evaluateServerFinancialGate: mocks.gate }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));
vi.mock("./room-page-client", () => ({
  RoomPageClient: ({ roomId }: { roomId: string }) => <div data-room-id={roomId} />,
}));

import AssignmentRoomPage from "./page";

const ROOM_ID = "00000000-0000-4000-8000-0000000000AA";

beforeEach(() => {
  mocks.gate.mockReset();
  mocks.gate.mockReturnValue({ compatible: true });
  mocks.notFound.mockClear();
  mocks.redirect.mockClear();
});

describe("/room/[roomId]", () => {
  it("renders a normalized valid room id without loading financial contents on the server", async () => {
    const element = await AssignmentRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-room-id="00000000-0000-4000-8000-0000000000aa"');
    expect(mocks.gate).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed room ids before evaluating the financial gate", async () => {
    await expect(
      AssignmentRoomPage({ params: Promise.resolve({ roomId: "not-a-room" }) }),
    ).rejects.toThrow("NOT_FOUND");

    expect(mocks.gate).not.toHaveBeenCalled();
  });

  it("redirects every visitor when the financial compatibility gate is closed", async () => {
    mocks.gate.mockReturnValue({ compatible: false, issue: { code: "schema_outdated" } });

    await expect(
      AssignmentRoomPage({ params: Promise.resolve({ roomId: ROOM_ID }) }),
    ).rejects.toThrow("REDIRECT:/manutencao?reason=schema_outdated");
  });
});
