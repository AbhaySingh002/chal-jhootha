package teststore

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"

	"chal-jhootha-server/internal/store"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type Database struct {
	url    string
	admin  *sql.DB
	schema string
}

func NewDatabase(t testing.TB) *Database {
	t.Helper()
	baseURL := os.Getenv("TEST_DATABASE_URL")
	if baseURL == "" {
		t.Skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
	}
	admin, err := sql.Open("pgx", baseURL)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := admin.PingContext(context.Background()); err != nil {
		_ = admin.Close()
		t.Fatalf("ping test database: %v", err)
	}
	schema := "cj_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		_ = admin.Close()
		t.Fatalf("create test schema: %v", err)
	}

	testURL, err := withSearchPath(baseURL, schema)
	if err != nil {
		_ = admin.Close()
		t.Fatalf("build test database URL: %v", err)
	}
	db := &Database{url: testURL, admin: admin, schema: schema}
	t.Cleanup(func() {
		_, _ = db.admin.Exec(`DROP SCHEMA IF EXISTS ` + db.schema + ` CASCADE`)
		_ = db.admin.Close()
	})
	return db
}

func Open(t testing.TB) *store.Store {
	t.Helper()
	return NewDatabase(t).Open(t)
}

func (d *Database) Open(t testing.TB) *store.Store {
	t.Helper()
	st, err := store.Open(context.Background(), d.url)
	if err != nil {
		t.Fatalf("open PostgreSQL store: %v", err)
	}
	return st
}

func withSearchPath(baseURL, schema string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}
