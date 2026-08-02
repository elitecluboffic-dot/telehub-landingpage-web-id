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
    this.conn = null;
    this.role = null; // "host" | "client" | null
    this.roomCode = null;
    this.connected = false;

    // latest raw input dari sisi lawan (kalau host: input p2 dari client;
    // kalau client: tidak dipakai, client cuma kirim, bukan terima input)
    this.remoteInput = { left: false, right: false, jump: false };

    // callback yang bisa di-set dari luar (game.js)
    this.onOpenRoom = null;      // (roomCode) => {}
    this.onPeerConnected = null; // () => {}  -> lawan berhasil connect
    this.onPeerDisconnected = null; // () => {}
    this.onError = null;        // (err) => {}
    this.onMessage = null;      // (data) => {}  -> semua pesan mentah (opsional)
    this.onStateReceived = null; // (state) => {}  -> khusus untuk client, terima state dari host
    this.onStartReceived = null; // (levelId) => {} -> khusus client, host memulai level
    this.onCompleteReceived = null; // (payload) => {} -> opsional
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
        this.conn = conn;
        this._bindConn();
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
        this.conn = this.peer.connect(this.roomCode, { reliable: true });
        this._bindConn();

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
    this.conn.on("data", (data) => {
      this.onMessage?.(data);
      if (data.type === "input") {
        this.remoteInput = data.input;
      } else if (data.type === "state") {
        this.onStateReceived?.(data.state);
      } else if (data.type === "start") {
        this.onStartReceived?.(data.levelId);
      } else if (data.type === "complete") {
        this.onCompleteReceived?.(data.payload);
      }
    });
  }

  send(payload) {
    if (this.conn && this.conn.open) {
      this.conn.send(payload);
    }
  }

  sendInput(input) {
    this.send({ type: "input", input });
  }

  sendState(state) {
    this.send({ type: "state", state });
  }

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
    try { this.peer?.destroy(); } catch (e) {}
    this.conn = null;
    this.peer = null;
    this.connected = false;
    this.role = null;
  }
}
