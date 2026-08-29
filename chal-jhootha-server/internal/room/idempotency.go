package room

type IdempotencyTracker struct {
	processed map[string]int
	order     []string
	maxSize   int
}

func NewIdempotencyTracker(maxSize int) *IdempotencyTracker {
	return &IdempotencyTracker{
		processed: make(map[string]int),
		order:     make([]string, 0, maxSize),
		maxSize:   maxSize,
	}
}

func (t *IdempotencyTracker) Has(msgID string) (int, bool) {
	seq, ok := t.processed[msgID]
	return seq, ok
}

func (t *IdempotencyTracker) Add(msgID string, seq int) {
	if _, exists := t.processed[msgID]; exists {
		return
	}

	if len(t.order) >= t.maxSize {
		oldest := t.order[0]
		t.order = t.order[1:]
		delete(t.processed, oldest)
	}

	t.processed[msgID] = seq
	t.order = append(t.order, msgID)
}
