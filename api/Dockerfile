# ---- Build stage ----
FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o telehub-indexer-api .

# ---- Run stage ----
FROM alpine:3.19

RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/telehub-indexer-api .

# Folder data untuk menyimpan histori indexing. Kalau kamu pasang Railway
# Volume, arahkan mount path-nya ke /app/data (diatur lewat UI Railway,
# bukan lewat instruksi VOLUME di Dockerfile -- Railway tidak mendukung itu).
RUN mkdir -p /app/data

ENV PORT=8080
EXPOSE 8080

CMD ["./telehub-indexer-api"]
