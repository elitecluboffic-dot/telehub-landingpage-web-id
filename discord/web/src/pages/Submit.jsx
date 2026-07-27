import { useState } from "react";
import { submitServer, createPayment } from "../api";
import "./Submit.css";

const initialForm = {
  name: "",
  invite_link: "",
  description: "",
  icon_url: "",
  email: "",
  tagsInput: "",
};

export default function Submit() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("idle"); // idle | submitting | redirecting | error
  const [errorMsg, setErrorMsg] = useState("");

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");
    try {
      const tags = form.tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const { id } = await submitServer({
        name: form.name,
        invite_link: form.invite_link,
        description: form.description,
        icon_url: form.icon_url,
        email: form.email,
        tags,
      });
      setStatus("redirecting");
      const { paymentUrl } = await createPayment(id);
      // Lempar user ke halaman pembayaran Duitku
      window.location.href = paymentUrl;
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message);
    }
  }

  return (
    <div className="submit-page">
      <h1>Promosikan server-mu</h1>
      <p className="submit-page__subtitle">
        Biaya promosi <strong>Rp25.000</strong> per server. Setelah pembayaran dikonfirmasi,
        server kamu langsung tampil dengan badge{" "}
        <span className="badge-verified-inline">✓ terverifikasi</span>.
      </p>
      <form onSubmit={handleSubmit} className="submit-form">
        <label>
          Nama server
          <input
            required
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="Contoh: Warung Kopi Gaming"
          />
        </label>
        <label>
          Link invite Discord
          <input
            required
            type="url"
            value={form.invite_link}
            onChange={(e) => updateField("invite_link", e.target.value)}
            placeholder="https://discord.gg/xxxxxxx"
          />
        </label>
        <label>
          Email (buat konfirmasi pembayaran)
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => updateField("email", e.target.value)}
            placeholder="kamu@email.com"
          />
        </label>
        <label>
          URL icon server (opsional)
          <input
            type="url"
            value={form.icon_url}
            onChange={(e) => updateField("icon_url", e.target.value)}
            placeholder="https://..."
          />
        </label>
        <label>
          Tag (pisahin pakai koma)
          <input
            value={form.tagsInput}
            onChange={(e) => updateField("tagsInput", e.target.value)}
            placeholder="gaming, anime, santai"
          />
        </label>
        <label>
          Deskripsi
          <textarea
            rows={4}
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            placeholder="Ceritain server kamu di sini..."
          />
        </label>
        {errorMsg ? <p className="submit-form__error">{errorMsg}</p> : null}
        <button type="submit" disabled={status === "submitting" || status === "redirecting"}>
          {status === "submitting"
            ? "Menyimpan..."
            : status === "redirecting"
            ? "Mengarahkan ke pembayaran..."
            : "Lanjut ke pembayaran (Rp25.000)"}
        </button>
      </form>
    </div>
  );
}
