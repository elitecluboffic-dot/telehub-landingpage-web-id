import "./ServerCard.css";

export default function ServerCard({ server }) {
  return (
    <div className="server-card">
      <div className="server-card__icon">
        {server.icon_url ? (
          <img src={server.icon_url} alt="" />
        ) : (
          <span>{server.name.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="server-card__body">
        <div className="server-card__title-row">
          <h3>{server.name}</h3>
          {server.verified ? (
            <span className="badge-verified" title="Server terverifikasi (sudah bayar & disetujui)">
              ✓
            </span>
          ) : null}
        </div>
        {server.tags?.length ? (
          <div className="server-card__tags">
            {server.tags.map((tag) => (
              <span className="tag-pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <p className="server-card__desc">{server.description || "Belum ada deskripsi."}</p>
      </div>
      
        className="server-card__join"
        href={server.invite_link}
        target="_blank"
        rel="noopener noreferrer"
      >
        Join
      </a>
    </div>
  );
}
