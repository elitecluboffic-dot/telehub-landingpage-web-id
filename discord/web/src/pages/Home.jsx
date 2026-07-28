import { useEffect, useMemo, useState } from "react";
import { getServers } from "../api";
import ServerCard from "../components/ServerCard";
import "./Home.css";

const FLOATING_CARDS = [
  { src: "GANTI_DENGAN_LINK_FOTO_1.jpg", className: "floating-card--1" },
  { src: "GANTI_DENGAN_LINK_FOTO_2.jpg", className: "floating-card--2" },
  { src: "GANTI_DENGAN_LINK_FOTO_3.jpg", className: "floating-card--3" },
  { src: "GANTI_DENGAN_LINK_FOTO_4.jpg", className: "floating-card--4" },
  { src: "GANTI_DENGAN_LINK_FOTO_5.jpg", className: "floating-card--5" },
  { src: "GANTI_DENGAN_LINK_FOTO_6.jpg", className: "floating-card--6" },
];

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
      <div className="hero-stage">
        <div className="floating-gallery" aria-hidden="true">
          {FLOATING_CARDS.map((card) => (
            <div key={card.className} className={`floating-card ${card.className}`}>
              <img src={card.src} alt="" />
            </div>
          ))}
        </div>

        <section className="home-top">
          <div className="home-top__left">
            <div className="product-card">
              <div className="product-card__tag" aria-hidden="true">
                <span className="dot" />
                <span>PRODUK RESMI TELEHUB</span>
              </div>
              <h2>Promosi Server Discord</h2>
              <p className="product-card__price">
                Rp25.000<span>/ server, sekali bayar</span>
              </p>
              <p className="product-card__desc">
                Tampilkan server Discord kamu di direktori Telehub agar ditemukan ribuan
                pengguna. Setelah pembayaran dikonfirmasi, server kamu langsung tayang
                dengan badge ✓ terverifikasi dan bisa dicari lewat nama maupun tag.
              </p>
              <div className="product-card__features">
                <span className="feature-pill">✓ Tampil di direktori publik</span>
                <span className="feature-pill">✓ Badge terverifikasi</span>
                <span className="feature-pill">✓ Bisa dicari & difilter tag</span>
                <span className="feature-pill">✓ Aktif selama sesuai ketentuan</span>
              </div>
              <a href="#/submit" className="product-card__cta">
                Promosikan Server Sekarang — Rp25.000
              </a>
            </div>
          </div>

          <div className="home-top__right">
            <div className="hero">
              <div className="hero__ticker" aria-hidden="true">
                <span>SINYAL AKTIF</span>
                <span className="dot" />
                <span>{servers.length} server terverifikasi di Telehub</span>
              </div>
              <h1>Cari server Discord-mu berikutnya.</h1>
              <p>
                Telehub adalah titik kumpul server Discord Indonesia — temukan komunitas
                baru, atau promosikan server-mu ke ribuan orang.
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
                      className={
                        activeTag === tag ? "tag-filter tag-filter--active" : "tag-filter"
                      }
                      onClick={() => setActiveTag(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

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
