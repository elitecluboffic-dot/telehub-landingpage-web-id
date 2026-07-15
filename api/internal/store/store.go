package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Store adalah penyimpanan sederhana berbasis file JSON di disk.
// Dibuat sendiri (tanpa database eksternal) supaya mudah dideploy di Railway
// tanpa perlu provisioning database tambahan. Cocok untuk skala kecil-menengah.
type Store struct {
	mu       sync.RWMutex
	path     string
	records  map[string]*IndexRecord
	autosave bool
}

// New membuat/membuka store dari sebuah file JSON di disk.
func New(path string) (*Store, error) {
	s := &Store{
		path:     path,
		records:  make(map[string]*IndexRecord),
		autosave: true,
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("gagal membuat direktori data: %w", err)
	}

	if _, err := os.Stat(path); err == nil {
		if err := s.load(); err != nil {
			return nil, fmt.Errorf("gagal memuat data: %w", err)
		}
	}

	return s, nil
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		return nil
	}
	var list []*IndexRecord
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for _, r := range list {
		s.records[r.ID] = r
	}
	return nil
}

// persist menyimpan seluruh isi store ke disk. Dipanggil dengan lock sudah dipegang caller.
func (s *Store) persistLocked() error {
	list := make([]*IndexRecord, 0, len(s.records))
	for _, r := range s.records {
		list = append(list, r)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.Before(list[j].CreatedAt)
	})

	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Save memaksa penyimpanan ke disk.
func (s *Store) Save() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.persistLocked()
}

// Put menambahkan atau memperbarui sebuah record.
func (s *Store) Put(r *IndexRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r.UpdatedAt = time.Now().UTC()
	s.records[r.ID] = r
	if s.autosave {
		return s.persistLocked()
	}
	return nil
}

// Get mengambil satu record berdasarkan ID.
func (s *Store) Get(id string) (*IndexRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.records[id]
	return r, ok
}

// FindByURL mencari record berdasarkan URL persis.
func (s *Store) FindByURL(url string) (*IndexRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.records {
		if r.URL == url {
			return r, true
		}
	}
	return nil, false
}

// List mengembalikan seluruh record, terbaru lebih dulu.
func (s *Store) List(limit int) []*IndexRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	list := make([]*IndexRecord, 0, len(s.records))
	for _, r := range s.records {
		list = append(list, r)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt.After(list[j].CreatedAt)
	})

	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list
}

// URLsWithStatus mengembalikan seluruh URL dengan status tertentu (dipakai untuk sitemap).
func (s *Store) URLsWithStatus(statuses ...Status) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	want := make(map[Status]bool, len(statuses))
	for _, st := range statuses {
		want[st] = true
	}

	out := make([]string, 0)
	for _, r := range s.records {
		if want[r.Status] {
			out = append(out, r.URL)
		}
	}
	sort.Strings(out)
	return out
}

// Count mengembalikan jumlah record per status, untuk statistik ringkas.
func (s *Store) Count() map[Status]int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[Status]int)
	for _, r := range s.records {
		out[r.Status]++
	}
	return out
}
