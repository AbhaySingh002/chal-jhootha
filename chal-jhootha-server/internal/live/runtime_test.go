package live_test

import (
	"context"
	"testing"

	"chal-jhootha-server/internal/live"
	"github.com/stretchr/testify/assert"
)

func TestRuntimeAreOnlineNilSafe(t *testing.T) {
	var r *live.Runtime
	res, err := r.AreOnline(context.Background(), []string{"u1", "u2"})
	assert.NoError(t, err)
	assert.Empty(t, res)
}
