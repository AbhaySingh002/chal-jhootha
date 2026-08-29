// Package metrics exposes lightweight process counters at /api/metrics.
// It intentionally uses the standard library so observability has no runtime
// service dependency; production can scrape or bridge these values later.
package metrics

import (
	"expvar"
	"net/http"
	"sync"
	"time"
)

var (
	values = expvar.NewMap("chal_jhootha")
	mu     sync.Mutex
)

func add(name string, delta int64) {
	mu.Lock()
	value := values.Get(name)
	if value == nil {
		value = new(expvar.Int)
		values.Set(name, value)
	}
	mu.Unlock()
	value.(*expvar.Int).Add(delta)
}

func Observe(prefix string, elapsed time.Duration) {
	add(prefix+"_count", 1)
	add(prefix+"_total_ms", elapsed.Milliseconds())
}

func WebSocketInbound(bytes int) {
	add("ws_inbound_messages", 1)
	add("ws_inbound_bytes", int64(bytes))
}
func WebSocketOutbound(bytes int) {
	add("ws_outbound_messages", 1)
	add("ws_outbound_bytes", int64(bytes))
}
func PersistenceRetry()   { add("persistence_retries", 1) }
func PersistenceFailure() { add("persistence_failures", 1) }
func PersistenceSuccess() { add("persistence_successes", 1) }

func Handler() http.Handler { return expvar.Handler() }
