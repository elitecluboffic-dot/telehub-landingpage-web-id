import { connect } from "cloudflare:sockets";

// ============================================================
// Mailer - kirim email lewat Gmail SMTP (App Password)
// Implementasi SMTP manual di atas Cloudflare TCP Sockets API
// (cloudflare:sockets), TANPA library luar - karena semua library
// SMTP npm (nodemailer, smtp-client, dst) masih bergantung pada
// modul Node asli (net, tls, os, events) yang tidak ada di Workers.
//
// Env yang wajib di-set lewat wrangler secret:
//   GMAIL_USER          -> alamat Gmail pengirim
//   GMAIL_APP_PASSWORD  -> App Password 16 karakter dari akun Google
// ============================================================

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465; // implicit TLS
const FROM_NAME = "PicoPark";
const SITE_HOSTNAME = "picopark.telehub.web.id";

function sanitizeHeaderValue(value) {
  return String(value).replace(/[\r\n]/g, "");
}

// Dot-stuffing sesuai RFC 5321: baris yang diawali "." harus diubah
// jadi ".." supaya tidak disalahartikan sebagai penanda akhir DATA.
function dotStuff(body) {
  return body
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? "." + line : line))
    .join("\r\n");
}

class SmtpError extends Error {
  constructor(message, code, raw) {
    super(message);
    this.name = "SmtpError";
    this.code = code;
    this.raw = raw;
  }
}

/**
 * Baca satu response SMTP lengkap dari server. Response multi-baris
 * pakai format "250-teks" untuk baris tengah dan "250 teks" (spasi)
 * untuk baris terakhir.
 */
async function readResponse(reader, leftoverRef) {
  const decoder = new TextDecoder();
  let buffer = leftoverRef.value || "";

  while (true) {
    const lines = buffer.split("\r\n");
    // baris terakhir bisa jadi belum lengkap, simpan sebagai leftover
    const complete = lines.slice(0, -1);
    const isFinalLineComplete = buffer.endsWith("\r\n");

    if (complete.length > 0 || isFinalLineComplete) {
      const allLines = isFinalLineComplete ? lines.filter((l) => l.length > 0) : complete;
      if (allLines.length > 0) {
        const lastLine = allLines[allLines.length - 1];
        if (/^\d{3} /.test(lastLine)) {
          leftoverRef.value = isFinalLineComplete ? "" : lines[lines.length - 1];
          const code = parseInt(lastLine.slice(0, 3), 10);
          return { code, text: allLines.join("\n") };
        }
      }
    }

    const { value, done } = await reader.read();
    if (done) {
      throw new SmtpError("Koneksi SMTP tertutup sebelum response lengkap diterima", 0, buffer);
    }
    buffer += decoder.decode(value, { stream: true });
  }
}

async function writeLine(writer, line) {
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(line + "\r\n"));
}

function expectCode(resp, expectedCodes, step) {
  const codes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  if (!codes.includes(resp.code)) {
    throw new SmtpError(`SMTP gagal di tahap "${step}": ${resp.text}`, resp.code, resp.text);
  }
}

/**
 * Kirim satu email teks biasa lewat Gmail SMTP.
 */
async function sendMail(env, toEmail, subject, textBody) {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) {
    throw new Error("GMAIL_USER atau GMAIL_APP_PASSWORD belum di-set di environment Worker");
  }

  const socket = connect(
    { hostname: SMTP_HOST, port: SMTP_PORT },
    { secureTransport: "on", allowHalfOpen: false }
  );

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const leftoverRef = { value: "" };

  try {
    await socket.opened;

    // 1. Baca greeting server (220)
    let resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 220, "greeting");

    // 2. EHLO
    await writeLine(writer, `EHLO ${SITE_HOSTNAME}`);
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 250, "EHLO");

    // 3. AUTH LOGIN
    await writeLine(writer, "AUTH LOGIN");
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 334, "AUTH LOGIN prompt username");

    await writeLine(writer, btoa(env.GMAIL_USER));
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 334, "AUTH LOGIN prompt password");

    await writeLine(writer, btoa(env.GMAIL_APP_PASSWORD));
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 235, "AUTH LOGIN verifikasi");

    // 4. MAIL FROM
    await writeLine(writer, `MAIL FROM:<${env.GMAIL_USER}>`);
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 250, "MAIL FROM");

    // 5. RCPT TO
    await writeLine(writer, `RCPT TO:<${toEmail}>`);
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, [250, 251], "RCPT TO");

    // 6. DATA
    await writeLine(writer, "DATA");
    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 354, "DATA");

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
      `${textBody}`;

    const stuffed = dotStuff(rawMessage);
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(stuffed + "\r\n.\r\n"));

    resp = await readResponse(reader, leftoverRef);
    expectCode(resp, 250, "pengiriman DATA");

    // 7. QUIT
    await writeLine(writer, "QUIT");
    try {
      await readResponse(reader, leftoverRef);
    } catch (_) {
      // abaikan, koneksi mungkin sudah ditutup server setelah QUIT
    }
  } finally {
    try {
      await writer.close();
    } catch (_) {}
    try {
      await reader.cancel();
    } catch (_) {}
    try {
      await socket.close();
    } catch (_) {}
  }
}

/**
 * Kirim email berisi link reset password.
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
 * (Opsional) Kirim email notifikasi bahwa password berhasil diubah.
 */
export async function sendPasswordChangedNotice(env, toEmail) {
  const subject = "Password PicoPark Kamu Telah Diubah";
  const body =
    `Halo,\n\n` +
    `Password akun PicoPark kamu baru saja berhasil diubah.\n\n` +
    `Kalau ini memang kamu yang melakukannya, tidak perlu tindakan apa pun.\n\n` +
    `Kalau kamu TIDAK merasa mengubah password, segera hubungi admin PicoPark: WhatsApp +1 (703) 618-7872` +
    `karena kemungkinan akun kamu sedang diakses pihak lain.\n\n` +
    `Salam,\nTim PicoPark`;

  await sendMail(env, toEmail, subject, body);
}
