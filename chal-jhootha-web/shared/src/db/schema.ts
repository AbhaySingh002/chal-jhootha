import { pgTable, text, timestamp, boolean, uuid, integer } from 'drizzle-orm/pg-core';

// Better Auth core tables
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull(),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => user.id),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull(),
  updatedAt: timestamp("updatedAt").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt"),
  updatedAt: timestamp("updatedAt"),
});

// App-specific tables
export const profiles = pgTable('profiles', {
  userId: text('user_id').primaryKey().references(() => user.id),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarSeed: text('avatar_seed').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const friendships = pgTable('friendships', {
  id: uuid('id').primaryKey().defaultRandom(),
  requesterId: text('requester_id').notNull().references(() => user.id),
  addresseeId: text('addressee_id').notNull().references(() => user.id),
  status: text('status').notNull(), // 'pending' | 'accepted' | 'declined' | 'blocked'
  createdAt: timestamp('created_at').defaultNow(),
  respondedAt: timestamp('responded_at'),
});

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  roomCode: text('room_code').notNull(),
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  winnerParticipantId: uuid('winner_participant_id'), // Will be updated when game ends
});

export const matchParticipants = pgTable('match_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  matchId: uuid('match_id').notNull().references(() => matches.id),
  userId: text('user_id').references(() => user.id), // null for guests
  guestName: text('guest_name'),
  seatOrder: integer('seat_order').notNull(),
  cardsLeftAtEnd: integer('cards_left_at_end').notNull(),
  bluffsAttempted: integer('bluffs_attempted').notNull().default(0),
  bluffsCaught: integer('bluffs_caught').notNull().default(0),
  challengesMade: integer('challenges_made').notNull().default(0),
  challengesCorrect: integer('challenges_correct').notNull().default(0),
});

export const invites = pgTable('invites', {
  token: text('token').primaryKey(),
  roomCode: text('room_code').notNull(),
  createdByUserId: text('created_by_user_id').references(() => user.id),
  targetUserId: text('target_user_id').references(() => user.id),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
});
