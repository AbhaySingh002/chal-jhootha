<div align="center">

<img src="./assets/hero-banner.svg" alt="Chal Jhootha // Bluff" width="100%" />

<br /><br />

**A psychological multiplayer card game of high-stakes deception, bluffing, and interrogation.**  
Built with an actor-isolated Go engine, sub-5ms native WebSockets, Redis presence, and React 19.

<br />

[Quickstart](#-quickstart) &nbsp;·&nbsp;
[How to Play](#-how-to-play) &nbsp;·&nbsp;
[Turn Mechanics](#-the-interrogation-cycle) &nbsp;·&nbsp;
[Architecture](#-system-architecture) &nbsp;·&nbsp;
[Local Testing](#-local-multiplayer-testing)

<br />

<img src="./assets/card-spread.svg" alt="Card Showcase" width="100%" />

</div>

---

## 🃏 Overview

**Chal Jhootha** (also known as *Bluff* or *Cheat*) is a fast-paced card game where honesty is optional, but getting caught is fatal.

Players place cards face-down and announce what they played. Anyone at the table can challenge their honesty. If the player was lying, they pick up the entire discard stack. If they were telling the truth, the accuser takes the punishment.

The goal is deceptively simple: **empty your hand before anyone else does.**

---

## 🕹️ The Interrogation Cycle

<div align="center">
<img src="./assets/turn-flow.svg" alt="Game Flow" width="100%" />
</div>

<br />

### Core Rules

1. **The Opening Deal**: 1–3 standard decks of 52 cards are shuffled and dealt evenly. The suspect dealt the earliest **Ace of Spades ($A\spadesuit$)** takes the opening turn.
2. **Locking the Claim**: The opener plays 1 or more cards face-down and locks the **Claimed Rank** (`2` through `Ace`). Every subsequent card played this round must be claimed as that rank.
3. **Turn Choices (45s Clock)**:
   - **ADD**: Play 1+ cards face-down claiming they match the round's locked rank.
   - **CHALLENGE**: Call out the previous suspect's play (*"Chal Jhootha!"*).
   - **SKIP**: Pass the turn to the next player.
4. **45-Second Continuous Timer**:
   - The table clock runs continuously on the authoritative server.
   - Reconnecting players receive an automatic **10-second safety cushion** if their remaining time has dropped below 10 seconds.
   - Disconnected players are skipped automatically on their turn to prevent table stalls.
5. **Burn & Reset**: If all active players consecutively skip back to the opener and the opener skips, the stack is **burned permanently**. The next player opens a fresh round with any rank of their choice.
6. **Confirmation of Victory**: When a player plays their last card, their win is **confirmed** once their final cards survive the subsequent player's turn without being caught. Confirmed winners step back as spectators while remaining players battle for runner-up positions.

---

## ⚡ System Architecture

<div align="center">
<img src="./assets/architecture-minimal.svg" alt="Architecture" width="100%" />
</div>

<br />

Chal Jhootha avoids heavy database polling or lock contention through an isolated actor-model loop:

- **Goroutine Room Actors**: Every room operates as an independent Go actor with an isolated channel inbox. Turn resolution, card shuffling, and challenge checks occur in RAM with zero lock contention.
- **Sub-5ms ClientHub**: The in-memory connection hub pushes real-time notifications (such as room invitations) directly to connected user sessions without polling delays.
- **Redis Presence Pipeline**: Ephemeral player heartbeats update Redis with sliding 45s TTLs. Online friend rosters are fetched in single-roundtrip `MGet` batches.
- **Asynchronous Write-Behind Worker**: Completed matches and user statistics are written to PostgreSQL out-of-band via an asynchronous persistence queue, ensuring database latency never interrupts the live card table.

---

## 💎 Features

| Feature | Details |
| :--- | :--- |
| **Tactile Playing Card Avatars** | 6 custom visual deck avatars (`A♠`, `K♥`, `Q♦`, `J♣`, `JR★`, `JB★`) with authentic suit accents. |
| **Instant Room Invites** | Push-notified room invites pop in the recipient's navbar in under 5 milliseconds. |
| **10-Year Permanent Sessions** | Registered players stay logged in forever with background PostgreSQL session cleanup. |
| **Optimistic Social Actions** | Instant friend request acceptances, declines, and debounced player search. |
| **Integrated Voice Mesh** | Peer-to-peer WebRTC mesh voice chat for up to 8 players with Coturn fallback. |
| **Adaptive DB Connection Pool** | Configurable `DB_MAX_OPEN_CONNS` and `DB_MAX_IDLE_CONNS` designed for high-concurrency match loads. |

---

## 🚀 Quickstart

### 1. Launch with Docker Compose

```bash
git clone https://github.com/AbhaySingh002/chal-jhootha.git
cd chal-jhootha
docker compose up --build
```

*This spins up PostgreSQL 16, Redis 7, and the Go API server at `http://localhost:10000` with automated database migrations.*

### 2. Launch the Web Interface

In another terminal window:

```bash
cd chal-jhootha-web
bun install
bun run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 👥 Local Multiplayer Testing

To test a full match between two players on one computer:

1. **Host (Player 1)**:
   - Open `http://localhost:5173`.
   - Enter alias `INSPECTOR` and click **CREATE ROOM**.
   - Note down the 4-letter Case File code (e.g. `7K2P`).
2. **Opponent (Player 2)**:
   - Open a **Private / Incognito Window** at `http://localhost:5173`.
   - Enter alias `SUSPECT`, type the room code `7K2P`, and click **JOIN ROOM**.
3. **Start Game**:
   - In the Host's lobby, choose your deck configuration (1–3 decks) and click **COMMENCE INTERROGATION**.

---

## 📁 Repository Structure

```
chal-jhootha/
├── assets/                          # Bespoke vector assets, cards, and diagrams
├── chal-jhootha-server/             # Authoritative Go HTTP & WebSocket server
│   ├── cmd/server/                  # Main entry point & service wiring
│   ├── internal/
│   │   ├── auth/                    # Permanent sessions, profiles & invites
│   │   ├── live/                    # Redis presence & atomic MGet batching
│   │   ├── room/                    # Actor-based room loop & turn timer
│   │   ├── rules/                   # Isomorphic card logic & win evaluation
│   │   ├── store/                   # PostgreSQL migrations & connection pool
│   │   └── transport/               # WebSockets, rate limiting & ClientHub
│   └── Dockerfile                   # Multi-stage production Go build
│
├── chal-jhootha-web/                # React 19 client application
│   ├── src/                         # Tactile UI components, pages & store
│   └── shared/                      # Shared TypeScript rules & event contracts
│
└── compose.yaml                     # Local PostgreSQL + Redis + API orchestration
```

---

<details>
<summary><strong>⚙️ Production Environment Variables</strong></summary>

<br />

#### API Server (`chal-jhootha-server`)
```bash
PORT=10000
DATABASE_URL=postgres://user:pass@host:5432/dbname?sslmode=require
REDIS_URL=rediss://default:pass@host:6379
FRONTEND_ORIGINS=https://bluff-game.vercel.app
COOKIE_SECURE=1
COOKIE_SAME_SITE=none
DB_MAX_OPEN_CONNS=25
DB_MAX_IDLE_CONNS=10
ROOM_IDLE_TTL=24h
GUEST_SESSION_SECRET=generate_a_secure_random_string
```

#### Web Client (`chal-jhootha-web`)
```bash
VITE_API_ORIGIN=https://api.bluff-game.com
VITE_WS_URL=wss://api.bluff-game.com/ws
```

#### WebRTC Voice Relay (Coturn)
```bash
TURN_URLS=turn:turn.bluff-game.com:3478?transport=udp,turns:turn.bluff-game.com:5349?transport=tcp
TURN_SHARED_SECRET=your_coturn_secret
```

</details>

---

<div align="center">

Crafted with care by **Abhay Kumar Singh** and contributors.  
Distributed under the **[MIT License](LICENSE)**.

</div>
