package store

import "time"

// Status merepresentasikan tahapan proses sebuah URL di dalam sistem.
type Status string

const (
	StatusQueued    Status = "queued"
	StatusCrawling  Status = "crawling"
	StatusCrawled   Status = "crawled"
	StatusSubmitted Status = "submitted"
	StatusFailed    Status = "failed"
)

// PageMeta menyimpan metadata hasil crawling sebuah halaman/artikel.
type PageMeta struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Canonical   string   `json:"canonical"`
	H1          string   `json:"h1"`
	WordCount   int      `json:"word_count"`
	Links       []string `json:"links"`
	StatusCode  int      `json:"status_code"`
}

// IndexRecord adalah satu entri URL yang diajukan untuk diindex.
type IndexRecord struct {
	ID           string    `json:"id"`
	URL          string    `json:"url"`
	Status       Status    `json:"status"`
	Meta         *PageMeta `json:"meta,omitempty"`
	Error        string    `json:"error,omitempty"`
	SubmittedTo  []string  `json:"submitted_to,omitempty"` // contoh: ["indexnow:bing", "indexnow:yandex"]
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}
