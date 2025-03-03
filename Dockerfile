# Build stage
FROM golang:1.21.6-alpine AS builder

# Install required dependencies
RUN apk add --no-cache git curl nodejs npm yarn

# Set working directory
WORKDIR /app

# Copy Go module files first for better caching
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy the rest of the source code
COPY . .

# Install PostCSS CLI
RUN npm install -g postcss-cli

# Install packr2
RUN go install github.com/gobuffalo/packr/v2/packr2@v2.8.3

# Set environment variables
ENV CGO_ENABLED=0
ENV SCRVER=docker

# Process UI
WORKDIR /app/ui
RUN mkdir -p template/dist && \
    cd template && \
    yarn install && \
    postcss styles.css -o dist/styles.css && \
    cp index.html dist/index.html

# Build the application
WORKDIR /app
RUN packr2 && \
    go build -ldflags "-s -w -X github.com/rumblefrog/source-chat-relay/config.SCRVER=${SCRVER} -extldflags '-static'" -o server-binary

# Final stage - minimal image
FROM alpine:latest

WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/server-binary .

# Copy example config
COPY --from=builder /app/config.toml.example /app/config.toml

# Expose ports from the config
EXPOSE 57452 8080

# Run the application
CMD ["./server-binary"]