# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go backend
FROM golang:1.22-alpine AS backend-builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 go build -o monero-superpay ./cmd/server

# Stage 3: Final runtime
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend-builder /app/monero-superpay .
COPY --from=frontend-builder /app/frontend/dist ./web/
COPY backend/internal/db/migrations ./migrations/
RUN mkdir -p /data/uploads
ENV PORT=3033
ENV DATABASE_PATH=/data/merchant.db
ENV UPLOAD_DIR=/data/uploads
EXPOSE 3033
CMD ["./monero-superpay"]
