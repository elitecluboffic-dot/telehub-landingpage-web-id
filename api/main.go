// Telehub Indexer API
//
// API buatan sendiri (Go, 100% standard library, tanpa dependency luar)
// untuk crawling + auto-submit indexing artikel dari domain-domain yang
// diarahkan ke service ini.
//
// Alur singkat:
//   1. Frontend kirim POST /api/submit {"url": "..."}
//   2. API meng-crawl URL tsb sendiri (internal/crawler) untuk ambil title,
//      meta description, jumlah kata, link internal, dsb.
//   3. API mengirim notifikasi ke mesin pencari lewat protokol terbuka
//      IndexNow (internal/indexer) memakai key milik sendiri — bukan API
//      SaaS pihak ketiga. Key-nya SATU untuk semua domain: otomatis
//      berlaku untuk domain manapun yang diarahkan (DNS/reverse proxy)
//      ke service ini, tanpa perlu didaftarkan satu-satu di kode.
//   4. Status & histori bisa dicek lewat /api/status dan /api/list.
//   5. /sitemap.xml otomatis berisi seluruh URL yang sudah berhasil diindex.
//   6. Data record di-backup berkala (dan bisa manual) ke sebuah chat
//      Telegram lewat Bot API, supaya tidak hilang kalau pindah
//      server/volume Railway. Endpoint /api/restore dipakai untuk
//      mengembalikan data dari backup tersebut saat migrasi.
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"telehub-indexer-api/internal/crawler"
	"telehub-indexer-api/internal/handlers"
	"telehub-indexer-api/internal/indexer"
	"telehub-indexer-api/internal/middleware"
	"telehub-indexer-api/internal/store"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func main() {
	port := env("PORT", "8080")
	indexNowKey := env("INDEXNOW_KEY", "") // kosongkan supaya digenerate otomatis saat start
	apiKey := env("API_KEY", "")           // opsional: proteksi endpoint /api/submit, /api/backup, /api/restore
	dataFile := env("DATA_FILE", "./data/records.json")
	rateLimitPerMin := envInt("RATE_LIMIT_PER_MINUTE", 60)
	rateLimitBurst := envInt("RATE_LIMIT_BURST", 20)

	// Kredensial bot Telegram untuk backup data records.json secara berkala.
	// Kosongkan kalau tidak mau memakai fitur ini (backup akan dinonaktifkan otomatis).
	tgBotToken := env("TG_BOT_TOKEN", "")
	tgChatID := env("TG_CHAT_ID", "")

	// Daftar origin frontend yang boleh akses API ini (CORS). Tambahkan
	// domain baru di sini kalau ada frontend baru yang perlu akses API,
	// dipisah koma. Isi "*" untuk izinkan semua origin.
	allowedOriginsRaw := env(
		"ALLOWED_ORIGINS",
		"https://telehub.web.id,https://www.telehub.web.id,https://telehub.nfy.fyi,https://www.telehub.nfy.fyi",
	)
	var allowedOrigins []string
	if allowedOriginsRaw != "*" {
		for _, o := range strings.Split(allowedOriginsRaw, ",") {
			o = strings.TrimSpace(o)
			if o != "" {
				allowedOrigins = append(allowedOrigins, o)
			}
		}
	}

	st, err := store.New(dataFile)
	if err != nil {
		log.Fatalf("gagal inisialisasi store: %v", err)
	}

	inClient := indexer.NewIndexNowClient(indexNowKey)
	log.Printf("IndexNow key aktif: %s", inClient.Key)
	log.Printf("Pastikan path ini bisa diakses di SEMUA domain yang kamu submit (%s), contoh: https://telehub.web.id%s dan https://telehub.nfy.fyi%s",
		inClient.KeyLocationPath(), inClient.KeyLocationPath(), inClient.KeyLocationPath())

	api := &handlers.API{
		Store:      st,
		Crawler:    crawler.New(),
		IndexNow:   inClient,
		APIKey:     apiKey,
		TGBotToken: tgBotToken,
		TGChatID:   tgChatID,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", api.Health)
	mux.HandleFunc(inClient.KeyLocationPath(), api.IndexNowKeyFile) // satu route, otomatis jalan di semua domain
	mux.HandleFunc("/api/submit", api.Submit)
	mux.HandleFunc("/api/status", api.Status)
	mux.HandleFunc("/api/list", api.List)
	mux.HandleFunc("/api/backup", api.Backup)   // trigger backup manual data ke telegram
	mux.HandleFunc("/api/restore", api.Restore) // restore data dari backup (dipakai saat migrasi server)
	mux.HandleFunc("/sitemap.xml", api.Sitemap)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write([]byte(`{"service":"telehub-indexer-api","docs":"lihat README.md","endpoints":["/health","/api/submit","/api/status","/api/list","/api/backup","/api/restore","/sitemap.xml"]}`))
	})

	limiter := middleware.NewRateLimiter(rateLimitPerMin, rateLimitBurst)
	var handler http.Handler = mux
	handler = limiter.Middleware(handler)
	handler = middleware.CORS(allowedOrigins)(handler)
	handler = middleware.Logger(handler)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      handler,
		ReadTimeout:  20 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Backup mingguan otomatis ke Telegram, kalau kredensialnya diset.
	if tgBotToken != "" && tgChatID != "" {
		go func() {
			ticker := time.NewTicker(7 * 24 * time.Hour)
			defer ticker.Stop()
			for range ticker.C {
				if err := st.BackupToTelegram(tgBotToken, tgChatID); err != nil {
					log.Printf("backup mingguan ke telegram gagal: %v", err)
				} else {
					log.Printf("backup mingguan ke telegram berhasil")
				}
			}
		}()
		log.Printf("backup mingguan ke telegram aktif (setiap 7 hari)")
	} else {
		log.Printf("TG_BOT_TOKEN/TG_CHAT_ID belum diset, backup mingguan ke telegram dinonaktifkan")
	}

	log.Printf("Telehub Indexer API berjalan di port %s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server berhenti: %v", err)
	}
}
