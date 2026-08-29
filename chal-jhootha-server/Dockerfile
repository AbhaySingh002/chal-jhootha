FROM golang:1.26.5-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/chal-jhootha-server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=build --chown=nonroot:nonroot /out/chal-jhootha-server /app/chal-jhootha-server

ENV PORT=10000
EXPOSE 10000
USER nonroot:nonroot
ENTRYPOINT ["/app/chal-jhootha-server"]
