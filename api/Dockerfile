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

# Volume ini opsional; kalau Railway kamu pasang persistent volume,
# arahkan ke /app/data supaya histori indexing tidak hilang tiap deploy.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=8080
EXPOSE 8080

CMD ["./telehub-indexer-api"]
