// Tests for the Telegram sink: which Bot API methods a run issues, driven by
// the transition and by whether the chat's pinned message is our board.

import assert from "node:assert/strict";
import { test } from "node:test";

import { boardText, notify } from "./telegram.mjs";

const env = { ALERT_TELEGRAM_BOT_TOKEN: "t", ALERT_TELEGRAM_CHAT_ID: "42" };
const now = new Date("2026-09-18T13:03:00Z");

/**
 * @param {{ pinned?: unknown, failEdit?: boolean }} options
 */
function fakeTelegram({ pinned, failEdit = false } = {}) {
  /** @type {{ method: string, body: Record<string, unknown> }[]} */
  const calls = [];
  const fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(String(init.body));
    calls.push({ method, body });
    if (method === "editMessageText" && failEdit) {
      return new Response(JSON.stringify({ ok: false, description: "message can't be edited" }), {
        status: 400,
      });
    }
    const result =
      method === "getChat"
        ? { id: 42, pinned_message: pinned }
        : method === "sendMessage"
          ? { message_id: 900 }
          : true;
    return new Response(JSON.stringify({ ok: true, result }));
  };
  return { calls, fetch };
}

const green = { status: "green", transition: "green", failures: [], runUrl: "https://ci/run/1" };
const ourBoard = { message_id: 7, text: boardText(green, now) };

test("a green run after a green run edits the pinned board and sends nothing else", async () => {
  const tg = fakeTelegram({ pinned: ourBoard });
  await notify(green, { env, openIssue: null, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["getChat", "editMessageText"],
  );
  assert.equal(tg.calls[1].body.message_id, 7);
  assert.equal(tg.calls[1].body.parse_mode, "HTML");
  assert.match(tg.calls[1].body.text, /🟢 <b>Dividimos · produção saudável<\/b>/);
  assert.match(tg.calls[1].body.text, /10:03/);
});

test("without our board pinned the run posts a silent board and pins it", async () => {
  const tg = fakeTelegram({ pinned: { message_id: 3, text: "someone else's pin" } });
  await notify(green, { env, openIssue: null, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["getChat", "sendMessage", "pinChatMessage"],
  );
  assert.equal(tg.calls[1].body.disable_notification, true);
  assert.equal(tg.calls[2].body.message_id, 900);
});

test("going red sends a loud alert and turns the board red", async () => {
  const report = {
    status: "red",
    transition: "went_red",
    failures: [{ name: "probes > bootstrap", message: "boom" }],
    runUrl: "https://ci/run/2",
  };
  const tg = fakeTelegram({ pinned: ourBoard });
  await notify(report, { env, openIssue: { number: 1 }, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["sendMessage", "getChat", "editMessageText"],
  );
  assert.match(tg.calls[0].body.text, /🚨 <b>Produção começou a falhar<\/b>/);
  assert.match(tg.calls[0].body.text, /<code>probes &gt; bootstrap<\/code>/);
  assert.equal(tg.calls[0].body.disable_notification, undefined);
  assert.match(tg.calls[2].body.text, /🔴 <b>Dividimos · produção com falha<\/b>/);
});

test("staying red only refreshes the board", async () => {
  const report = { ...green, status: "red", transition: "still_red", failures: [{ name: "x", message: "" }] };
  const tg = fakeTelegram({ pinned: ourBoard });
  await notify(report, { env, openIssue: { number: 1 }, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["getChat", "editMessageText"],
  );
});

test("a board that can no longer be edited is replaced and re-pinned", async () => {
  const tg = fakeTelegram({ pinned: ourBoard, failEdit: true });
  await notify(green, { env, openIssue: null, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["getChat", "editMessageText", "sendMessage", "pinChatMessage"],
  );
});
