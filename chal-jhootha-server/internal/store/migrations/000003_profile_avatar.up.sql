ALTER TABLE profiles
    ADD COLUMN avatar_id TEXT NOT NULL DEFAULT 'ace-spades'
    CHECK (avatar_id IN ('ace-spades', 'king-hearts', 'queen-diamonds', 'jack-clubs', 'joker-red', 'joker-black'));
