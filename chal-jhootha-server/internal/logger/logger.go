package logger

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync/atomic"
	"time"
)

// ANSI color codes for rich, high-contrast terminal debugging
const (
	colorReset   = "\033[0m"
	colorBold    = "\033[1m"
	colorDim     = "\033[2m"
	colorRed     = "\033[31m"
	colorGreen   = "\033[32m"
	colorYellow  = "\033[33m"
	colorBlue    = "\033[34m"
	colorMagenta = "\033[35m"
	colorCyan    = "\033[36m"
	colorGray    = "\033[90m"
	colorWhite   = "\033[97m"
)

var (
	activeConnections int64
	activeRooms       int64
	globalLogger      *slog.Logger
)

func init() {
	SetLogger(os.Stdout, os.Getenv("LOG_FORMAT") == "json", os.Getenv("LOG_LEVEL") == "debug")
}

// Custom Pretty Handler for readable, high-speed terminal output
type PrettyHandler struct {
	w     io.Writer
	level slog.Level
}

func (h *PrettyHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *PrettyHandler) Handle(_ context.Context, r slog.Record) error {
	var lvlColor, tagColor string
	switch {
	case r.Level >= slog.LevelError:
		lvlColor = colorRed + colorBold
		tagColor = colorRed
	case r.Level >= slog.LevelWarn:
		lvlColor = colorYellow + colorBold
		tagColor = colorYellow
	case r.Level >= slog.LevelInfo:
		lvlColor = colorGreen
		tagColor = colorCyan
	default:
		lvlColor = colorGray
		tagColor = colorMagenta
	}

	timeStr := r.Time.Format("15:04:05.000")
	levelStr := fmt.Sprintf("%-5s", r.Level.String())

	// Build key-value pairs
	var tag, roomCode, playerID, connID, duration string
	var otherAttrs []string

	r.Attrs(func(a slog.Attr) bool {
		switch a.Key {
		case "tag":
			tag = a.Value.String()
		case "room":
			roomCode = a.Value.String()
		case "player":
			playerID = a.Value.String()
		case "conn":
			connID = a.Value.String()
		case "latency", "duration", "elapsed":
			duration = a.Value.String()
		default:
			otherAttrs = append(otherAttrs, fmt.Sprintf("%s%s%s=%s%v%s", colorGray, a.Key, colorReset, colorWhite, a.Value.Any(), colorReset))
		}
		return true
	})

	if tag == "" {
		tag = "APP"
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("%s%s%s %s[%s]%s %s[%-7s]%s %s%-32s%s",
		colorDim, timeStr, colorReset,
		lvlColor, levelStr, colorReset,
		tagColor+colorBold, tag, colorReset,
		colorBold, r.Message, colorReset,
	))

	if roomCode != "" {
		sb.WriteString(fmt.Sprintf(" %sroom=%s%s%s", colorYellow, colorBold, roomCode, colorReset))
	}
	if playerID != "" {
		sb.WriteString(fmt.Sprintf(" %splayer=%s%s%s", colorMagenta, colorBold, playerID, colorReset))
	}
	if connID != "" {
		shortConn := connID
		if len(shortConn) > 8 {
			shortConn = shortConn[:8]
		}
		sb.WriteString(fmt.Sprintf(" %sconn=%s%s", colorCyan, shortConn, colorReset))
	}
	if duration != "" {
		sb.WriteString(fmt.Sprintf(" %s⚡%s%s", colorGreen+colorBold, duration, colorReset))
	}
	if len(otherAttrs) > 0 {
		sb.WriteString(" ")
		sb.WriteString(strings.Join(otherAttrs, " "))
	}
	sb.WriteString("\n")

	_, err := h.w.Write([]byte(sb.String()))
	return err
}

func (h *PrettyHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h
}

func (h *PrettyHandler) WithGroup(name string) slog.Handler {
	return h
}

func SetLogger(w io.Writer, jsonFormat bool, isDebug bool) {
	minLevel := slog.LevelInfo
	if isDebug {
		minLevel = slog.LevelDebug
	}

	var handler slog.Handler
	if jsonFormat {
		handler = slog.NewJSONHandler(w, &slog.HandlerOptions{
			Level: minLevel,
		})
	} else {
		handler = &PrettyHandler{
			w:     w,
			level: minLevel,
		}
	}
	globalLogger = slog.New(handler)
	slog.SetDefault(globalLogger)
}

// Connection counter helpers
func IncActiveConnections() int64 {
	return atomic.AddInt64(&activeConnections, 1)
}

func DecActiveConnections() int64 {
	return atomic.AddInt64(&activeConnections, -1)
}

func GetActiveConnections() int64 {
	return atomic.LoadInt64(&activeConnections)
}

// Room counter helpers
func IncActiveRooms() int64 {
	return atomic.AddInt64(&activeRooms, 1)
}

func DecActiveRooms() int64 {
	return atomic.AddInt64(&activeRooms, -1)
}

func GetActiveRooms() int64 {
	return atomic.LoadInt64(&activeRooms)
}

// Contextual Log Helpers
func Info(tag, msg string, args ...any) {
	args = append([]any{slog.String("tag", tag)}, args...)
	slog.Info(msg, args...)
}

func Debug(tag, msg string, args ...any) {
	args = append([]any{slog.String("tag", tag)}, args...)
	slog.Debug(msg, args...)
}

func Warn(tag, msg string, args ...any) {
	args = append([]any{slog.String("tag", tag)}, args...)
	slog.Warn(msg, args...)
}

func Error(tag, msg string, args ...any) {
	args = append([]any{slog.String("tag", tag)}, args...)
	slog.Error(msg, args...)
}

// WS Connection Logs
func WSConnect(connID, ip, userAgent string, totalActive int64) {
	slog.Info("WS Client Connected",
		slog.String("tag", "WS"),
		slog.String("conn", connID),
		slog.String("ip", ip),
		slog.String("ua", truncate(userAgent, 40)),
		slog.Int64("activeConns", totalActive),
	)
}

func WSDisconnect(connID, roomCode, playerID, reason string, duration time.Duration, totalActive int64) {
	slog.Info("WS Client Disconnected",
		slog.String("tag", "WS"),
		slog.String("conn", connID),
		slog.String("room", roomCode),
		slog.String("player", playerID),
		slog.String("reason", reason),
		slog.Duration("duration", duration),
		slog.Int64("activeConns", totalActive),
	)
}

// Room Lifecycle Logs
func RoomCreated(roomCode, hostID string, activeTotal int64, duration time.Duration) {
	slog.Info("Room Created",
		slog.String("tag", "ROOM"),
		slog.String("room", roomCode),
		slog.String("host", hostID),
		slog.Duration("latency", duration),
		slog.Int64("activeRooms", activeTotal),
	)
}

func RoomDestroyed(roomCode, reason string, activeTotal int64) {
	slog.Info("Room Destroyed",
		slog.String("tag", "ROOM"),
		slog.String("room", roomCode),
		slog.String("reason", reason),
		slog.Int64("activeRooms", activeTotal),
	)
}

// Event Logs
func EventReceived(connID, roomCode, playerID, eventType, msgID string, size int) {
	slog.Info("Event Received",
		slog.String("tag", "EVENT"),
		slog.String("conn", connID),
		slog.String("room", roomCode),
		slog.String("player", playerID),
		slog.String("type", eventType),
		slog.String("msgId", msgID),
		slog.Int("bytes", size),
	)
}

func EventProcessed(roomCode, playerID, eventType string, seq int, duration time.Duration) {
	slog.Info("Event Processed",
		slog.String("tag", "GAME"),
		slog.String("room", roomCode),
		slog.String("player", playerID),
		slog.String("type", eventType),
		slog.Int("seq", seq),
		slog.Duration("latency", duration),
	)
}

func ReconnectAttempt(roomCode, tokenPrefix, connID string, found bool, playerID string) {
	if found {
		slog.Info("Reconnect Success",
			slog.String("tag", "RECONNECT"),
			slog.String("room", roomCode),
			slog.String("token", tokenPrefix+"..."),
			slog.String("player", playerID),
			slog.String("conn", connID),
		)
	} else {
		slog.Warn("Reconnect Failed (Token Mismatch)",
			slog.String("tag", "RECONNECT"),
			slog.String("room", roomCode),
			slog.String("token", tokenPrefix+"..."),
			slog.String("conn", connID),
		)
	}
}

func ChannelOverflow(roomCode, playerID, target string, queueLen int) {
	slog.Warn("Outbound Channel Full (Dropped Frame)",
		slog.String("tag", "BUFFER"),
		slog.String("room", roomCode),
		slog.String("player", playerID),
		slog.String("target", target),
		slog.Int("queueLen", queueLen),
	)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
