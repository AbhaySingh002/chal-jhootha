package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

var (
	ErrProfileNotFound   = errors.New("profile not found")
	ErrNotRegistered     = errors.New("registered account required")
	ErrInvalidFriendship = errors.New("invalid friendship action")
	ErrFriendExists      = errors.New("friendship already exists")
	ErrFriendPending     = errors.New("friend request already pending")
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Store struct {
	db *sql.DB
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("DATABASE_URL is required")
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := runMigrations(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func runMigrations(db *sql.DB) error {
	source, err := iofs.New(migrationFiles, "migrations")
	if err != nil {
		return err
	}
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return err
	}
	migrator, err := migrate.NewWithInstance("iofs", source, "postgres", driver)
	if err != nil {
		return err
	}
	err = migrator.Up()
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

type User struct {
	ID           string
	Email        sql.NullString
	PasswordHash sql.NullString
	DisplayName  string
	IsRegistered bool
	// IsEphemeralGuest is true only for a guest reconstructed from a signed
	// browser session. It is deliberately never stored in the users table
	// until that guest finishes a match or creates a registered account.
	IsEphemeralGuest bool
}

func (s *Store) CreateUser(id, displayName string, email, passwordHash *string) error {
	var em, ph any
	if email != nil {
		em = *email
	}
	if passwordHash != nil {
		ph = *passwordHash
	}
	_, err := s.db.Exec(
		`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
		id, em, ph, displayName,
	)
	return err
}

func (s *Store) CreateRegisteredUser(id, displayName, email, passwordHash, handle string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(
		`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)`,
		id, email, passwordHash, displayName,
	); err != nil {
		return err
	}
	if _, err = tx.Exec(
		`INSERT INTO profiles (user_id, handle) VALUES ($1, $2)`,
		id, strings.ToLower(handle),
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) GetUser(id string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(`SELECT id, email, password_hash, display_name,
		email IS NOT NULL AND password_hash IS NOT NULL
		FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.IsRegistered)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

func (s *Store) GetUserByEmail(email string) (*User, error) {
	u := &User{}
	err := s.db.QueryRow(`SELECT id, email, password_hash, display_name,
		email IS NOT NULL AND password_hash IS NOT NULL
		FROM users WHERE email = $1`, email).
		Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.IsRegistered)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

func sessionTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Store) PutSession(token, userID string, ttl time.Duration) error {
	_, err := s.db.Exec(
		`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		sessionTokenHash(token), userID, time.Now().Add(ttl),
	)
	return err
}

func (s *Store) GetSession(token string) (userID string, ok bool, err error) {
	if token == "" {
		return "", false, nil
	}
	var expires time.Time
	err = s.db.QueryRow(`SELECT user_id, expires_at FROM sessions WHERE token_hash = $1`, sessionTokenHash(token)).Scan(&userID, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if time.Now().After(expires) {
		_, _ = s.db.Exec(`DELETE FROM sessions WHERE token_hash = $1`, sessionTokenHash(token))
		return "", false, nil
	}
	return userID, true, nil
}

func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = $1`, sessionTokenHash(token))
	return err
}

func (s *Store) PutWSTicket(ticket, userID string, ttl time.Duration) error {
	if ticket == "" {
		return errors.New("ticket is required")
	}
	_, err := s.db.Exec(
		`INSERT INTO ws_tickets (ticket_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		sessionTokenHash(ticket), userID, time.Now().Add(ttl),
	)
	return err
}

func (s *Store) ConsumeWSTicket(ticket string) (userID string, ok bool, err error) {
	if ticket == "" {
		return "", false, nil
	}
	err = s.db.QueryRow(
		`DELETE FROM ws_tickets WHERE ticket_hash = $1 AND expires_at > NOW() RETURNING user_id`,
		sessionTokenHash(ticket),
	).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return userID, true, nil
}

func (s *Store) DeleteWSTicketsForUser(userID string) error {
	_, err := s.db.Exec(`DELETE FROM ws_tickets WHERE user_id = $1`, userID)
	return err
}

func (s *Store) SaveRoom(code, snapshot string, seq int) error {
	_, err := s.db.Exec(
		`INSERT INTO rooms (code, snapshot, seq, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
		 ON CONFLICT(code) DO UPDATE SET snapshot = EXCLUDED.snapshot, seq = EXCLUDED.seq, updated_at = NOW()
		 WHERE rooms.seq <= EXCLUDED.seq`,
		code, snapshot, seq,
	)
	return err
}

func (s *Store) LoadAllRooms() ([]RoomRow, error) {
	rows, err := s.db.Query(`SELECT code, snapshot, seq, updated_at FROM rooms`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RoomRow
	for rows.Next() {
		var r RoomRow
		if err := rows.Scan(&r.Code, &r.Snapshot, &r.Seq, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) DeleteRoom(code string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM user_rooms WHERE room_code = $1`, code); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM rooms WHERE code = $1`, code); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SetUserRoom(userID, roomCode string) error {
	_, err := s.db.Exec(
		`INSERT INTO user_rooms (user_id, room_code) VALUES ($1, $2)
		 ON CONFLICT(user_id) DO UPDATE SET room_code = EXCLUDED.room_code`,
		userID, roomCode,
	)
	return err
}

func (s *Store) GetUserRoom(userID string) (string, bool, error) {
	var code string
	err := s.db.QueryRow(`SELECT room_code FROM user_rooms WHERE user_id = $1`, userID).Scan(&code)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return code, err == nil, err
}

func (s *Store) ClearUserRoom(userID string) error {
	_, err := s.db.Exec(`DELETE FROM user_rooms WHERE user_id = $1`, userID)
	return err
}

func (s *Store) PruneExpired(now, roomCutoff time.Time) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM sessions WHERE expires_at < $1`, now); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM user_rooms WHERE room_code IN (SELECT code FROM rooms WHERE updated_at < $1)`, roomCutoff); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM rooms WHERE updated_at < $1`, roomCutoff); err != nil {
		return err
	}
	return tx.Commit()
}

type RoomRow struct {
	Code      string
	Snapshot  string
	Seq       int
	UpdatedAt time.Time
}

type Profile struct {
	UserID      string `json:"userId"`
	Handle      string `json:"handle"`
	DisplayName string `json:"displayName"`
	GamesPlayed int    `json:"gamesPlayed"`
	GamesWon    int    `json:"gamesWon"`
}

type FriendshipView struct {
	ID        string  `json:"id"`
	Status    string  `json:"status"`
	Direction string  `json:"direction"`
	Profile   Profile `json:"profile"`
}

type MatchParticipant struct {
	UserID      string
	DisplayName string
	IsWinner    bool
}

func (s *Store) CreateProfile(userID, handle string) (*Profile, error) {
	var registered bool
	if err := s.db.QueryRow(`SELECT email IS NOT NULL AND password_hash IS NOT NULL FROM users WHERE id = $1`, userID).Scan(&registered); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotRegistered
		}
		return nil, err
	}
	if !registered {
		return nil, ErrNotRegistered
	}
	if _, err := s.db.Exec(`INSERT INTO profiles (user_id, handle) VALUES ($1, $2)`, userID, strings.ToLower(handle)); err != nil {
		return nil, err
	}
	return s.GetProfile(userID)
}

func (s *Store) GetProfile(userID string) (*Profile, error) {
	return s.profileByUserID(userID)
}

func (s *Store) profileByUserID(userID string) (*Profile, error) {
	p := &Profile{}
	err := s.db.QueryRow(`SELECT p.user_id, p.handle, u.display_name, p.games_played, p.games_won
		FROM profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`, userID).
		Scan(&p.UserID, &p.Handle, &p.DisplayName, &p.GamesPlayed, &p.GamesWon)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrProfileNotFound
	}
	return p, err
}

func (s *Store) GetProfileByHandle(handle, viewerID string) (*Profile, string, error) {
	p := &Profile{}
	err := s.db.QueryRow(`SELECT p.user_id, p.handle, u.display_name, p.games_played, p.games_won
		FROM profiles p JOIN users u ON u.id = p.user_id WHERE LOWER(p.handle) = LOWER($1)`, handle).
		Scan(&p.UserID, &p.Handle, &p.DisplayName, &p.GamesPlayed, &p.GamesWon)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrProfileNotFound
	}
	if err != nil {
		return nil, "", err
	}
	if viewerID == "" {
		return p, "none", nil
	}
	if viewerID == p.UserID {
		return p, "self", nil
	}
	var requesterID, status string
	err = s.db.QueryRow(`SELECT requester_id, status FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
		LIMIT 1`, viewerID, p.UserID).Scan(&requesterID, &status)
	if errors.Is(err, sql.ErrNoRows) || status == "declined" {
		return p, "none", nil
	}
	if err != nil {
		return nil, "", err
	}
	if status == "accepted" {
		return p, "friends", nil
	}
	if requesterID == viewerID {
		return p, "outgoing", nil
	}
	return p, "incoming", nil
}

func (s *Store) UpdateProfile(userID, handle, displayName string) (*Profile, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var exists bool
	if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id = $1)`, userID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrProfileNotFound
	}
	if _, err = tx.Exec(`UPDATE users SET display_name = $1 WHERE id = $2`, displayName, userID); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(`UPDATE profiles SET handle = $1, updated_at = NOW() WHERE user_id = $2`, strings.ToLower(handle), userID); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetProfile(userID)
}

func (s *Store) ListFriendships(userID string) ([]FriendshipView, error) {
	rows, err := s.db.Query(`SELECT f.id, f.status, f.requester_id, f.addressee_id,
		p.user_id, p.handle, u.display_name, p.games_played, p.games_won
		FROM friendships f
		JOIN profiles p ON p.user_id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
		JOIN users u ON u.id = p.user_id
		WHERE (f.requester_id = $1 OR f.addressee_id = $1) AND f.status IN ('pending', 'accepted')
		ORDER BY f.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	views := make([]FriendshipView, 0)
	for rows.Next() {
		var view FriendshipView
		var requesterID, addresseeID string
		if err := rows.Scan(&view.ID, &view.Status, &requesterID, &addresseeID,
			&view.Profile.UserID, &view.Profile.Handle, &view.Profile.DisplayName, &view.Profile.GamesPlayed, &view.Profile.GamesWon); err != nil {
			return nil, err
		}
		if view.Status == "accepted" {
			view.Direction = "friend"
		} else if addresseeID == userID {
			view.Direction = "incoming"
		} else {
			view.Direction = "outgoing"
		}
		views = append(views, view)
	}
	return views, rows.Err()
}

func (s *Store) CreateFriendRequest(requesterID, addresseeID string) error {
	if requesterID == addresseeID {
		return ErrInvalidFriendship
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var profileCount int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM profiles WHERE user_id IN ($1, $2)`, requesterID, addresseeID).Scan(&profileCount); err != nil {
		return err
	}
	if profileCount != 2 {
		return ErrProfileNotFound
	}

	result, err := tx.Exec(`INSERT INTO friendships (id, requester_id, addressee_id, status)
		VALUES ($1, $2, $3, 'pending') ON CONFLICT DO NOTHING`, uuid.NewString(), requesterID, addresseeID)
	if err != nil {
		return err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if inserted == 1 {
		return tx.Commit()
	}

	var id, status string
	err = tx.QueryRow(`SELECT id, status FROM friendships
		WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)
		LIMIT 1`, requesterID, addresseeID).Scan(&id, &status)
	if err != nil {
		return err
	}
	switch status {
	case "accepted":
		return ErrFriendExists
	case "pending":
		return ErrFriendPending
	case "declined":
		_, err = tx.Exec(`UPDATE friendships SET requester_id = $1, addressee_id = $2, status = 'pending', created_at = NOW(), responded_at = NULL WHERE id = $3`, requesterID, addresseeID, id)
		if err != nil {
			return err
		}
		return tx.Commit()
	default:
		return ErrInvalidFriendship
	}
}

func (s *Store) RespondToFriendRequest(userID, friendshipID string, accept bool) error {
	status := "declined"
	if accept {
		status = "accepted"
	}
	result, err := s.db.Exec(`UPDATE friendships SET status = $1, responded_at = NOW()
		WHERE id = $2 AND addressee_id = $3 AND status = 'pending'`, status, friendshipID, userID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return ErrInvalidFriendship
	}
	return nil
}

func (s *Store) RemoveFriendship(userID, friendshipID string) error {
	result, err := s.db.Exec(`DELETE FROM friendships
		WHERE id = $1 AND status = 'accepted' AND (requester_id = $2 OR addressee_id = $2)`, friendshipID, userID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed == 0 {
		return ErrInvalidFriendship
	}
	return nil
}

func (s *Store) ListRecentPlayers(userID string, limit int) ([]Profile, error) {
	if limit < 1 || limit > 50 {
		limit = 20
	}
	rows, err := s.db.Query(`SELECT p.user_id, p.handle, u.display_name, p.games_played, p.games_won
		FROM completed_match_participants mp
		JOIN completed_matches m ON m.id = mp.match_id
		JOIN profiles p ON p.user_id = mp.user_id
		JOIN users u ON u.id = p.user_id
		WHERE mp.user_id != $1 AND mp.is_registered = TRUE
		GROUP BY p.user_id, p.handle, u.display_name, p.games_played, p.games_won
		ORDER BY MAX(m.completed_at) DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	profiles := make([]Profile, 0)
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.UserID, &p.Handle, &p.DisplayName, &p.GamesPlayed, &p.GamesWon); err != nil {
			return nil, err
		}
		profiles = append(profiles, p)
	}
	return profiles, rows.Err()
}

func (s *Store) RecordCompletedMatch(matchID, roomCode string, participants []MatchParticipant) (bool, error) {
	if matchID == "" || len(participants) == 0 {
		return false, errors.New("match id and participants required")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.Exec(`INSERT INTO completed_matches (id, room_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, matchID, roomCode)
	if err != nil {
		return false, err
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if inserted == 0 {
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return false, nil
	}
	for _, participant := range participants {
		// Stateless guests become durable only when a match is worth retaining.
		// Existing registered users are unaffected by this idempotent insert.
		if _, err = tx.Exec(`INSERT INTO users (id, display_name) VALUES ($1, COALESCE(NULLIF($2, ''), 'GUEST')) ON CONFLICT DO NOTHING`, participant.UserID, participant.DisplayName); err != nil {
			return false, err
		}
		var registered bool
		if err = tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id = $1)`, participant.UserID).Scan(&registered); err != nil {
			return false, err
		}
		if _, err = tx.Exec(`INSERT INTO completed_match_participants (match_id, user_id, is_winner, is_registered) VALUES ($1, $2, $3, $4)`, matchID, participant.UserID, participant.IsWinner, registered); err != nil {
			return false, err
		}
		if registered {
			if _, err = tx.Exec(`UPDATE profiles SET games_played = games_played + 1,
				games_won = games_won + CASE WHEN $1 THEN 1 ELSE 0 END, updated_at = NOW() WHERE user_id = $2`, participant.IsWinner, participant.UserID); err != nil {
				return false, err
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}
