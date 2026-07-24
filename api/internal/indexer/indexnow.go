// Package indexer bertugas memberitahu mesin pencari bahwa sebuah URL
// baru saja dibuat/diupdate, memakai protokol terbuka IndexNow.
//
// IndexNow BUKAN "API orang lain" dalam arti SaaS berbayar pihak ketiga —
// ini adalah protokol terbuka (didukung Bing, Yandex, Naver, Seznam, dll)
// yang kuncinya (key) kita generate & host sendiri.
//
// Client ini mengirim notifikasi ke BEBERAPA endpoint secara terpisah:
//   - api.indexnow.org : relay umum, otomatis diteruskan ke peserta
//     IndexNow lain seperti Seznam & Naver.
//   - www.bing.com/indexnow : endpoint Bing sendiri.
//   - yandex.com/indexnow : endpoint Yandex sendiri.
//
// Hasil tiap endpoint dicatat APA ADANYA (sukses/gagal masing-masing),
// bukan diasumsikan dari satu response saja. Ini penting supaya
// rec.SubmittedTo di store benar-benar mencerminkan endpoint mana yang
// beneran menerima, bukan daftar tebakan.
//
// Client ini memakai SATU key untuk SEMUA domain. Ini otomatis berlaku
// untuk domain apapun, tanpa perlu didaftarkan satu-satu di kode, SELAMA
// domain tersebut memang diarahkan (DNS / reverse proxy) ke backend Go
// ini, karena file verifikasi key (https://<host>/<key>.txt) harus bisa
// diakses di domain yang sama dengan URL yang disubmit.
package indexer

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"time"
)

// indexNowEndpoints adalah daftar endpoint yang dipanggil TERPISAH satu
// per satu. Kunci map dipakai sebagai nama label di SubmitResult.Endpoint.
var indexNowEndpoints = map[string]string{
	"indexnow": "https://api.indexnow.org/indexnow", // relay umum -> Seznam, Naver, dll
	"bing":     "https://www.bing.com/indexnow",
	"yandex":   "https://yandex.com/indexnow",
}

// IndexNowClient mengirim notifikasi URL baru/berubah ke mesin pencari.
type IndexNowClient struct {
	Key    string // key unik milik kita sendiri, berlaku untuk semua domain
	client *http.Client
}

// NewIndexNowClient membuat client baru. Jika key kosong, akan digenerate otomatis.
func NewIndexNowClient(key string) *IndexNowClient {
	if key == "" {
		key = GenerateKey()
	}
	return &IndexNowClient{
		Key: key,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// GenerateKey membuat key hex acak 32 karakter, sesuai spesifikasi IndexNow.
func GenerateKey() string {
	const chars = "0123456789abcdef"
	out := make([]byte, 32)
	for i := range out {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		out[i] = chars[n.Int64()]
	}
	return string(out)
}

// KeyFileContent adalah isi file yang harus di-hosting di
// https://<host apapun>/<key>.txt sebagai bukti kepemilikan domain.
// Isinya sama untuk semua domain karena key-nya memang satu.
func (c *IndexNowClient) KeyFileContent() string {
	return c.Key
}

// KeyLocationPath adalah path publik tempat key harus bisa diakses,
// sama untuk semua domain (contoh: "/abc123....txt").
func (c *IndexNowClient) KeyLocationPath() string {
	return "/" + c.Key + ".txt"
}

type submitPayload struct {
	Host        string   `json:"host"`
	Key         string   `json:"key"`
	KeyLocation string   `json:"keyLocation"`
	URLList     []string `json:"urlList"`
}

// SubmitResult mencatat hasil ASLI dari satu endpoint (bukan asumsi).
type SubmitResult struct {
	Endpoint string // nama endpoint, misal "indexnow", "bing", "yandex"
	Success  bool
	Status   int
	Error    string
}

// SubmitOne memberitahu mesin pencari untuk satu URL, ke semua endpoint terdaftar.
func (c *IndexNowClient) SubmitOne(pageURL string) []SubmitResult {
	return c.SubmitMany([]string{pageURL})
}

// SubmitMany memberitahu mesin pencari untuk banyak URL sekaligus (maks
// 10.000 per spesifikasi IndexNow). Host diambil otomatis dari URL
// pertama — domain apapun, asal backend ini yang serve key file-nya di
// domain tersebut. Semua URL dalam satu panggilan harus dari domain yang
// sama (persyaratan protokol IndexNow).
//
// Setiap endpoint di indexNowEndpoints dipanggil TERPISAH, dan hasilnya
// dikembalikan per endpoint apa adanya — supaya caller (handlers.go) bisa
// tahu persis endpoint mana yang beneran sukses/gagal, bukan digeneralisir.
func (c *IndexNowClient) SubmitMany(urls []string) []SubmitResult {
	if len(urls) == 0 {
		return nil
	}

	u, err := url.Parse(urls[0])
	if err != nil {
		return []SubmitResult{{Success: false, Error: fmt.Sprintf("URL tidak valid: %v", err)}}
	}
	host := u.Hostname()
	if host == "" {
		return []SubmitResult{{Success: false, Error: fmt.Sprintf("URL tidak memiliki host: %s", urls[0])}}
	}

	payload := submitPayload{
		Host:        host,
		Key:         c.Key,
		KeyLocation: fmt.Sprintf("https://%s%s", host, c.KeyLocationPath()),
		URLList:     urls,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return []SubmitResult{{Success: false, Error: fmt.Sprintf("gagal marshal payload: %v", err)}}
	}

	results := make([]SubmitResult, 0, len(indexNowEndpoints))
	for name, endpoint := range indexNowEndpoints {
		results = append(results, c.submitToEndpoint(name, endpoint, body))
	}
	return results
}

// submitToEndpoint mengirim payload ke satu endpoint spesifik dan
// melaporkan hasil aslinya (status code & body error kalau gagal).
func (c *IndexNowClient) submitToEndpoint(name, endpoint string, body []byte) SubmitResult {
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return SubmitResult{Endpoint: name, Success: false, Error: err.Error()}
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.client.Do(req)
	if err != nil {
		return SubmitResult{Endpoint: name, Success: false, Error: fmt.Sprintf("gagal menghubungi %s: %v", name, err)}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	// IndexNow membalas 200 atau 202 jika sukses diterima.
	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusAccepted {
		return SubmitResult{Endpoint: name, Success: true, Status: resp.StatusCode}
	}
	return SubmitResult{
		Endpoint: name,
		Success:  false,
		Status:   resp.StatusCode,
		Error:    string(respBody),
	}
}
