import { describe, expect, it, beforeEach } from "vitest";
import {
  clearHeldNotificationDestination,
  holdNotificationDestination,
  notificationTapHref,
  resolveNotificationDestination,
  takeHeldNotificationDestination,
} from "./notification-destination";

const BILL_ID = "123e4567-e89b-12d3-a456-426614174000";
const GROUP_ID = "223e4567-e89b-42d3-a456-426614174001";
const ACTOR_ID = "323e4567-e89b-42d3-a456-426614174002";

describe("resolveNotificationDestination", () => {
  it("accepts exactly the routes event-notification produces", () => {
    expect(resolveNotificationDestination("/app")).toBe("/app");
    expect(resolveNotificationDestination(`/app/bill/${BILL_ID}`)).toBe(
      `/app/bill/${BILL_ID}`,
    );
    expect(
      resolveNotificationDestination(`/app/conversations/${ACTOR_ID}`),
    ).toBe(`/app/conversations/${ACTOR_ID}`);
    expect(resolveNotificationDestination(`/app/groups/${GROUP_ID}`)).toBe(
      `/app/groups/${GROUP_ID}`,
    );
  });

  it("rejects malformed and lookalike destinations", () => {
    expect(resolveNotificationDestination("/app/bill/x/../../")).toBeNull();
    expect(resolveNotificationDestination("//evil")).toBeNull();
    expect(resolveNotificationDestination(`/app/groups/${GROUP_ID}?x`)).toBeNull();
    expect(resolveNotificationDestination("https://evil/app")).toBeNull();
    expect(resolveNotificationDestination(`/app/bill/${BILL_ID}/more`)).toBeNull();
    expect(resolveNotificationDestination("/app/")).toBeNull();
    expect(resolveNotificationDestination("/app/bill/")).toBeNull();
    expect(resolveNotificationDestination("/app/bill/not-a-uuid")).toBeNull();
    expect(resolveNotificationDestination(`/APP/groups/${GROUP_ID}`)).toBeNull();
    expect(
      resolveNotificationDestination("/app/bill/123E4567-E89B-12D3-A456-426614174000"),
    ).toBeNull();
    expect(resolveNotificationDestination("/app\\bill")).toBeNull();
    expect(resolveNotificationDestination("/app/%2e%2e/app")).toBeNull();
    expect(resolveNotificationDestination(`/app/bill/${BILL_ID}#f`)).toBeNull();
    expect(resolveNotificationDestination("/auth?next=/app")).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    expect(resolveNotificationDestination(null)).toBeNull();
    expect(resolveNotificationDestination(undefined)).toBeNull();
    expect(resolveNotificationDestination(42)).toBeNull();
    expect(resolveNotificationDestination({ url: "/app" })).toBeNull();
  });
});

describe("notification tap queue", () => {
  beforeEach(() => {
    clearHeldNotificationDestination();
  });

  it("holds a valid tap and pops it once", () => {
    expect(holdNotificationDestination(`/app/bill/${BILL_ID}`)).toBe(true);
    expect(takeHeldNotificationDestination()).toBe(`/app/bill/${BILL_ID}`);
    expect(takeHeldNotificationDestination()).toBeNull();
  });

  it("keeps only the newest tap", () => {
    holdNotificationDestination(`/app/bill/${BILL_ID}`);
    holdNotificationDestination(`/app/groups/${GROUP_ID}`);
    expect(takeHeldNotificationDestination()).toBe(`/app/groups/${GROUP_ID}`);
    expect(takeHeldNotificationDestination()).toBeNull();
  });

  it("collapses duplicate identical taps into one", () => {
    holdNotificationDestination(`/app/groups/${GROUP_ID}`);
    holdNotificationDestination(`/app/groups/${GROUP_ID}`);
    expect(takeHeldNotificationDestination()).toBe(`/app/groups/${GROUP_ID}`);
    expect(takeHeldNotificationDestination()).toBeNull();
  });

  it("ignores invalid destinations", () => {
    expect(holdNotificationDestination("https://evil/app")).toBe(false);
    expect(holdNotificationDestination(undefined)).toBe(false);
    expect(takeHeldNotificationDestination()).toBeNull();
  });
});

describe("notificationTapHref", () => {
  it("goes straight to the destination when signed in", () => {
    expect(notificationTapHref(`/app/bill/${BILL_ID}`, true)).toBe(
      `/app/bill/${BILL_ID}`,
    );
  });

  it("routes through the login screen with next when signed out", () => {
    expect(notificationTapHref("/app", false)).toBe(
      `/auth?next=${encodeURIComponent("/app")}`,
    );
    expect(notificationTapHref(`/app/conversations/${ACTOR_ID}`, false)).toBe(
      `/auth?next=${encodeURIComponent(`/app/conversations/${ACTOR_ID}`)}`,
    );
  });
});
