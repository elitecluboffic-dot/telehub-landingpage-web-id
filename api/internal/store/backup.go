package store

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// BackupToTelegram mengirim file data JSON saat ini sebagai dokumen ke sebuah
// chat Telegram lewat Bot API. Dipakai sebagai backup periodik supaya data
// masih bisa direstore manual kalau suatu saat pindah server/volume Railway.
func (s *Store) BackupToTelegram(botToken, chatID string) error {
	if botToken == "" || chatID == "" {
		return fmt.Errorf("TG_BOT_TOKEN atau TG_CHAT_ID belum diset")
	}

	s.mu.RLock()
	raw, err := os.ReadFile(s.path)
	s.mu.RUnlock()
	if err != nil {
		return fmt.Errorf("gagal membaca file data: %w", err)
	}

	body := &bytes.Buffer{}
	w := multipart.NewWriter(body)

	if err := w.WriteField("chat_id", chatID); err != nil {
		return err
	}
	caption := fmt.Sprintf("Backup telehub-indexer-api - %s", time.Now().UTC().Format("2006-01-02 15:04 UTC"))
	if err := w.WriteField("caption", caption); err != nil {
		return err
	}

	part, err := w.CreateFormFile("document", filepath.Base(s.path))
	if err != nil {
		return err
	}
	if _, err := io.Copy(part, bytes.NewReader(raw)); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendDocument", botToken)
	req, err := http.NewRequest(http.MethodPost, url, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("gagal kirim ke telegram: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram API error (%d): %s", resp.StatusCode, string(respBody))
	}
	return nil
}
