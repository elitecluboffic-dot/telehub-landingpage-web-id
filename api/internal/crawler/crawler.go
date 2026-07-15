// Package crawler berisi crawler HTML buatan sendiri.
// Sengaja HANYA memakai net/http + regexp bawaan Go (tanpa library
// pihak ketiga, tanpa memanggil API crawler/indexing orang lain) supaya
// seluruh proses "crawling & indexing" murni logic milik sendiri.
package crawler

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"telehub-indexer-api/internal/store"
)

var (
	titleRe       = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	metaDescRe    = regexp.MustCompile(`(?is)<meta[^>]+name=["']description["'][^>]*content=["'](.*?)["'][^>]*>`)
	metaDescRe2   = regexp.MustCompile(`(?is)<meta[^>]+content=["'](.*?)["'][^>]+name=["']description["'][^>]*>`)
	canonicalRe   = regexp.MustCompile(`(?is)<link[^>]+rel=["']canonical["'][^>]+href=["'](.*?)["'][^>]*>`)
	canonicalRe2  = regexp.MustCompile(`(?is)<link[^>]+href=["'](.*?)["'][^>]+rel=["']canonical["'][^>]*>`)
	h1Re          = regexp.MustCompile(`(?is)<h1[^>]*>(.*?)</h1>`)
	anchorHrefRe  = regexp.MustCompile(`(?is)<a[^>]+href=["'](.*?)["']`)
	scriptStyleRe = regexp.MustCompile(`(?is)<(script|style|noscript)[^>]*>.*?</(script|style|noscript)>`)
	tagRe         = regexp.MustCompile(`(?is)<[^>]+>`)
	spaceRe       = regexp.MustCompile(`\s+`)
)

// Crawler menjalankan pengambilan & ekstraksi metadata sebuah halaman.
type Crawler struct {
	client    *http.Client
	userAgent string
	maxBytes  int64
}

// New membuat crawler baru dengan timeout & batas ukuran halaman yang wajar.
func New() *Crawler {
	return &Crawler{
		client: &http.Client{
			Timeout: 15 * time.Second,
		},
		userAgent: "TelehubIndexerBot/1.0 (+https://telehub.web.id/indexing)",
		maxBytes:  3 * 1024 * 1024, // 3MB cukup untuk halaman artikel biasa
	}
}

// Fetch mengambil sebuah URL dan mengembalikan metadata halamannya.
func (c *Crawler) Fetch(rawURL string) (*store.PageMeta, error) {
	parsed, err := url.ParseRequestURI(rawURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, errors.New("URL tidak valid, harus diawali http:// atau https://")
	}

	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("gagal mengakses URL: %w", err)
	}
	defer resp.Body.Close()

	limited := io.LimitReader(resp.Body, c.maxBytes)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("gagal membaca isi halaman: %w", err)
	}

	html := string(body)
	meta := &store.PageMeta{
		StatusCode:  resp.StatusCode,
		Title:       extractFirst(titleRe, html),
		Description: firstNonEmpty(extractFirst(metaDescRe, html), extractFirst(metaDescRe2, html)),
		Canonical:   firstNonEmpty(extractFirst(canonicalRe, html), extractFirst(canonicalRe2, html)),
		H1:          stripTags(extractFirst(h1Re, html)),
		Links:       extractLinks(html, parsed),
	}

	plain := stripTags(scriptStyleRe.ReplaceAllString(html, ""))
	meta.WordCount = countWords(plain)

	if resp.StatusCode >= 400 {
		return meta, fmt.Errorf("halaman mengembalikan status HTTP %d", resp.StatusCode)
	}

	return meta, nil
}

func extractFirst(re *regexp.Regexp, s string) string {
	m := re.FindStringSubmatch(s)
	if len(m) < 2 {
		return ""
	}
	return decodeEntities(strings.TrimSpace(stripTags(m[1])))
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func stripTags(s string) string {
	return strings.TrimSpace(tagRe.ReplaceAllString(s, " "))
}

func decodeEntities(s string) string {
	replacer := strings.NewReplacer(
		"&amp;", "&",
		"&quot;", `"`,
		"&#39;", "'",
		"&apos;", "'",
		"&lt;", "<",
		"&gt;", ">",
		"&nbsp;", " ",
	)
	return replacer.Replace(s)
}

func countWords(s string) int {
	s = spaceRe.ReplaceAllString(strings.TrimSpace(s), " ")
	if s == "" {
		return 0
	}
	return len(strings.Split(s, " "))
}

// extractLinks mengumpulkan link internal (satu domain) dari halaman,
// berguna untuk menemukan artikel lain yang bisa diajukan juga ke indexing.
func extractLinks(html string, base *url.URL) []string {
	matches := anchorHrefRe.FindAllStringSubmatch(html, -1)
	seen := make(map[string]bool)
	links := make([]string, 0, len(matches))

	for _, m := range matches {
		href := strings.TrimSpace(m[1])
		if href == "" || strings.HasPrefix(href, "#") || strings.HasPrefix(href, "mailto:") || strings.HasPrefix(href, "javascript:") {
			continue
		}
		u, err := base.Parse(href)
		if err != nil {
			continue
		}
		u.Fragment = ""
		if u.Host != base.Host {
			continue // hanya ambil link internal, sesuai domain yang diindex
		}
		clean := u.String()
		if !seen[clean] {
			seen[clean] = true
			links = append(links, clean)
		}
		if len(links) >= 200 {
			break
		}
	}
	return links
}
