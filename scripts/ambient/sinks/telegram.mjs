/** @typedef {import("../report.mjs").AmbientReport} AmbientReport */
/** @typedef {import("../report.mjs").SinkContext} SinkContext */

import { readFileSync } from "node:fs";

// Two messages, two jobs. One pinned board shows the latest check and is
// edited in place every run, so a chat gets no new bubble per half hour.
// Flips also send their own alert, with screenshots when a browser was
// involved. The pin is the only persistence: the next run finds the board
// through getChat, and the album's message ids ride along in the caption's
// run link fragment, which Telegram keeps as a link entity and never renders.

const BOARD_MARK = "Dividimos · production";
const TIME_ZONE = "America/Sao_Paulo";
// One recording plus the four stills of the walk; Telegram allows ten.
const MAX_BOARD_MEDIA = 5;
const MAX_ALERT_PHOTOS = 10;
const API = "https://api.telegram.org";

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function isConfigured(env) {
  return Boolean(
    typeof env?.ALERT_TELEGRAM_BOT_TOKEN === "string" &&
      env.ALERT_TELEGRAM_BOT_TOKEN.trim().length > 0 &&
      typeof env?.ALERT_TELEGRAM_CHAT_ID === "string" &&
      env.ALERT_TELEGRAM_CHAT_ID.trim().length > 0,
  );
}

/** @param {string} text */
function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** @param {Date} now */
function formatCheckedAt(now) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

/**
 * @param {AmbientReport} report
 * @returns {string[]}
 */
function failureLines(report) {
  const shown = report.failures
    .slice(0, 5)
    .map((failure) => `• <code>${escapeHtml(failure.name)}</code>`);
  const rest = report.failures.length - shown.length;
  if (rest > 0) shown.push(`• and ${rest} more`);
  return shown;
}

/**
 * The run link carries the board's own message ids and media layout as a
 * fragment so the next run can edit the same album instead of posting a new
 * one. The layout is one letter per message ("v" video, "p" photo): editing
 * a photo into a video slot is rejected by Telegram, so a changed layout has
 * to replace the board rather than try.
 * @param {string} runUrl
 * @param {number[]} boardIds
 * @param {string} layout
 */
function runLink(runUrl, boardIds, layout = "") {
  const href =
    boardIds.length > 0 ? `${runUrl}#board=${boardIds.join(",")}&media=${layout}` : runUrl;
  return `<a href="${href}">view run</a>`;
}

/**
 * @param {string | undefined} url
 * @returns {number[]}
 */
export function parseBoardIds(url) {
  const match = /#board=([\d,]+)/.exec(url ?? "");
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * @param {string | undefined} url
 * @returns {string}
 */
export function parseBoardLayout(url) {
  return /[#&]media=([vp]*)/.exec(url ?? "")?.[1] ?? "";
}

// A photo caption is capped at 1024 characters and Telegram rejects the whole
// call when it overflows, so the fact list is trimmed to what is left after
// the header and footer rather than trusted to fit.
const CAPTION_LIMIT = 1024;

/**
 * @param {AmbientReport} report
 * @param {Date} now
 * @param {number[]} [boardIds]
 * @param {string} [layout]
 * @returns {string}
 */
export function boardText(report, now, boardIds = [], layout = "") {
  const green = report.status === "green";
  const head = `${green ? "🟢" : "🔴"} <b>${BOARD_MARK} ${green ? "healthy" : "failing"}</b>`;
  const foot = [
    `🕒 Last check <b>${formatCheckedAt(now)}</b> (BRT)`,
    `🔁 Every 30 min · ${runLink(report.runUrl, boardIds, layout)}`,
  ];
  const body = green
    ? report.diary.map((fact) => `• ${escapeHtml(fact)}`)
    : [
        `❌ ${report.failures.length} failure${report.failures.length === 1 ? "" : "s"}`,
        ...failureLines(report),
      ];
  const compose = (lines) => [head, "", ...lines, "", ...foot].join("\n");
  let kept = body;
  while (kept.length > 0 && compose(kept).length > CAPTION_LIMIT) {
    kept = kept.slice(0, -1);
  }
  return compose(kept);
}

/**
 * @param {AmbientReport} report
 * @returns {string}
 */
export function alertText(report) {
  if (report.transition === "went_red") {
    return [
      "🚨 <b>Production started failing</b>",
      "",
      ...failureLines(report),
      "",
      runLink(report.runUrl, []),
    ].join("\n");
  }
  return ["🎉 <b>Production recovered</b>", "", runLink(report.runUrl, [])].join("\n");
}

/** @param {string} path */
function photoBlob(path) {
  return new Blob([readFileSync(path)], { type: "image/png" });
}

/** @param {{ kind: "video" | "photo", path: string }} item */
function mediaBlob(item) {
  return new Blob([readFileSync(item.path)], {
    type: item.kind === "video" ? "video/mp4" : "image/png",
  });
}

/**
 * @param {AmbientReport} report
 * @returns {string}
 */
function failureLog(report) {
  return report.failures.map((failure) => `${failure.name}\n${failure.message}`).join("\n\n");
}

/**
 * @param {AmbientReport} report
 * @param {SinkContext} ctx
 * @returns {Promise<void>}
 */
export async function notify(report, ctx) {
  const fetchImpl = ctx.fetch ?? globalThis.fetch;
  const token = ctx.env.ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = ctx.env.ALERT_TELEGRAM_CHAT_ID;

  /**
   * @param {string} method
   * @param {Record<string, unknown> | FormData} body
   * @returns {Promise<any>}
   */
  const call = async (method, body) => {
    const multipart = body instanceof FormData;
    if (multipart) body.set("chat_id", chatId);
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: "POST",
      ...(multipart
        ? { body }
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, ...body }),
          }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) {
      throw new Error(`telegram ${method}: ${res.status} ${payload.description ?? ""}`.trim());
    }
    return payload.result;
  };

  const html = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };

  // The recording of the phone walk leads the board, then the stills. The
  // layout travels with the ids so the next run knows whether it can edit.
  /** @type {{ kind: "video" | "photo", path: string }[]} */
  const boardMedia = [
    ...(report.video ? [{ kind: /** @type {const} */ ("video"), path: report.video }] : []),
    ...report.screenshots
      .filter((shot) => !shot.failure)
      .map((shot) => ({ kind: /** @type {const} */ ("photo"), path: shot.path })),
  ].slice(0, MAX_BOARD_MEDIA);
  const boardLayout = boardMedia.map((item) => item.kind[0]).join("");

  if (report.transition === "went_red" || report.transition === "recovered") {
    await sendAlert();
  }
  await updateBoard();

  async function sendAlert() {
    const alertShots =
      report.transition === "went_red"
        ? [
            ...report.screenshots.filter((shot) => shot.failure),
            ...report.screenshots.filter((shot) => !shot.failure),
          ]
            .slice(0, MAX_ALERT_PHOTOS)
            .map((shot) => shot.path)
        : [];

    if (alertShots.length >= 2) {
      await call(
        "sendMediaGroup",
        mediaGroupForm(
          alertShots.map((path) => ({ kind: /** @type {const} */ ("photo"), path })),
          alertText(report),
        ),
      );
      return;
    }
    if (alertShots.length === 1) {
      const form = new FormData();
      form.set("photo", photoBlob(alertShots[0]), "failure.png");
      form.set("caption", alertText(report));
      form.set("parse_mode", "HTML");
      await call("sendPhoto", form);
      return;
    }

    await call("sendMessage", { text: alertText(report), ...html });
    if (report.transition === "went_red" && report.failures.length > 0) {
      const form = new FormData();
      form.set(
        "document",
        new Blob([failureLog(report)], { type: "text/plain" }),
        "ambient-failures.txt",
      );
      form.set("caption", "Failure log");
      await call("sendDocument", form);
    }
  }

  /**
   * @param {{ kind: "video" | "photo", path: string }[]} items
   * @param {string} caption
   */
  function mediaGroupForm(items, caption) {
    const form = new FormData();
    const media = items.map((item, index) => ({
      type: item.kind,
      media: `attach://f${index}`,
      ...(index === 0 ? { caption, parse_mode: "HTML" } : {}),
    }));
    form.set("media", JSON.stringify(media));
    items.forEach((item, index) => {
      form.set(`f${index}`, mediaBlob(item), `f${index}.${item.kind === "video" ? "mp4" : "png"}`);
    });
    return form;
  }

  async function updateBoard() {
    const chat = await call("getChat", {});
    const pinned = chat?.pinned_message;
    const pinnedText = pinned?.caption ?? pinned?.text ?? "";
    const isOurs = typeof pinned?.message_id === "number" && pinnedText.includes(BOARD_MARK);
    const entities = pinned?.caption_entities ?? pinned?.entities ?? [];
    const link = entities.find((entity) => entity.type === "text_link");
    const pinnedIds = isOurs ? parseBoardIds(link?.url) : [];
    const pinnedLayout = isOurs ? parseBoardLayout(link?.url) : "";

    if (isOurs && pinnedIds.length === Math.max(boardMedia.length, 1)) {
      // Same number of messages and the same photo/video order: the board can
      // be refreshed where it already sits.
      if (pinnedLayout === boardLayout) {
        try {
          await editBoard(pinnedIds);
          return;
        } catch (error) {
          // A board the bot can no longer edit is replaced, not left stale.
          console.error(error);
        }
      }
    }
    await postBoard();
    // One board per chat: the copy this run replaced is removed instead of
    // left scrolling by as another unread bubble.
    for (const id of pinnedIds) {
      try {
        await call("deleteMessage", { message_id: id });
      } catch (error) {
        // Messages older than Telegram's delete window simply stay.
        console.error(error);
      }
    }
  }

  /**
   * Telegram answers "message is not modified" when a photo the run
   * re-uploaded is byte-identical to the one already there, which happens
   * whenever a screen did not change. The board is then already correct, so
   * that answer counts as done rather than as a reason to replace it.
   * @param {unknown} error
   */
  function isUnchanged(error) {
    return error instanceof Error && error.message.includes("message is not modified");
  }

  /** @param {number[]} ids */
  async function editBoard(ids) {
    const caption = boardText(report, ctx.now ?? new Date(), ids, boardLayout);
    if (boardMedia.length === 0) {
      try {
        await call("editMessageText", { message_id: ids[0], text: caption, ...html });
      } catch (error) {
        if (!isUnchanged(error)) throw error;
      }
      return;
    }
    for (const [index, id] of ids.entries()) {
      const item = boardMedia[index];
      const form = new FormData();
      form.set("message_id", String(id));
      form.set(
        "media",
        JSON.stringify({
          type: item.kind,
          media: "attach://board",
          ...(index === 0 ? { caption, parse_mode: "HTML" } : {}),
        }),
      );
      form.set("board", mediaBlob(item), `board.${item.kind === "video" ? "mp4" : "png"}`);
      try {
        await call("editMessageMedia", form);
      } catch (error) {
        // An unchanged sibling shot is fine; only the captioned first
        // message failing means the board did not refresh.
        if (!isUnchanged(error)) throw error;
      }
    }
  }

  async function postBoard() {
    // The ids are only known after sending, and the caption has to carry
    // them, so the board is sent once and then captioned with its own ids.
    // That second call is best-effort: a board without ids is still correct,
    // it just gets replaced instead of edited on the next run.
    const now = ctx.now ?? new Date();
    if (boardMedia.length === 0) {
      const sent = await call("sendMessage", {
        text: boardText(report, now, []),
        disable_notification: true,
        ...html,
      });
      await stamp(() =>
        call("editMessageText", {
          message_id: sent.message_id,
          text: boardText(report, now, [sent.message_id], boardLayout),
          ...html,
        }),
      );
      await pin(sent.message_id);
      return;
    }
    if (boardMedia.length === 1) {
      const [item] = boardMedia;
      const form = new FormData();
      const method = item.kind === "video" ? "sendVideo" : "sendPhoto";
      form.set(
        item.kind === "video" ? "video" : "photo",
        mediaBlob(item),
        `board.${item.kind === "video" ? "mp4" : "png"}`,
      );
      form.set("caption", boardText(report, now, []));
      form.set("parse_mode", "HTML");
      form.set("disable_notification", "true");
      const sent = await call(method, form);
      await stamp(() =>
        call("editMessageCaption", {
          message_id: sent.message_id,
          caption: boardText(report, now, [sent.message_id], boardLayout),
          parse_mode: "HTML",
        }),
      );
      await pin(sent.message_id);
      return;
    }
    const form = mediaGroupForm(boardMedia, boardText(report, now, []));
    form.set("disable_notification", "true");
    const sent = await call("sendMediaGroup", form);
    const ids = sent.map((message) => message.message_id);
    await stamp(() =>
      call("editMessageCaption", {
        message_id: ids[0],
        caption: boardText(report, now, ids, boardLayout),
        parse_mode: "HTML",
      }),
    );
    await pin(ids[0]);
  }

  /** @param {() => Promise<unknown>} write */
  async function stamp(write) {
    try {
      await write();
    } catch (error) {
      console.error(error);
    }
  }

  /** @param {number} messageId */
  async function pin(messageId) {
    try {
      await call("pinChatMessage", { message_id: messageId, disable_notification: true });
    } catch (error) {
      // Without pin rights the board still posts; it just cannot be found next run.
      console.error(error);
    }
  }
}
