// Package middleware berisi rate limiter, CORS, dan logger — semuanya
// ditulis sendiri dari nol tanpa library pihak ketiga.
package middleware

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// bucket adalah token bucket sederhana untuk satu IP.
type bucket struct {
	tokens   float64
	lastFill time.Time
}

// RateLimiter membatasi jumlah request per IP per periode waktu.
type RateLimiter struct {
	mu         sync.Mutex
	buckets    map[string]*bucket
	ratePerSec float64
	burst      float64
	cleanupAt  time.Time
}

// NewRateLimiter membuat limiter baru.
// ratePerMinute: berapa banyak request yang di-"isi ulang" setiap menit.
// burst: kapasitas maksimum token (request beruntun yang diizinkan).
func NewRateLimiter(ratePerMinute int, burst int) *RateLimiter {
	return &RateLimiter{
		buckets:    make(map[string]*bucket),
		ratePerSec: float64(ratePerMinute) / 60.0,
		burst:      float64(burst),
		cleanupAt:  time.Now(),
	}
}

func (rl *RateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	// Bersihkan bucket lama sesekali supaya memori tidak bocor.
	if now.Sub(rl.cleanupAt) > 10*time.Minute {
		for k, b := range rl.buckets {
			if now.Sub(b.lastFill) > 30*time.Minute {
				delete(rl.buckets, k)
			}
		}
		rl.cleanupAt = now
	}

	b, ok := rl.buckets[ip]
	if !ok {
		b = &bucket{tokens: rl.burst, lastFill: now}
		rl.buckets[ip] = b
	}

	elapsed := now.Sub(b.lastFill).Seconds()
	b.tokens += elapsed * rl.ratePerSec
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.lastFill = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func clientIP(r *http.Request) string {
	// Railway/reverse proxy biasanya meneruskan IP asli lewat header ini.
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// Middleware membungkus handler dengan pengecekan rate limit.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !rl.allow(ip) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			w.Write([]byte(`{"error":"Terlalu banyak request, coba lagi beberapa saat lagi."}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}
