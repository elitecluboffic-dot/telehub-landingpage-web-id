import { useEffect, useState } from "react";
import { adminGetServers, adminApprove, adminReject } from "../api";
import "./Admin.css";

const STORAGE_KEY = "telehub_admin_key";

export default function Admin() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) || "");
  const [inputKey, setInputKey] = useState("");
  const [status, setStatus] = useState("pending");
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function loadServers(key, tabStatus) {
    setLoading(true);
    setError(null);
    adminGetServers(tabStatus, key)
      .then((data) => setServers(data.servers || []))
      .catch((err) => {
        setError(err.message);
        if (err.message === "Unauthorized") {
          sessionStorage.removeItem(STORAGE_KEY);
          setAdminKey("");
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (adminKey) loadServers(adminKey, status);
  }, [adminKey, status]);

  function handleLogin(e) {
    e.preventDefault();
    sessionStorage.setItem(STORAGE_KEY, inputKey);
    setAdminKey(inputKey);
  }

  async function handleApprove(id) {
    try {
      await adminApprove(id, adminKey);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleReject(id) {
    try {
      await adminReject(id, adminKey);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      alert(err.message);
    }
  }

  if (!adminKey) {
    return (
      <div className="admin-login">
        <form onSubmit={handleLogin}>
          <h1>Masuk Admin</h1>
          <input
            type="password"
            placeholder="Admin key"
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            required
          />
          <button type="submit">Masuk</button>
        </form>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1>Panel Admin</h1>

      <div className="admin-tabs">
        {["pending", "approved", "rejected"].map((s) => (
          <button
            key={s}
            className={status === s ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setStatus(s)}
          >
            {s === "pending" ? "Menunggu" : s === "approved" ? "Disetujui" : "Ditolak"}
          </button>
        ))}
      </div>

      {loading ? <p className="state-text">Memuat...</p> : null}
      {error ? <p className="state-text state-text--error">{error}</p> : null}
      {!loading && !error && servers.length === 0 ? (
        <p className="state-text">Tidak ada data di kategori ini.</p>
      ) : null}

      <div className="admin-list">
        {servers.map((server) => (
          <div key={server.id} className="admin-row">
            <div className="admin-row__info">
              <div className="admin-row__title">
                <strong>{server.name}</strong>
                <span
                  className={
                    server.payment_status === "paid"
                      ? "pay-status pay-status--paid"
                      : "pay-status"
                  }
                >
                  {server.payment_status === "paid" ? "Sudah bayar" : "Belum bayar"}
                </span>
              </div>
              <a href={server.invite_link} target="_blank" rel="noopener noreferrer">
                {server.invite_link}
              </a>
              <p>{server.description}</p>
              <p className="admin-row__meta">
                {server.email} · {server.tags?.join(", ") || "tanpa tag"} ·{" "}
                {new Date(server.created_at).toLocaleString("id-ID")}
              </p>
            </div>

            {status === "pending" ? (
              <div className="admin-row__actions">
                <button className="btn-approve" onClick={() => handleApprove(server.id)}>
                  Approve
                </button>
                <button className="btn-reject" onClick={() => handleReject(server.id)}>
                  Reject
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
