// Telehub Indexer API
//
// API buatan sendiri (Go, 100% standard library, tanpa dependency luar)
// untuk crawling + auto-submit indexing artikel dari telehub.web.id.
//
// Alur singkat:
//   1. Frontend (https://telehub.web.id/indexing) kirim POST /api/submit {"url": "..."}
//   2. API meng-crawl URL tsb sendiri (internal/crawler) untuk ambil title,
//      meta description, jumlah kata, link internal, dsb.
//   3. API mengirim notifikasi ke mesin pencari lewat protokol terbuka
//      IndexNow (internal/indexer) memakai key milik sendiri — bukan API
//      SaaS pihak ketiga.
//   4. Status & histori bisa dicek lewat /api/status dan /api/list.
//   5. /sitemap.xml otomatis berisi seluruh URL yang sudah berhasil diindex.
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
	host := env("INDEXNOW_HOST", "telehub.web.id")
	indexNowKey := env("INDEXNOW_KEY", "") // kosongkan supaya digenerate otomatis saat start
	apiKey := env("API_KEY", "")           // opsional: proteksi endpoint /api/submit
	dataFile := env("DATA_FILE", "./data/records.json")

	rateLimitPerMin := envInt("RATE_LIMIT_PER_MINUTE", 60)
	rateLimitBurst := envInt("RATE_LIMIT_BURST", 20)

	allowedOriginsRaw := env("ALLOWED_ORIGINS", "https://telehub.web.id,https://www.telehub.web.id")
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

	inClient := indexer.NewIndexNowClient(host, indexNowKey)
	log.Printf("IndexNow key aktif: %s (host: %s)", inClient.Key, host)
	log.Printf("Pastikan file berikut bisa diakses publik: https://%s%s", host, inClient.KeyLocationPath())

	api := &handlers.API{
		Store:    st,
		Crawler:  crawler.New(),
		IndexNow: inClient,
		APIKey:   apiKey,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", api.Health)
	mux.HandleFunc(inClient.KeyLocationPath(), api.IndexNowKeyFile)
	mux.HandleFunc("/api/submit", api.Submit)
	mux.HandleFunc("/api/status", api.Status)
	mux.HandleFunc("/api/list", api.List)
	mux.HandleFunc("/sitemap.xml", api.Sitemap)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write([]byte(`{"service":"telehub-indexer-api","docs":"lihat README.md","endpoints":["/health","/api/submit","/api/status","/api/list","/sitemap.xml"]}`))
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

	log.Printf("Telehub Indexer API berjalan di port %s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server berhenti: %v", err)
	}
}
