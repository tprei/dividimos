import { describe, expect, it } from "vitest";
import { mapOwnerProfileRow } from "./owner-profile";

/** A fresh, fully valid RPC row that every test can override per-field. */
function validRow(): Record<string, unknown> {
  return {
    id: "user-123",
    email: "alice@example.com",
    handle: "alice",
    name: "Alice Silva",
    avatar_url: "https://cdn.example.com/a.png",
    onboarded: true,
    created_at: "2025-01-02T03:04:05Z",
    notification_preferences: { expenses: true, nudges: false },
    pix_key_type: "cpf",
    pix_key_hint: "***.123.456-**",
  };
}

describe("mapOwnerProfileRow", () => {
  it("maps a complete valid row to a User", () => {
    expect(mapOwnerProfileRow(validRow())).toEqual({
      id: "user-123",
      email: "alice@example.com",
      handle: "alice",
      name: "Alice Silva",
      pixKeyType: "cpf",
      pixKeyHint: "***.123.456-**",
      avatarUrl: "https://cdn.example.com/a.png",
      onboarded: true,
      createdAt: "2025-01-02T03:04:05Z",
      notificationPreferences: { expenses: true, nudges: false },
    });
  });

  it.each(["cpf", "email", "phone", "random"] as const)(
    "accepts pix_key_type %s and maps it to pixKeyType",
    (pixKeyType) => {
      const user = mapOwnerProfileRow({ ...validRow(), pix_key_type: pixKeyType });
      expect(user?.pixKeyType).toBe(pixKeyType);
    },
  );

  it.each(["expenses", "settlements", "nudges", "groups", "messages"] as const)(
    "accepts notification_preferences with the %s key set to a boolean",
    (key) => {
      const user = mapOwnerProfileRow({
        ...validRow(),
        notification_preferences: { [key]: true },
      });
      expect(user?.notificationPreferences).toEqual({ [key]: true });
    },
  );

  it("accepts all five notification categories at once", () => {
    const prefs = {
      expenses: true,
      settlements: false,
      nudges: true,
      groups: false,
      messages: true,
    };
    const user = mapOwnerProfileRow({
      ...validRow(),
      notification_preferences: prefs,
    });
    expect(user?.notificationPreferences).toEqual(prefs);
  });

  it("maps null email/handle to empty string and null avatar_url to undefined", () => {
    const user = mapOwnerProfileRow({
      ...validRow(),
      email: null,
      handle: null,
      avatar_url: null,
    });
    expect(user?.email).toBe("");
    expect(user?.handle).toBe("");
    expect(user?.avatarUrl).toBeUndefined();
  });

  it("accepts an empty notification_preferences object and yields {}", () => {
    const user = mapOwnerProfileRow({
      ...validRow(),
      notification_preferences: {},
    });
    expect(user?.notificationPreferences).toEqual({});
  });

  describe.each(
    ["id", "name", "pix_key_hint", "created_at", "onboarded", "pix_key_type"] as const,
  )("required field %s", (field) => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["wrong primitive", 12345],
    ])("rejects %s", (_label, value) => {
      expect(mapOwnerProfileRow({ ...validRow(), [field]: value })).toBeNull();
    });
  });

  describe.each(
    ["email", "handle", "avatar_url"] as const,
  )("nullable field %s", (field) => {
    it("rejects undefined", () => {
      expect(
        mapOwnerProfileRow({ ...validRow(), [field]: undefined }),
      ).toBeNull();
    });

    it("rejects a wrong primitive", () => {
      expect(mapOwnerProfileRow({ ...validRow(), [field]: 12345 })).toBeNull();
    });
  });

  it.each(["", "telefone", "PHONE", "cellphone", "cpf "])(
    "rejects invalid pix_key_type %p",
    (pixKeyType) => {
      expect(
        mapOwnerProfileRow({ ...validRow(), pix_key_type: pixKeyType }),
      ).toBeNull();
    },
  );

  it.each([
    ["null", null],
    ["an array", []],
    ["an array with entries", [{ expenses: true }]],
    ["an object with an unknown key", { foo: true }],
    ["an object with an unknown key alongside a valid one", { expenses: true, foo: false }],
    ["an object with a string value", { expenses: "yes" }],
    ["an object with a numeric value", { expenses: 1 }],
    ["an object with a null value", { expenses: null }],
    ["an object with an undefined value", { expenses: undefined }],
  ])("rejects notification_preferences that is %s", (_label, value) => {
    expect(
      mapOwnerProfileRow({ ...validRow(), notification_preferences: value }),
    ).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "x"],
    ["a number", 42],
    ["an array", []],
  ])("rejects a non-object row (%s)", (_label, value) => {
    expect(mapOwnerProfileRow(value)).toBeNull();
  });
});
