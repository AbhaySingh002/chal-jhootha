// Package live owns Redis-backed short-lived game state. PostgreSQL remains
// the durable account and history store; this package is intentionally the
// only place that knows Redis key names.
package live

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	roomKeyPrefix    = "cj:room:"
	presencePrefix   = "cj:presence:"
	invitePrefix     = "cj:invite:"
	inviteUserPrefix = "cj:invites:"
	defaultLeaseTTL  = 3 * time.Second
)

type Snapshot struct {
	Code string
	Raw  string
	Seq  int
}

type Runtime struct {
	client *redis.Client
}

func Open(ctx context.Context, rawURL string) (*Runtime, error) {
	if strings.TrimSpace(rawURL) == "" {
		return nil, errors.New("REDIS_URL is required")
	}
	options, err := redis.ParseURL(rawURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	client := redis.NewClient(options)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return &Runtime{client: client}, nil
}

func (r *Runtime) Close() error {
	if r == nil || r.client == nil {
		return nil
	}
	return r.client.Close()
}

func (r *Runtime) Ping(ctx context.Context) error {
	if r == nil || r.client == nil {
		return errors.New("redis runtime unavailable")
	}
	return r.client.Ping(ctx).Err()
}

// SaveSnapshot applies only a monotonic update. A stalled process can never
// overwrite a newer room action written by another process.
func (r *Runtime) SaveSnapshot(ctx context.Context, snapshot Snapshot) error {
	if snapshot.Code == "" {
		return errors.New("room code is required")
	}
	const script = `
local current = tonumber(redis.call('HGET', KEYS[1], 'seq') or '-1')
if tonumber(ARGV[1]) < current then return 0 end
redis.call('HSET', KEYS[1], 'seq', ARGV[1], 'snapshot', ARGV[2])
return 1`
	return r.client.Eval(ctx, script, []string{roomKey(snapshot.Code)}, snapshot.Seq, snapshot.Raw).Err()
}

func (r *Runtime) LoadSnapshots(ctx context.Context) ([]Snapshot, error) {
	keys, err := r.client.Keys(ctx, roomKeyPrefix+"*").Result()
	if err != nil {
		return nil, err
	}
	result := make([]Snapshot, 0, len(keys))
	for _, key := range keys {
		values, err := r.client.HMGet(ctx, key, "seq", "snapshot").Result()
		if err != nil || len(values) != 2 || values[0] == nil || values[1] == nil {
			continue
		}
		var seq int
		if _, err := fmt.Sscan(fmt.Sprint(values[0]), &seq); err != nil {
			continue
		}
		code := strings.TrimPrefix(key, roomKeyPrefix)
		result = append(result, Snapshot{Code: code, Seq: seq, Raw: fmt.Sprint(values[1])})
	}
	return result, nil
}

func (r *Runtime) DeleteRoom(ctx context.Context, code string) error {
	if code == "" {
		return nil
	}
	return r.client.Del(ctx, roomKey(code)).Err()
}

// WithRoomLease prevents two nodes from applying a room action concurrently.
// The lock uses a unique value so a delayed release cannot unlock a newer
// lease. Callers should keep critical sections well below three seconds.
func (r *Runtime) WithRoomLease(ctx context.Context, code string, fn func() error) error {
	token := fmt.Sprintf("%d", time.Now().UnixNano())
	key := roomKey(code) + ":lease"
	ok, err := r.client.SetNX(ctx, key, token, defaultLeaseTTL).Result()
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("room action is already in progress")
	}
	defer func() {
		const release = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`
		_ = r.client.Eval(context.Background(), release, []string{key}, token).Err()
	}()
	return fn()
}

func (r *Runtime) SetPresence(ctx context.Context, userID string, ttl time.Duration) error {
	return r.client.Set(ctx, presencePrefix+userID, "1", ttl).Err()
}

func (r *Runtime) IsOnline(ctx context.Context, userID string) (bool, error) {
	count, err := r.client.Exists(ctx, presencePrefix+userID).Result()
	return count > 0, err
}

func (r *Runtime) AreOnline(ctx context.Context, userIDs []string) (map[string]bool, error) {
	result := make(map[string]bool, len(userIDs))
	if r == nil || r.client == nil || len(userIDs) == 0 {
		return result, nil
	}
	keys := make([]string, len(userIDs))
	for i, id := range userIDs {
		keys[i] = presencePrefix + id
	}
	vals, err := r.client.MGet(ctx, keys...).Result()
	if err != nil {
		return result, err
	}
	for i, val := range vals {
		if val != nil {
			result[userIDs[i]] = true
		}
	}
	return result, nil
}

func (r *Runtime) PutInvite(ctx context.Context, token, recipientID, payload string) error {
	pipe := r.client.TxPipeline()
	pipe.Set(ctx, invitePrefix+token, payload, 10*time.Minute)
	pipe.SAdd(ctx, inviteUserPrefix+recipientID, token)
	pipe.Expire(ctx, inviteUserPrefix+recipientID, 10*time.Minute)
	_, err := pipe.Exec(ctx)
	return err
}

func (r *Runtime) TakeInvite(ctx context.Context, token string) (string, error) {
	return r.client.GetDel(ctx, invitePrefix+token).Result()
}

func (r *Runtime) ListInvites(ctx context.Context, recipientID string) ([]string, error) {
	tokens, err := r.client.SMembers(ctx, inviteUserPrefix+recipientID).Result()
	if err != nil {
		return nil, err
	}
	values := make([]string, 0, len(tokens))
	for _, token := range tokens {
		value, err := r.client.Get(ctx, invitePrefix+token).Result()
		if errors.Is(err, redis.Nil) {
			_ = r.client.SRem(ctx, inviteUserPrefix+recipientID, token).Err()
			continue
		}
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, nil
}

func (r *Runtime) RemoveInviteToken(ctx context.Context, recipientID, token string) error {
	return r.client.SRem(ctx, inviteUserPrefix+recipientID, token).Err()
}

func roomKey(code string) string { return roomKeyPrefix + strings.ToUpper(code) }
