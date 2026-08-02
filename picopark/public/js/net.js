// ============================================================
// net.js — lapisan networking WebRTC (peer-to-peer) buat DuoJump.
// Dipakai supaya P1 & P2 bisa main dari 2 device berbeda,
// terhubung pakai kode room manual, tanpa perlu server tambahan.
//
// Model: HOST authoritative.
//   - Host  = selalu jadi Player 1, host yang menjalankan fisika
//             (GameLevel.update()) untuk KEDUA pemain.
//   - Client = selalu jadi Player 2. Client TIDAK menjalankan fisika
//             sendiri (supaya tidak "drift"/selisih dgn host).
//             Client cuma: (a) kirim input lokalnya ke host tiap
//             frame, (b) terima snapshot posisi dari host tiap
//             frame lalu render doang.
//
// PeerJS di-load otomatis dari CDN saat modul ini dipakai, jadi
// TIDAK perlu nambah <script> apapun di index.html.
//
// ------------------------------------------------------------
// FIX LAG/DELAY GERAKAN P2 (2 koneksi data, bukan cuma 1):
// ------------------------------------------------------------
// Sebelumnya SEMUA pesan (input, state posisi, start level, event
// selesai level) lewat satu channel "reliable" (mirip TCP: urutan
// dijaga & re-transmit kalau ada paket ilang). Enaknya: nggak ada
// pesan yang hilang. Nggak enaknya: kalau koneksi sempat nge-lag
// dikit (umum banget di 4G HP), satu paket yang telat bikin SEMUA
// paket setelahnya ikut ngantre di belakang dia (head-of-line
// blocking) — makanya gerakan P2 keliatan patah-patah / delay,
// padahal paket baru sebenarnya udah nyampe duluan.
//
// Sekarang dipecah jadi 2 channel:
//   - "reliable" -> buat event PENTING yang wajib nyampe & berurutan:
//     mulai level, level selesai, dsb. Ini cuma dikirim sesekali,
//     jadi nggak masalah kalau agak lambat asal pasti nyampe.
//   - "fast"     -> KHUSUS buat data real-time yang terus-menerus
//     dikirim tiap frame: posisi pemain & input. Channel ini UNRELIABLE
//     (paket boleh hilang) & UNORDERED (nggak perlu nunggu urutan).
//     Karena tiap ~33ms selalu ada paket baru yang lebih update,
//     paket lama yang telat itu percuma juga dipakai — jadi lebih
//     baik dilewatin aja daripada bikin antre paket-paket baru di
//     belakangnya. Hasilnya: gerakan kerasa jauh lebih responsif.
//
// Kalau karena suatu alasan channel "fast" gagal kebentuk (jaringan/
// browser tertentu kadang block unreliable channel), otomatis
// fallback pakai channel "reliable" biasa — jadi tetap jalan, cuma
// nggak dapet bonus kecepatan itu.
// ============================================================

const PEERJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.2/peerjs.min.js";

function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  if (window.__peerjsLoading) return window.__peerjsLoading;
  window.__peerjsLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PEERJS_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Gagal memuat PeerJS dari CDN"));
    document.head.appendChild(s);
  });
  return window.__peerjsLoading;
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return "DUO-" + s;
}

export class NetSession {
  constructor() {
    this.peer = null;
    this.conn = null;      // channel "reliable" — event penting (start, complete, dst)
    this.fastConn = null;  // channel "fast" — posisi & input real-time, low-latency
    this.role = null; // "host" | "client" | null
    this.roomCode = null;
    this.connected = false;

    // latest raw input dari sisi lawan (kalau host: input p2 dari client;
    // kalau client: tidak dipakai, client cuma kirim, bukan terima input)
    this.remoteInput = { left: false, right: false, jump: false };

    // Timestamp (ms, performance.now()) kapan input/state terakhir kali
    // BENERAN diterima. Berguna kalau game.js mau ngukur/nge-debug
    // seberapa "segar" data lawan (mis. buat indikator koneksi jelek).
    this.lastRemoteInputAt = 0;
    this.lastRemoteStateAt = 0;

    // callback yang bisa di-set dari luar (game.js)
    this.onOpenRoom = null;      // (roomCode) => {}
    this.onPeerConnected = null; // () => {}  -> lawan berhasil connect
    this.onPeerDisconnected = null; // () => {}
    this.onError = null;        // (err) => {}
    this.onMessage = null;      // (data) => {}  -> semua pesan mentah (opsional)
    this.onStateReceived = null; // (state) => {}  -> khusus untuk client, terima state dari host
    this.onStartReceived = null; // (levelId) => {} -> khusus client, host memulai level
    this.onCompleteReceived = null; // (payload) => {} -> opsional

    this._fastConnectTimer = null;
  }

  async hostRoom(customCode) {
    await loadPeerJs();
    this.role = "host";
    this.roomCode = customCode || randomRoomCode();

    return new Promise((resolve, reject) => {
      this.peer = new window.Peer(this.roomCode);

      this.peer.on("open", () => {
        this.onOpenRoom?.(this.roomCode);
        resolve(this.roomCode);
      });

      this.peer.on("connection", (conn) => {
        // Client bikin 2 koneksi ke host (reliable + fast), dibedain
        // pakai conn.label. Urutan datangnya bisa acak, makanya
        // dicek label-nya, bukan cuma "yang pertama dateng = reliable".
        if (conn.label === "fast") {
          this.fastConn = conn;
          this._bindFastConn();
        } else {
          this.conn = conn;
          this._bindConn();
        }
      });

      this.peer.on("error", (err) => {
        this.onError?.(err);
        reject(err);
      });
    });
  }

  async joinRoom(roomCode) {
    await loadPeerJs();
    this.role = "client";
    this.roomCode = roomCode.trim().toUpperCase();

    return new Promise((resolve, reject) => {
      this.peer = new window.Peer();

      this.peer.on("open", () => {
        // Channel utama: reliable, dipakai buat event penting +
        // fallback kalau channel fast gagal kebentuk.
        this.conn = this.peer.connect(this.roomCode, { reliable: true, label: "reliable" });
        this._bindConn();

        // Channel kedua: unreliable & unordered, khusus posisi/input
        // real-time biar nggak nge-lag nunggu paket lama yang telat.
        try {
          this.fastConn = this.peer.connect(this.roomCode, {
            reliable: false,
            serialization: "json",
            label: "fast",
          });
          this._bindFastConn();
        } catch (e) {
          // Kalau browser/network nggak support, nggak apa-apa — nanti
          // send() otomatis fallback ke channel reliable biasa.
          this.fastConn = null;
        }

        this.conn.on("open", () => resolve());
        this.conn.on("error", (err) => {
          this.onError?.(err);
          reject(err);
        });
      });

      this.peer.on("error", (err) => {
        this.onError?.(err);
        reject(err);
      });
    });
  }

  _bindConn() {
    this.conn.on("open", () => {
      this.connected = true;
      this.onPeerConnected?.();
    });
    this.conn.on("close", () => {
      this.connected = false;
      this.onPeerDisconnected?.();
    });
    this.conn.on("data", (data) => this._handleData(data));
  }

  _bindFastConn() {
    if (!this.fastConn) return;
    this.fastConn.on("data", (data) => this._handleData(data));
    // Sengaja tidak mengubah this.connected / trigger onPeerConnected
    // dari channel ini — status koneksi utama tetap ditentukan oleh
    // channel "reliable" supaya perilaku existing (badge status,
    // applyControlVisibility, dsb) tidak berubah.
    this.fastConn.on("error", () => {
      // Kalau channel fast tiba-tiba error, biarkan mati sendiri;
      // send() akan otomatis balik pakai channel reliable.
      this.fastConn = null;
    });
  }

  _handleData(data) {
    this.onMessage?.(data);
    if (data.type === "input") {
      this.remoteInput = data.input;
      this.lastRemoteInputAt = performance.now();
    } else if (data.type === "state") {
      this.lastRemoteStateAt = performance.now();
      this.onStateReceived?.(data.state);
    } else if (data.type === "start") {
      this.onStartReceived?.(data.levelId);
    } else if (data.type === "complete") {
      this.onCompleteReceived?.(data.payload);
    }
  }

  // fast=true -> coba lewat channel low-latency dulu, fallback ke
  // channel reliable kalau fast belum/nggak kebentuk.
  send(payload, { fast = false } = {}) {
    const target = fast && this.fastConn && this.fastConn.open ? this.fastConn : this.conn;
    if (target && target.open) {
      target.send(payload);
    }
  }

  sendInput(input) {
    this.send({ type: "input", input }, { fast: true });
  }

  sendState(state) {
    this.send({ type: "state", state }, { fast: true });
  }

  // Event penting (jarang dikirim) tetap lewat channel reliable biasa,
  // supaya dijamin nyampe & nggak ke-skip.
  sendStart(levelId) {
    this.send({ type: "start", levelId });
  }

  sendComplete(payload) {
    this.send({ type: "complete", payload });
  }

  isHost() { return this.role === "host"; }
  isClient() { return this.role === "client"; }

  destroy() {
    try { this.conn?.close(); } catch (e) {}
    try { this.fastConn?.close(); } catch (e) {}
    try { this.peer?.destroy(); } catch (e) {}
    this.conn = null;
    this.fastConn = null;
    this.peer = null;
    this.connected = false;
    this.role = null;
  }
}
