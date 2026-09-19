// Tests for the Telegram sink: which Bot API methods a run issues, driven by
// the transition, by how many screenshots the run produced, and by whether the
// chat's pinned message is our own board.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { boardText, notify, parseBoardIds, parseBoardLayout } from "./telegram.mjs";

const env = { ALERT_TELEGRAM_BOT_TOKEN: "t", ALERT_TELEGRAM_CHAT_ID: "42" };
const now = new Date("2026-09-18T13:03:00Z");

function tempPngs(count) {
  const dir = mkdtempSync(join(tmpdir(), "ambient-telegram-test-"));
  const paths = [];
  for (let i = 0; i < count; i++) {
    const path = join(dir, `${i}.png`);
    writeFileSync(path, `png-${i}`);
    paths.push(path);
  }
  return { paths, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

// Records each call as { method, body }: parsed JSON for JSON calls, a plain
// object of field names for multipart, with blobs reduced to their size.
function fakeTelegram({ pinned, editError, sentIds = [901, 902, 903] } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const method = String(url).split("/").pop();
    let body;
    if (init.body instanceof FormData) {
      body = {};
      for (const [key, value] of init.body.entries()) {
        body[key] = value instanceof Blob ? { size: value.size } : value;
      }
    } else {
      body = JSON.parse(String(init.body));
    }
    calls.push({ method, body });
    if ((method === "editMessageMedia" || method === "editMessageText") && editError) {
      return new Response(JSON.stringify({ ok: false, description: editError }), { status: 400 });
    }
    let result = true;
    if (method === "getChat") result = { id: 42, pinned_message: pinned };
    else if (method === "sendMediaGroup") {
      const count = JSON.parse(String(body.media)).length;
      result = sentIds.slice(0, count).map((id) => ({ message_id: id }));
    } else if (method === "sendMessage" || method === "sendPhoto") {
      result = { message_id: sentIds[0] };
    }
    return new Response(JSON.stringify({ ok: true, result }));
  };
  return { calls, fetch };
}

function greenReport(paths, diary = ["Ana paid R$ 87,40 for \"Churrasco\", split 3 ways"]) {
  return {
    status: "green",
    transition: "green",
    failures: [],
    diary,
    screenshots: paths.map((path) => ({ path, failure: false })),
    video: null,
    runUrl: "https://ci/run/1",
  };
}

function layoutOf(report) {
  return [
    ...(report.video ? ["v"] : []),
    ...report.screenshots.filter((shot) => !shot.failure).map(() => "p"),
  ]
    .slice(0, 4)
    .join("");
}

function ourBoard(report, ids, layout = layoutOf(report)) {
  return {
    message_id: ids[0],
    caption: boardText(report, now, ids, layout),
    caption_entities: [
      { type: "text_link", url: `${report.runUrl}#board=${ids.join(",")}&media=${layout}` },
    ],
  };
}

test("parseBoardIds reads the ids the board hid in its run link", () => {
  assert.deepEqual(parseBoardIds("https://ci/run/1#board=7,8,9"), [7, 8, 9]);
  assert.deepEqual(parseBoardIds("https://ci/run/1"), []);
  assert.deepEqual(parseBoardIds(undefined), []);
});

test("the board caption stays inside Telegram's photo caption limit", () => {
  const verbose = {
    status: "green",
    transition: "green",
    failures: [],
    diary: Array.from({ length: 8 }, () => "x".repeat(120)),
    screenshots: [],
    runUrl: "https://github.com/tprei/dividimos/actions/runs/35340000000",
  };
  const caption = boardText(verbose, now, [901, 902, 903, 904]);
  assert.ok(caption.length <= 1024, `caption was ${caption.length} chars`);
  // Trimming drops whole facts from the end and keeps the footer intact.
  assert.match(caption, /🕒 Last check/);
  assert.match(caption, /#board=901,902,903,904/);
  assert.ok(caption.split("\n").filter((line) => line.startsWith("• ")).length < 8);
});

test("a green album run edits the pinned album in place, one edit per photo", async () => {
  const png = tempPngs(3);
  try {
    const report = greenReport(png.paths);
    const tg = fakeTelegram({ pinned: ourBoard(report, [11, 12, 13]) });
    await notify(report, { env, openIssue: null, fetch: tg.fetch, now });
    assert.deepEqual(
      tg.calls.map((c) => c.method),
      ["getChat", "editMessageMedia", "editMessageMedia", "editMessageMedia"],
    );
    const first = JSON.parse(String(tg.calls[1].body.media));
    assert.equal(first.media, "attach://board");
    assert.match(first.caption, /🟢 <b>Dividimos · production healthy<\/b>/);
    assert.match(first.caption, /Ana paid R\$ 87,40/);
    assert.match(first.caption, /#board=11,12,13/);
    // Only the first item carries a caption; Telegram rejects the rest.
    assert.equal(JSON.parse(String(tg.calls[2].body.media)).caption, undefined);
    assert.equal(tg.calls[3].body.message_id, "13");
  } finally {
    png.dispose();
  }
});

test("an unchanged photo keeps the board instead of reposting it", async () => {
  const png = tempPngs(3);
  try {
    const report = greenReport(png.paths);
    // Telegram rejects a re-upload of identical bytes, which is what the
    // siblings are whenever a screen did not change between runs.
    const tg = fakeTelegram({
      pinned: ourBoard(report, [11, 12, 13]),
      editError: "Bad Request: message is not modified: specified new message content is the same",
    });
    await notify(report, { env, openIssue: null, fetch: tg.fetch, now });
    assert.deepEqual(
      tg.calls.map((c) => c.method),
      ["getChat", "editMessageMedia", "editMessageMedia", "editMessageMedia"],
    );
  } finally {
    png.dispose();
  }
});

test("a different screenshot count replaces the album, pins it and deletes the old one", async () => {
  const png = tempPngs(2);
  try {
    const report = greenReport(png.paths);
    const tg = fakeTelegram({ pinned: ourBoard(report, [11, 12, 13]) });
    await notify(report, { env, openIssue: null, fetch: tg.fetch, now });
    assert.deepEqual(
      tg.calls.map((c) => c.method),
      [
        "getChat",
        "sendMediaGroup",
        "editMessageCaption",
        "pinChatMessage",
        // One board per chat: the replaced messages go away.
        "deleteMessage",
        "deleteMessage",
        "deleteMessage",
      ],
    );
    assert.equal(tg.calls[1].body.disable_notification, "true");
    assert.match(tg.calls[2].body.caption, /#board=901,902/);
    assert.equal(tg.calls[3].body.message_id, 901);
    assert.deepEqual(
      tg.calls.slice(4).map((c) => c.body.message_id),
      [11, 12, 13],
    );
  } finally {
    png.dispose();
  }
});

test("a single screenshot uses the photo path", async () => {
  const png = tempPngs(1);
  try {
    const report = greenReport(png.paths);
    const tg = fakeTelegram({ pinned: undefined });
    await notify(report, { env, openIssue: null, fetch: tg.fetch, now });
    assert.deepEqual(
      tg.calls.map((c) => c.method),
      ["getChat", "sendPhoto", "editMessageCaption", "pinChatMessage"],
    );
    const edited = fakeTelegram({ pinned: ourBoard(report, [901]) });
    await notify(report, { env, openIssue: null, fetch: edited.fetch, now });
    assert.deepEqual(
      edited.calls.map((c) => c.method),
      ["getChat", "editMessageMedia"],
    );
  } finally {
    png.dispose();
  }
});

test("without screenshots the board stays a text message", async () => {
  const report = greenReport([]);
  const tg = fakeTelegram({ pinned: ourBoard(report, [11]) });
  await notify(report, { env, openIssue: null, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["getChat", "editMessageText"],
  );
  assert.match(tg.calls[1].body.text, /🟢 <b>Dividimos · production healthy<\/b>/);
});

test("a board that can no longer be edited is replaced, re-pinned and removed", async () => {
  const report = greenReport([]);
  const tg = fakeTelegram({
    pinned: ourBoard(report, [11]),
    editError: "message can't be edited",
  });
  await notify(report, { env, openIssue: null, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    [
      "getChat",
      "editMessageText",
      "sendMessage",
      "editMessageText",
      "pinChatMessage",
      "deleteMessage",
    ],
  );
  assert.equal(tg.calls[5].body.message_id, 11);
});

test("the run recording leads the board and is edited in place", async () => {
  const png = tempPngs(3);
  try {
    const video = join(png.paths[0], "..", "run.mp4");
    writeFileSync(video, "mp4-bytes");
    const report = { ...greenReport(png.paths.slice(0, 2)), video };
    const fresh = fakeTelegram({ pinned: undefined });
    await notify(report, { env, openIssue: null, fetch: fresh.fetch, now });

    const sentMedia = JSON.parse(String(fresh.calls[1].body.media));
    assert.deepEqual(
      sentMedia.map((item) => item.type),
      ["video", "photo", "photo"],
    );
    assert.match(fresh.calls[2].body.caption, /#board=901,902,903&media=vpp/);

    const again = fakeTelegram({ pinned: ourBoard(report, [901, 902, 903]) });
    await notify(report, { env, openIssue: null, fetch: again.fetch, now });
    assert.deepEqual(
      again.calls.map((c) => c.method),
      ["getChat", "editMessageMedia", "editMessageMedia", "editMessageMedia"],
    );
    assert.equal(JSON.parse(String(again.calls[1].body.media)).type, "video");
    assert.equal(JSON.parse(String(again.calls[3].body.media)).type, "photo");
  } finally {
    png.dispose();
  }
});

test("a board whose media order changed is replaced instead of edited", async () => {
  const png = tempPngs(3);
  try {
    const video = join(png.paths[0], "..", "run.mp4");
    writeFileSync(video, "mp4-bytes");
    const withVideo = { ...greenReport(png.paths.slice(0, 2)), video };
    // The pinned board is three photos from a run that recorded nothing;
    // editing a photo slot into a video slot is rejected by Telegram.
    const pinned = ourBoard(greenReport(png.paths), [11, 12, 13], "ppp");
    const tg = fakeTelegram({ pinned });
    await notify(withVideo, { env, openIssue: null, fetch: tg.fetch, now });
    assert.deepEqual(
      tg.calls.map((c) => c.method),
      [
        "getChat",
        "sendMediaGroup",
        "editMessageCaption",
        "pinChatMessage",
        "deleteMessage",
        "deleteMessage",
        "deleteMessage",
      ],
    );
  } finally {
    png.dispose();
  }
});

test("parseBoardLayout reads the media order the board hid in its run link", () => {
  assert.equal(parseBoardLayout("https://ci/run/1#board=7,8&media=vp"), "vp");
  assert.equal(parseBoardLayout("https://ci/run/1#board=7,8"), "");
  assert.equal(parseBoardLayout(undefined), "");
});

test("going red with failure screenshots sends an album alert, then reddens the board", async () => {
  const png = tempPngs(2);
  try {
    const report = {
      status: "red",
      transition: "went_red",
      failures: [
        {
          name: "web smoke > badge",
          message: "expect(locator).toBeVisible() failed\nLocator: getByRole('img')",
        },
      ],
      diary: ["Ana paid R$ 10,00"],
      screenshots: png.paths.map((path) => ({ path, failure: true })),
      runUrl: "https://ci/run/2",
    };
    const tg = fakeTelegram({ pinned: undefined });
    await notify(report, { env, openIssue: { number: 1 }, fetch: tg.fetch, now });
    assert.deepEqual(
      tg.calls.map((c) => c.method),
      ["sendMediaGroup", "getChat", "sendMessage", "editMessageText", "pinChatMessage"],
    );
    const media = JSON.parse(String(tg.calls[0].body.media));
    assert.equal(media.length, 2);
    assert.match(media[0].caption, /🚨 <b>Production started failing<\/b>/);
    assert.match(media[0].caption, /<b>web smoke &gt; badge<\/b>/);
    // The alert says what broke in words, then the original line underneath.
    assert.match(media[0].caption, /a screen never showed what the walk waited for/);
    assert.match(media[0].caption, /<code>expect\(locator\)\.toBeVisible\(\) failed<\/code>/);
    assert.equal(media[1].caption, undefined);
    assert.equal(tg.calls[0].body.disable_notification, undefined);
    assert.match(tg.calls[3].body.text, /🔴 <b>Dividimos · production failing<\/b>/);
  } finally {
    png.dispose();
  }
});

test("going red without screenshots attaches the failure log instead", async () => {
  const report = {
    status: "red",
    transition: "went_red",
    failures: [{ name: "probes > bootstrap", message: "rpc failed" }],
    diary: [],
    screenshots: [],
    runUrl: "https://ci/run/3",
  };
  const tg = fakeTelegram({ pinned: undefined });
  await notify(report, { env, openIssue: { number: 1 }, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["sendMessage", "sendDocument", "getChat", "sendMessage", "editMessageText", "pinChatMessage"],
  );
  assert.equal(tg.calls[1].body.caption, "Failure log");
  assert.ok(tg.calls[1].body.document.size > 0);
});

test("staying red only refreshes the board", async () => {
  const report = {
    status: "red",
    transition: "still_red",
    failures: [{ name: "x", message: "y" }],
    diary: [],
    screenshots: [],
    runUrl: "https://ci/run/4",
  };
  const tg = fakeTelegram({ pinned: ourBoard(report, [11]) });
  await notify(report, { env, openIssue: { number: 1 }, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["getChat", "editMessageText"],
  );
});

test("recovering announces it before the board turns green", async () => {
  const report = { ...greenReport([]), transition: "recovered" };
  const tg = fakeTelegram({ pinned: ourBoard(report, [11]) });
  await notify(report, { env, openIssue: { number: 1 }, fetch: tg.fetch, now });
  assert.deepEqual(
    tg.calls.map((c) => c.method),
    ["sendMessage", "getChat", "editMessageText"],
  );
  assert.match(tg.calls[0].body.text, /🎉 <b>Production recovered<\/b>/);
});
