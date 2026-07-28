import { useEffect, useMemo, useState } from "react";
import { getServers } from "../api";
import ServerCard from "../components/ServerCard";
import "./Home.css";

export default function Home() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState(null);

  useEffect(() => {
    getServers()
      .then((data) => setServers(data.servers || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const allTags = useMemo(() => {
    const set = new Set();
    servers.forEach((s) => s.tags?.forEach((t) => set.add(t)));
    return [...set];
  }, [servers]);

  const filtered = useMemo(() => {
    return servers.filter((s) => {
      const matchesSearch =
        !search || s.name.toLowerCase().includes(search.toLowerCase());
      const matchesTag = !activeTag || s.tags?.includes(activeTag);
      return matchesSearch && matchesTag;
    });
  }, [servers, search, activeTag]);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__ticker" aria-hidden="true">
          <span>SINYAL AKTIF</span>
          <span className="dot" />
          <span>{servers.length} server terverifikasi di Telehub</span>
        </div>
        <h1>Cari server Discord-mu berikutnya.</h1>
        <p>
          Telehub adalah titik kumpul server Discord Indonesia — temukan komunitas baru,
          atau promosikan server-mu ke ribuan orang.
        </p>
        <input
          className="search-input"
          type="text"
          placeholder="Cari nama server..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Cari server"
        />
        {allTags.length ? (
          <div className="tag-filters">
            <button
              className={!activeTag ? "tag-filter tag-filter--active" : "tag-filter"}
              onClick={() => setActiveTag(null)}
            >
              Semua
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                className={activeTag === tag ? "tag-filter tag-filter--active" : "tag-filter"}
                onClick={() => setActiveTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="product-info">
        <div className="product-card">
          <div className="product-card__header">
            <h2>Promosi Server Discord</h2>
            <span className="product-card__price">Rp25.000</span>
          </div>
          <p className="product-card__desc">
            Tampilkan server Discord kamu di direktori Telehub agar ditemukan ribuan
            pengguna. Setelah pembayaran dikonfirmasi, server kamu langsung tayang
            dengan badge <strong>✓ terverifikasi</strong> dan bisa dicari lewat nama
            maupun tag.
          </p>
          <ul className="product-card__features">
            <li>Tampil di halaman direktori publik Telehub</li>
            <li>Badge "Terverifikasi" pada listing server</li>
            <li>Bisa dicari dan difilter berdasarkan tag</li>
            <li>Berlaku selama server aktif dan sesuai ketentuan</li>
          </ul>
          <a href="#/submit" className="product-card__cta">
            Promosikan Server Sekarang — Rp25.000
          </a>
        </div>
      </section>

      <section className="server-list">
        {loading ? <p className="state-text">Memuat daftar server...</p> : null}
        {error ? <p className="state-text state-text--error">Gagal memuat: {error}</p> : null}
        {!loading && !error && filtered.length === 0 ? (
          <p className="state-text">Belum ada server yang cocok. Coba kata kunci lain.</p>
        ) : null}
        <div className="server-grid">
          {filtered.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      </section>
    </div>
  );
}
