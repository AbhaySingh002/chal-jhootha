CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((email IS NULL) = (password_hash IS NULL))
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE rooms (
    code TEXT PRIMARY KEY,
    snapshot JSONB NOT NULL,
    seq BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX rooms_updated_at_idx ON rooms(updated_at);

CREATE TABLE user_rooms (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE
);
CREATE INDEX user_rooms_room_code_idx ON user_rooms(room_code);

CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    handle TEXT NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0),
    games_won INTEGER NOT NULL DEFAULT 0 CHECK (games_won >= 0 AND games_won <= games_played),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (handle ~ '^[a-z0-9_]{3,16}$')
);
CREATE UNIQUE INDEX profiles_handle_lower_key ON profiles(LOWER(handle));

CREATE TABLE friendships (
    id UUID PRIMARY KEY,
    requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX friendships_pair_key ON friendships (
    LEAST(requester_id::TEXT, addressee_id::TEXT),
    GREATEST(requester_id::TEXT, addressee_id::TEXT)
);
CREATE INDEX friendships_requester_status_idx ON friendships(requester_id, status);
CREATE INDEX friendships_addressee_status_idx ON friendships(addressee_id, status);

CREATE TABLE completed_matches (
    id UUID PRIMARY KEY,
    room_code TEXT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE completed_match_participants (
    match_id UUID NOT NULL REFERENCES completed_matches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_winner BOOLEAN NOT NULL,
    is_registered BOOLEAN NOT NULL,
    PRIMARY KEY (match_id, user_id)
);
CREATE INDEX completed_match_participants_user_idx ON completed_match_participants(user_id, match_id);
