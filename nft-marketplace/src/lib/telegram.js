export async function sendTelegramMessage(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error("TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID belum di-set sebagai secret.");
    return { ok: false, error: "missing_telegram_env" };
  }

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Gagal mengirim notifikasi Telegram:", res.status, body);
    return { ok: false, error: "telegram_api_error", status: res.status };
  }

  return { ok: true };
}

export function escapeHtmlForTelegram(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
