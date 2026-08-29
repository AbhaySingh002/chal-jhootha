# 🃏 CHAL JHOOTHA (BLUFF) - Online Multiplayer Card Game

A brutalist, real-time multiplayer card game built with **React**, **Go WebSocket**, PostgreSQL, and a shared game engine.

---

## 🚀 Quickstart

### 1. Start the local database and API

From the root directory, run:

```bash
docker compose up --build
```

This starts PostgreSQL and the API at `http://localhost:10000`. The API runs migrations automatically at startup.

### 2. Start the frontend

In another terminal:

```bash
cd chal-jhootha-web
bun install
bun run dev
```

- **Frontend (Web App):** [http://localhost:5173](http://localhost:5173)
- **Backend (Server & WS):** `http://localhost:10000` (Health check: [http://localhost:10000/healthz](http://localhost:10000/healthz))

---

## 🎮 How to Test

### Option A: Solo Test (1 Player)
1. Open [http://localhost:5173](http://localhost:5173) in your browser.
2. Enter an alias in **Guest Alias** (e.g. `AGENT_007`).
3. Click **CREATE ROOM**.
4. In the lobby, click **COMMENCE INTERROGATION** to deal the cards and start playing.

---

### Option B: Local Multiplayer (2+ Players)
1. **Player 1 (Host):**
   - Open [http://localhost:5173](http://localhost:5173).
   - Enter alias: `HOST_PLAYER`.
   - Click **CREATE ROOM** $\rightarrow$ Note down the 4-character **Case File Code** (e.g., `5PB8`).
2. **Player 2 (Opponent):**
   - Open a **New Incognito Window** (or another browser like Safari / Firefox) at [http://localhost:5173](http://localhost:5173).
   - Enter alias: `GUEST_PLAYER`.
   - Enter the 4-character **Case File Code** in the **Room Code** box and click **JOIN ROOM**.
3. **Start the Match:**
   - In Player 1's window, click **COMMENCE INTERROGATION** once all suspects appear in the list.

---

## 🧹 How to Clear Sessions & Reset State

### 1. Clear Client / Browser Session
If you want to leave your active room or reset your player identity:
- **Method 1 (Fastest via Console):**
  Open Browser DevTools (`F12` or `Cmd + Option + I`) $\rightarrow$ Console tab, and run:
  ```javascript
  sessionStorage.clear();
  location.href = '/';
  ```
- **Method 2 (UI):**
  Use an **Incognito / Private Window** for each new player test session. Closing the incognito window automatically wipes the session.
- **Method 3 (Application Tab):**
  DevTools $\rightarrow$ **Application** $\rightarrow$ **Session Storage** $\rightarrow$ Click **Clear All**.

---

### 2. Reset the local database

The local database lives in the named Docker volume. To reset it, stop the stack and remove that local volume:

```bash
docker compose down -v
```

## 👥 Registered Player Profiles

- Guests can continue to create or join any room by link and alias.
- Registered players choose a unique public handle (`3–16` lowercase letters, digits, or underscores), can edit their profile, view lifetime completed-game stats, and manage friend requests.
- Profiles are public by handle and never expose email addresses. Friend requests and recent registered opponents are available from **Profile**.

---

## 🕹️ Canonical Game Rules & Flow
1. **Host Configuration:** The host sets deck count (1–3 decks of 52) and winner count (1 to $N-1$, default 1) before the first start. The winner target is then fixed for every replay in that room; deck count may still be adjusted between games.
2. **Dealing & Starting Player:** The combined deck is shuffled and dealt evenly to all seated suspects (leftovers set aside). The player who was dealt the earliest Ace of Spades ($A\spadesuit$) in sequential deal order takes the first turn (random fallback if no $A\spadesuit$ was dealt).
3. **Opening a Round:** The active player selects 1+ cards face-down onto the central stack, announces a claimed rank (2–A). That rank is locked for the entire round.
4. **Turns (3 Options):**
   - **ADD:** Play 1+ further cards face-down, claiming the round's locked rank.
   - **CHALLENGE:** Call out the top play. If even 1 card fails to match the claimed rank, bluff is caught and bluffer picks up the whole stack (challenger starts next round). If honest, challenger picks up the whole stack (original player starts next round).
   - **SKIP:** Pass turn to the next active player.
5. **Skip-Around & Burn:** If all active players skip around back to the round opener, the opener can add another card to continue or skip. If the opener skips, the entire stack is **burned** permanently from the game, and the next player starts a fresh round with any rank.
6. **Winning:** When a suspect empties their hand, their win is confirmed once their last play survives the next player's turn without being overturned. Confirmed winners become spectators and are removed from play until the configured winner count is reached.
7. **Replay & Stats:** The host can return everyone to the same lobby and start a fresh game. Each completed game records one match played for registered participants and one win for each official winner.

---

## 📁 Repository Structure
- `chal-jhootha-web`: React 19 + Vite frontend with Tailwind CSS (v4), Framer Motion, WebRTC Voice, and Zustand store.
- `chal-jhootha-server`: Authoritative Go HTTP and WebSocket server with PostgreSQL migrations, idempotent match persistence, session auth, and a Docker image.
- `chal-jhootha-web/shared`: Pure game rules engine, schemas, and typed event contracts.
- `chal-jhootha-contracts`: Canonical wire protocol documentation and JSON schemas.

---

## Deployment contract

The frontend and API deploy independently. The Vercel project root directory is `chal-jhootha-web`; its `vercel.json` preserves SPA deep links.

Set these Vercel build-time variables:

```bash
VITE_API_ORIGIN=https://<render-service>.onrender.com
VITE_WS_URL=wss://<render-service>.onrender.com/ws
```

Set these Render service variables:

```bash
DATABASE_URL=<Render Postgres internal connection string>
FRONTEND_ORIGINS=https://<vercel-project>.vercel.app
COOKIE_SECURE=1
COOKIE_SAME_SITE=none
ROOM_IDLE_TTL=24h
GUEST_SESSION_SECRET=<long random secret, shared by every API instance>
LOG_FORMAT=json
LOG_LEVEL=info
```

Optional voice relay support uses coturn REST credentials. Configure both values
on the API (never expose the shared secret to the browser):

```bash
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SHARED_SECRET=<coturn static-auth-secret>
```

The API exposes lightweight process counters at `/api/metrics` for socket
payloads, room-action latency totals, and persistence retries/failures. Protect
that route at the edge before exposing a production service publicly.

The current release is deliberately a single stateful game gateway. Run one API
replica until Redis-backed room ownership and an outbox worker are deployed;
adding stateless replicas beforehand can split an active room. Voice is enabled
for rooms of up to eight players; for larger rooms, deploy an SFU such as
LiveKit rather than lifting the mesh-voice limit.

Use the same Render region for the API and Postgres. Configure an external monitor to request `/healthz` every five minutes when using a free Render web service. Free Render services can still restart, and free Render Postgres expires after 30 days without backups. Platform URLs use cross-site cookies, so moving later to matching `app.` and `api.` subdomains is the more reliable browser-auth setup.

For a full local PostgreSQL test run:

```bash
docker compose up -d postgres
cd chal-jhootha-server
TEST_DATABASE_URL=postgres://chal_jhootha:chal_jhootha_dev@localhost:5432/chal_jhootha?sslmode=disable go test ./...
```
