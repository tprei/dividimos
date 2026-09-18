/** @typedef {import("../report.mjs").AmbientReport} AmbientReport */
/** @typedef {import("../report.mjs").SinkContext} SinkContext */

// Two messages, two jobs. A pinned status board is edited in place on every
// run, so a chat always shows the latest check without a new bubble per
// half hour. A separate alert is sent only when the state flips. The pin is
// the only persistence: the next run finds the board through getChat.

const BOARD_MARK = "Dividimos · production";
const TIME_ZONE = "America/Sao_Paulo";

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
  const shown = report.failures.slice(0, 5).map((failure) => `• <code>${escapeHtml(failure.name)}</code>`);
  const rest = report.failures.length - shown.length;
  if (rest > 0) shown.push(`• and ${rest} more`);
  return shown;
}

/**
 * @param {AmbientReport} report
 * @param {Date} now
 * @returns {string}
 */
export function boardText(report, now) {
  const green = report.status === "green";
  const lines = [
    `${green ? "🟢" : "🔴"} <b>${BOARD_MARK} ${green ? "healthy" : "failing"}</b>`,
    "",
    ...(green
      ? ["✅ Probes and troupe ok", "✅ Web smoke ok"]
      : [`❌ ${report.failures.length} failure${report.failures.length === 1 ? "" : "s"}`, ...failureLines(report)]),
    "",
    `🕒 Last check <b>${formatCheckedAt(now)}</b> (BRT)`,
    `🔁 Every 30 min · <a href="${report.runUrl}">view run</a>`,
  ];
  return lines.join("\n");
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
      `<a href="${report.runUrl}">view run</a>`,
    ].join("\n");
  }
  return ["🎉 <b>Production recovered</b>", "", `<a href="${report.runUrl}">view run</a>`].join("\n");
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
   * @param {Record<string, unknown>} body
   * @returns {Promise<any>}
   */
  const call = async (method, body) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, ...body }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.ok === false) {
      throw new Error(`telegram ${method}: ${res.status} ${payload.description ?? ""}`.trim());
    }
    return payload.result;
  };

  const html = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };

  if (report.transition === "went_red" || report.transition === "recovered") {
    await call("sendMessage", { text: alertText(report), ...html });
  }

  const text = boardText(report, ctx.now ?? new Date());
  const chat = await call("getChat", {});
  const pinned = chat?.pinned_message;
  const pinnedIsBoard =
    typeof pinned?.message_id === "number" && typeof pinned.text === "string" && pinned.text.includes(BOARD_MARK);

  if (pinnedIsBoard) {
    try {
      await call("editMessageText", { message_id: pinned.message_id, text, ...html });
      return;
    } catch (error) {
      // A board the bot can no longer edit is replaced, not left stale.
      console.error(error);
    }
  }

  const sent = await call("sendMessage", { text, disable_notification: true, ...html });
  try {
    await call("pinChatMessage", { message_id: sent.message_id, disable_notification: true });
  } catch (error) {
    // Without pin rights the board still posts; it just cannot be found next run.
    console.error(error);
  }
}
