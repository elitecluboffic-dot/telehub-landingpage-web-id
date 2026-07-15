// Package indexer bertugas memberitahu mesin pencari bahwa sebuah URL
// baru saja dibuat/diupdate, memakai protokol terbuka IndexNow.
//
// IndexNow BUKAN "API orang lain" dalam arti SaaS berbayar pihak ketiga —
// ini adalah protokol terbuka (didukung Bing, Yandex, Naver, Seznam, dll)
// yang kuncinya (key) kita generate & host sendiri di domain kita sendiri.
// Endpoint api.indexnow.org hanyalah gerbang notifikasi bersama, mirip
// seperti mengirim ping — bukan layanan crawling pihak ketiga yang
// menggantikan crawler kita sendiri.
package indexer

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"time"
)

const indexNowEndpoint = "https://api.indexnow.org/indexnow"

// IndexNowClient mengirim notifikasi URL baru/berubah ke mesin pencari.
type IndexNowClient struct {
	Host   string // contoh: telehub.web.id
	Key    string // key unik milik kita sendiri
	client *http.Client
}

// NewIndexNowClient membuat client baru. Jika key kosong, akan digenerate otomatis.
func NewIndexNowClient(host, key string) *IndexNowClient {
	if key == "" {
		key = GenerateKey()
	}
	return &IndexNowClient{
		Host: host,
		Key:  key,
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

// KeyFileContent adalah isi file yang harus di-hosting di https://<host>/<key>.txt
// sebagai bukti kepemilikan domain (verifikasi key).
func (c *IndexNowClient) KeyFileContent() string {
	return c.Key
}

// KeyLocationPath adalah path publik tempat key harus bisa diakses.
func (c *IndexNowClient) KeyLocationPath() string {
	return "/" + c.Key + ".txt"
}

type submitPayload struct {
	Host        string   `json:"host"`
	Key         string   `json:"key"`
	KeyLocation string   `json:"keyLocation"`
	URLList     []string `json:"urlList"`
}

// SubmitOne memberitahu mesin pencari untuk satu URL.
func (c *IndexNowClient) SubmitOne(pageURL string) error {
	return c.SubmitMany([]string{pageURL})
}

// SubmitMany memberitahu mesin pencari untuk banyak URL sekaligus (maks 10.000 per spesifikasi IndexNow).
func (c *IndexNowClient) SubmitMany(urls []string) error {
	if len(urls) == 0 {
		return nil
	}

	payload := submitPayload{
		Host:        c.Host,
		Key:         c.Key,
		KeyLocation: fmt.Sprintf("https://%s%s", c.Host, c.KeyLocationPath()),
		URLList:     urls,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, indexNowEndpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("gagal menghubungi IndexNow: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	// IndexNow membalas 200 atau 202 jika sukses diterima.
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("IndexNow menolak submit, status %d: %s", resp.StatusCode, string(respBody))
	}

	return nil
}
