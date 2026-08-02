import { SMTPClient } from "smtp-client";

// ============================================================
// Mailer - kirim email lewat Gmail SMTP (App Password)
// Menggunakan smtp-client yang jalan di atas Cloudflare TCP Sockets,
// jadi kompatibel dengan Workers runtime (tidak butuh Node.js "net").
//
// Env yang wajib di-set lewat wrangler secret:
//   GMAIL_USER          -> alamat Gmail pengirim
//   GMAIL_APP_PASSWORD  -> App Password 16 karakter dari akun Google
// ============================================================

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465; // SSL/TLS langsung (implicit TLS)
const FROM_NAME = "PicoPark";
const SITE_HOSTNAME = "picopark.telehub.web.id";

/**
 * Escape karakter yang bisa mengganggu header email (hindari header injection
 * kalau suatu saat toEmail/subject berasal dari input user).
 */
function sanitizeHeaderValue(value) {
  return String(value).replace(/[\r\n]/g, "");
}

/**
 * Kirim satu email teks biasa lewat Gmail SMTP.
 * @param {object} env - Worker environment bindings (berisi GMAIL_USER, GMAIL_APP_PASSWORD)
 * @param {string} toEmail - alamat tujuan
 * @param {string} subject - subjek email
 * @param {string} textBody - isi email plain text
 */
async function sendMail(env, toEmail, subject, textBody) {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    throw new Error("GMAIL_USER atau GMAIL_APP_PASSWORD belum di-set di environment Worker");
  }

  const client = new SMTPClient({
    host: SMTP_HOST,
    port: SMTP_PORT,
    tls: true,
  });

  try {
    await client.connect();
    await client.greet({ hostname: SITE_HOSTNAME });
    await client.authPlain({
      username: env.GMAIL_USER,
      password: env.GMAIL_APP_PASSWORD,
    });

    await client.mail({ from: env.GMAIL_USER });
    await client.rcpt({ to: toEmail });

    const safeTo = sanitizeHeaderValue(toEmail);
    const safeSubject = sanitizeHeaderValue(subject);

    const rawMessage =
      `From: ${FROM_NAME} <${env.GMAIL_USER}>\r\n` +
      `To: ${safeTo}\r\n` +
      `Subject: ${safeSubject}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `Content-Transfer-Encoding: 8bit\r\n` +
      `\r\n` +
      `${textBody}\r\n`;

    await client.data(rawMessage);
    await client.quit();
  } catch (err) {
    // Pastikan koneksi ditutup meski terjadi error di tengah proses,
    // supaya tidak ada socket menggantung di Worker.
    try {
      await client.quit();
    } catch (_) {
      // abaikan error saat cleanup
    }
    throw err;
  }
}

/**
 * Kirim email berisi link reset password.
 * @param {object} env - Worker environment bindings
 * @param {string} toEmail - email tujuan (user yang minta reset)
 * @param {string} resetLink - URL lengkap ke halaman reset-password beserta token
 */
export async function sendResetEmail(env, toEmail, resetLink) {
  const subject = "Reset Password PicoPark";
  const body =
    `Halo,\n\n` +
    `Kami menerima permintaan untuk mereset password akun PicoPark kamu.\n\n` +
    `Klik link berikut untuk membuat password baru:\n${resetLink}\n\n` +
    `Link ini hanya berlaku selama 1 jam sejak email ini dikirim.\n\n` +
    `Kalau kamu tidak merasa meminta reset password, abaikan saja email ini ` +
    `dan password akun kamu tidak akan berubah.\n\n` +
    `Salam,\nTim PicoPark`;

  await sendMail(env, toEmail, subject, body);
}

/**
 * (Opsional) Kirim email notifikasi bahwa password berhasil diubah,
 * dipanggil setelah handleResetPasswordEndpoint sukses, sebagai lapisan
 * keamanan tambahan supaya user langsung tahu kalau ada perubahan.
 * Panggil manual dari index.js kalau mau dipakai.
 */
export async function sendPasswordChangedNotice(env, toEmail) {
  const subject = "Password PicoPark Kamu Telah Diubah";
  const body =
    `Halo,\n\n` +
    `Password akun PicoPark kamu baru saja berhasil diubah.\n\n` +
    `Kalau ini memang kamu yang melakukannya, tidak perlu tindakan apa pun.\n\n` +
    `Kalau kamu TIDAK merasa mengubah password, segera hubungi admin PicoPark ` +
    `karena kemungkinan akun kamu sedang diakses pihak lain.\n\n` +
    `Salam,\nTim PicoPark`;

  await sendMail(env, toEmail, subject, body);
}
