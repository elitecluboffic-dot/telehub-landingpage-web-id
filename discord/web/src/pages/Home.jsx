import { useEffect, useMemo, useState } from "react";
import { getServers } from "../api";
import ServerCard from "../components/ServerCard";
import "./Home.css";

// Tinggal tambah/kurangi link foto di sini. Posisi, ukuran, rotasi,
// dan jeda animasi dihitung otomatis di bawah -- nggak perlu sentuh CSS.
const FLOATING_IMAGES = [
  "/discord/floating/armored-warriors.jpg",
  "/discord/floating/cinematic-bimxr.jpg",
  "/discord/floating/fist-person.jpg",
  "/discord/floating/superhero-and-spongebob.jpg",
  "/discord/floating/superhero.jpg",
  "/discord/floating/view-cashier.jpg",
  "/discord/floating/swimming.jpg",
  "/discord/floating/shut-bimxr.jpg",
];

// Titik-titik posisi di sekeliling hero (dalam persen), sudah didesain
// supaya nggak numpuk. Kalau foto lebih banyak dari jumlah slot ini,
// otomatis mengulang dari slot pertama lagi.
const FLOATING_SLOTS = [
  { top: "-9%", left: "-5%", size: 76, rotate: -9 },
  { top: "6%", right: "-8%", size: 96, rotate: 7 },
  { bottom: "20%", left: "-10%", size: 68, rotate: 11 },
  { bottom: "-8%", right: "7%", size: 88, rotate: -6 },
  { top: "46%", left: "-6%", size: 60, rotate: 5 },
  { bottom: "4%", right: "-7%", size: 72, rotate: -11 },
  { top: "-11%", left: "40%", size: 64, rotate: 4 },
  { top: "20%", left: "-13%", size: 58, rotate: -13 },
  { bottom: "-9%", left: "32%", size: 70, rotate: 8 },
  { top: "58%", right: "-10%", size: 66, rotate: -5 },
];

const CYCLE_DURATION = 9; // detik, harus sama dengan durasi di keyframes CSS
const MIN_LOADING_MS = 1800; // splash minimal tampil segini lama, biar kelihatan

function PageLoader({ images }) {
  const items = images.slice(0, 8);
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="page-loader__ring">
        {items.map((src, i) => (
          <div
            key={src}
            className="page-loader__item"
            style={{
              "--i": i,
              "--n": items.length,
            }}
          >
            <img src={src} alt="" />
          </div>
        ))}
        <div className="page-loader__core" />
      </div>
      <p className="page-loader__label">TELEHUB</p>
    </div>
  );
}

export default function Home() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    getServers()
      .then((data) => {
        if (cancelled) return;
        setServers(data.servers || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (cancelled) return;
        // Fetch beneran udah selesai (sukses/gagal), tapi kita tunggu
        // sampai minimal MIN_LOADING_MS terlewati juga, biar splash
        // nggak cuma kedip sekilas kalau koneksi kenceng.
        const elapsed = Date.now() - startedAt;
        const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
        setTimeout(() => {
          if (!cancelled) setLoading(false);
        }, remaining);
      });

    return () => {
      cancelled = true;
    };
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

  const floatingCards = useMemo(() => {
    return FLOATING_IMAGES.map((src, i) => {
      const slot = FLOATING_SLOTS[i % FLOATING_SLOTS.length];
      const delay = (i * (CYCLE_DURATION / FLOATING_IMAGES.length)).toFixed(2);
      return {
        src,
        key: `${src}-${i}`,
        style: {
          top: slot.top,
          left: slot.left,
          right: slot.right,
          bottom: slot.bottom,
          width: `${slot.size}px`,
          height: `${slot.size}px`,
          "--r": `${slot.rotate}deg`,
          animationDelay: `${delay}s`,
        },
      };
    });
  }, []);

  if (loading) {
    return <PageLoader images={FLOATING_IMAGES} />;
  }

  return (
    <div className="home">
      <div className="hero-stage">
        <div className="floating-gallery" aria-hidden="true">
          {floatingCards.map((card) => (
            <div key={card.key} className="floating-card" style={card.style}>
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
        {error ? <p className="state-text state-text--error">Gagal memuat: {error}</p> : null}
        {!error && filtered.length === 0 ? (
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
