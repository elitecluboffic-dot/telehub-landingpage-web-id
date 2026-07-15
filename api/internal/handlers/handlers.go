package handlers

import (
	"crypto/rand"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"telehub-indexer-api/internal/crawler"
	"telehub-indexer-api/internal/indexer"
	"telehub-indexer-api/internal/store"
)

// API menyatukan seluruh dependency yang dibutuhkan handler.
type API struct {
	Store    *store.Store
	Crawler  *crawler.Crawler
	IndexNow *indexer.IndexNowClient
	APIKey   string // optional: kalau diisi, endpoint submit butuh header X-API-Key
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func genID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// Health adalah health-check endpoint untuk Railway.
func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"time":   time.Now().UTC(),
	})
}

// IndexNowKeyFile menyajikan file verifikasi key IndexNow di /<key>.txt
func (a *API) IndexNowKeyFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(a.IndexNow.KeyFileContent()))
}

type submitRequest struct {
	URL  string   `json:"url"`
	URLs []string `json:"urls"`
}

type submitResponse struct {
	Accepted []string `json:"accepted"`
	Rejected []string `json:"rejected,omitempty"`
}

// Submit menerima satu atau banyak URL, meng-crawl-nya, lalu mengirim
// notifikasi indexing (IndexNow) ke mesin pencari — khusus untuk URL
// yang domainnya sama dengan domain yang key IndexNow-nya terverifikasi.
// URL dari domain lain tetap di-crawl (proses crawling memang multi-domain,
// bebas dipakai siapa saja), tapi notifikasi IndexNow-nya dilewati secara
// aman, bukan dipaksakan lalu berakhir gagal.
func (a *API) Submit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeErr(w, http.StatusMethodNotAllowed, "gunakan method POST")
		return
	}

	if a.APIKey != "" && r.Header.Get("X-API-Key") != a.APIKey {
		writeErr(w, http.StatusUnauthorized, "X-API-Key tidak valid")
		return
	}

	var req submitRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "body harus JSON valid, contoh: {\"url\":\"https://telehub.web.id/artikel-a\"}")
		return
	}

	urls := req.URLs
	if req.URL != "" {
		urls = append(urls, req.URL)
	}
	urls = dedupe(urls)

	if len(urls) == 0 {
		writeErr(w, http.StatusBadRequest, "sertakan minimal satu URL lewat field \"url\" atau \"urls\"")
		return
	}
	if len(urls) > 100 {
		writeErr(w, http.StatusBadRequest, "maksimal 100 URL per request")
		return
	}

	resp := submitResponse{}

	for _, u := range urls {
		u = strings.TrimSpace(u)
		if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
			resp.Rejected = append(resp.Rejected, u)
			continue
		}

		rec, exists := a.Store.FindByURL(u)
		if !exists {
			rec = &store.IndexRecord{
				ID:        genID(),
				URL:       u,
				Status:    store.StatusQueued,
				CreatedAt: time.Now().UTC(),
			}
		}
		_ = a.Store.Put(rec)
		resp.Accepted = append(resp.Accepted, u)

		// Proses crawling + submit indexing dijalankan async supaya
		// request dari frontend tidak menunggu lama (bisa banyak URL sekaligus).
		go a.processURL(rec)
	}

	writeJSON(w, http.StatusAccepted, resp)
}

// sameHost membandingkan hostname sebuah URL dengan host referensi
// (host yang key IndexNow-nya sudah terverifikasi). Perbandingan
// case-insensitive dan mengabaikan prefix "www.", supaya
// "https://Telehub.web.id/x" dan "https://www.telehub.web.id/x"
// tetap dianggap domain yang sama.
func sameHost(rawURL, referenceHost string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	got := strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
	want := strings.ToLower(strings.TrimPrefix(referenceHost, "www."))
	return got != "" && got == want
}

func (a *API) processURL(rec *store.IndexRecord) {
	rec.Status = store.StatusCrawling
	_ = a.Store.Put(rec)

	// --- 1. Crawling: berlaku untuk URL dari domain manapun, tanpa batasan. ---
	meta, err := a.Crawler.Fetch(rec.URL)
	if meta != nil {
		rec.Meta = meta
	}
	if err != nil {
		rec.Status = store.StatusFailed
		rec.Error = err.Error()
		_ = a.Store.Put(rec)
		log.Printf("crawl gagal untuk %s: %v", rec.URL, err)
		return
	}
	rec.Status = store.StatusCrawled
	rec.Error = ""
	_ = a.Store.Put(rec)

	// --- 2. Submit IndexNow: hanya valid untuk domain yang key-nya terverifikasi. ---
	// Protokol IndexNow mewajibkan URL yang disubmit berasal dari domain yang
	// sama dengan lokasi file verifikasi key (lihat internal/indexer/indexnow.go).
	// Kalau dipaksakan untuk domain lain, IndexNow akan selalu menolak dengan
	// error "not related to your verified domain" — jadi di sini kita cek dulu
	// dan lewati submit-nya secara terkendali, bukan menganggapnya "gagal".
	if !sameHost(rec.URL, a.IndexNow.Host) {
		rec.Error = fmt.Sprintf(
			"Berhasil di-crawl. Notifikasi otomatis ke mesin pencari (IndexNow) hanya aktif untuk domain %s, sehingga dilewati untuk domain URL ini.",
			a.IndexNow.Host,
		)
		_ = a.Store.Put(rec)
		log.Printf("skip indexnow submit untuk %s: domain berbeda dari %s", rec.URL, a.IndexNow.Host)
		return
	}

	if err := a.IndexNow.SubmitOne(rec.URL); err != nil {
		rec.Status = store.StatusFailed
		rec.Error = "crawl sukses, tapi submit indexing gagal: " + err.Error()
		_ = a.Store.Put(rec)
		log.Printf("indexnow submit gagal untuk %s: %v", rec.URL, err)
		return
	}

	rec.Status = store.StatusSubmitted
	rec.SubmittedTo = []string{"indexnow:bing", "indexnow:yandex", "indexnow:seznam", "indexnow:naver"}
	rec.Error = ""
	_ = a.Store.Put(rec)
	log.Printf("berhasil submit indexing untuk %s", rec.URL)
}

func dedupe(in []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(in))
	for _, v := range in {
		v = strings.TrimSpace(v)
		if v == "" || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

// Status mengembalikan detail satu record berdasarkan ID (?id=) atau URL (?url=).
func (a *API) Status(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	url := r.URL.Query().Get("url")

	var rec *store.IndexRecord
	var ok bool

	switch {
	case id != "":
		rec, ok = a.Store.Get(id)
	case url != "":
		rec, ok = a.Store.FindByURL(url)
	default:
		writeErr(w, http.StatusBadRequest, "sertakan query ?id= atau ?url=")
		return
	}

	if !ok {
		writeErr(w, http.StatusNotFound, "record tidak ditemukan")
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// List mengembalikan riwayat submit terbaru, dipakai dashboard di frontend.
func (a *API) List(w http.ResponseWriter, r *http.Request) {
	records := a.Store.List(200)
	counts := a.Store.Count()
	writeJSON(w, http.StatusOK, map[string]any{
		"total":   len(records),
		"counts":  counts,
		"records": records,
	})
}

// urlset/urlXML dipakai untuk menghasilkan sitemap.xml dinamis.
type urlEntry struct {
	Loc string `xml:"loc"`
}
type urlset struct {
	XMLName xml.Name   `xml:"urlset"`
	Xmlns   string     `xml:"xmlns,attr"`
	URLs    []urlEntry `xml:"url"`
}

// Sitemap menghasilkan sitemap.xml dari seluruh URL yang berhasil di-crawl/submit,
// sehingga bisa langsung dipakai ulang untuk pengajuan indexing berikutnya.
func (a *API) Sitemap(w http.ResponseWriter, r *http.Request) {
	urls := a.Store.URLsWithStatus(store.StatusCrawled, store.StatusSubmitted)

	set := urlset{Xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9"}
	for _, u := range urls {
		set.URLs = append(set.URLs, urlEntry{Loc: u})
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Write([]byte(xml.Header))
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	_ = enc.Encode(set)
}
