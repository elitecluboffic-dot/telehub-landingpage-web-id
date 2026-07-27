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
