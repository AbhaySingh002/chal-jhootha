CREATE TABLE ws_tickets (
    ticket_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ws_tickets_user_id_idx ON ws_tickets(user_id);
CREATE INDEX ws_tickets_expires_at_idx ON ws_tickets(expires_at);
