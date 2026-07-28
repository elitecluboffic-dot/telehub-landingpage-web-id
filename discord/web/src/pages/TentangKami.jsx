import "./TentangKami.css";

export default function TentangKami() {
  return (
    <div className="tentang-page">
      <h1>Tentang Kami</h1>
      <p className="tentang-page__subtitle">
        Telehub adalah direktori server Discord Indonesia yang membantu komunitas
        menemukan dan mempromosikan server mereka.
      </p>

      <div className="tentang-page__section">
        <h2>Kontak &amp; Support</h2>
        <ul className="tentang-page__contact-list">
          <li>
            <span className="tentang-page__label">Email</span>
            <span>telehubofficial.id@gmail.com</span>
          </li>
          <li>
            <span className="tentang-page__label">Telepon / WhatsApp</span>
            <span>+62 851-2297-5498</span>
          </li>
          <li>
            <span className="tentang-page__label">Alamat</span>
            <span>JL. GAJAH MADA, TENGAH, KAUMAN, KEC. KAUMAN, KABUPATEN PONOROGO, JAWA TIMUR 63451, INDONESIA</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
