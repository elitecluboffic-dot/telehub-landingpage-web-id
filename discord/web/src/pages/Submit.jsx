import { useState, useRef, useEffect } from "react";
import { submitServer, createPayment } from "../api";
import "./Submit.css";

const initialForm = {
  name: "",
  invite_link: "",
  description: "",
  icon_url: "",
  email: "",
  tagsInput: "",
  paymentMethod: "",
};

const PAYMENT_METHODS = [
  { value: "BC", label: "BCA Virtual Account" },
  { value: "M2", label: "Mandiri Virtual Account" },
  { value: "VA", label: "Maybank Virtual Account" },
  { value: "I1", label: "BNI Virtual Account" },
  { value: "BT", label: "Permata Bank Virtual Account" },
  { value: "OV", label: "OVO (Support Void)" },
  { value: "DA", label: "DANA" },
  { value: "IR", label: "Indomaret" },
  { value: "DM", label: "Danamon Virtual Account" },
  { value: "BV", label: "BSI Virtual Account" },
];

function PaymentMethodSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = PAYMENT_METHODS.find((m) => m.value === value);

  return (
    <div className="payment-select" ref={wrapperRef}>
      <button
        type="button"
        className={`payment-select__trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={selected ? "" : "payment-select__placeholder"}>
          {selected ? selected.label : "-- Pilih metode --"}
        </span>
        <svg
          className="payment-select__arrow"
          width="14"
          height="8"
          viewBox="0 0 14 8"
          fill="none"
        >
          <path
            d="M1 1L7 7L13 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul className="payment-select__menu" role="listbox">
          {PAYMENT_METHODS.map((method) => (
            <li
              key={method.value}
              role="option"
              aria-selected={method.value === value}
              className={`payment-select__option ${
                method.value === value ? "is-selected" : ""
              }`}
              onClick={() => {
                onChange(method.value);
                setOpen(false);
              }}
            >
              {method.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Submit() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("idle"); // idle | submitting | redirecting | error
  const [errorMsg, setErrorMsg] = useState("");

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.paymentMethod) {
      setStatus("error");
      setErrorMsg("Pilih metode pembayaran dulu ya.");
      return;
    }

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
      const { paymentUrl } = await createPayment(id, form.paymentMethod);
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
        <label>
          Metode pembayaran
          <PaymentMethodSelect
            value={form.paymentMethod}
            onChange={(val) => updateField("paymentMethod", val)}
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
