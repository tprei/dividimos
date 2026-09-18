/** @typedef {import("../report.mjs").AmbientReport} AmbientReport */
/** @typedef {import("../report.mjs").SinkContext} SinkContext */

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

/**
 * @param {AmbientReport} report
 * @param {SinkContext} ctx
 * @returns {Promise<void>}
 */
export async function notify(report, ctx) {
  if (report.transition !== "went_red" && report.transition !== "recovered") {
    return;
  }

  const token = ctx.env.ALERT_TELEGRAM_BOT_TOKEN;
  const chatId = ctx.env.ALERT_TELEGRAM_CHAT_ID;

  const header =
    report.transition === "went_red"
      ? "Ambient em produção falhou"
      : "Ambient em produção recuperou";

  const failureLines = (report.failures ?? [])
    .slice(0, 5)
    .map((failure) => `- ${failure.name}`);

  const text = [header, ...failureLines, report.runUrl].join("\n");

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`telegram sendMessage: ${res.status} ${await res.text()}`);
  }
}
