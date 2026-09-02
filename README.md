# 🃏 CHAL JHOOTHA // BLUFF
### High-Stakes Real-Time Multiplayer Interrogation Card Game

<div align="center">

```
   ██████╗██╗  ██╗ █████╗ ██╗         ██╗██╗  ██╗ ██████╗  ██████╗████████╗██╗  ██╗ █████╗ 
  ██╔════╝██║  ██║██╔══██╗██║         ██║██║  ██║██╔═══██╗██╔════╝╚══██╔══╝██║  ██║██╔══██╗
  ██║     ███████║███████║██║         ██║███████║██║   ██║██║  ███╗  ██║   ███████║███████║
  ██║     ██╔══██║██╔══██║██║    ██   ██║██╔══██║██║   ██║██║   ██║  ██║   ██╔══██║██╔══██║
  ╚██████╗██║  ██║██║  ██║███████╗╚█████╔╝██║  ██║╚██████╔╝╚██████╔╝  ██║   ██║  ██║██║  ██║
   ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚════╝ ╚═╝  ╚═╝ ╚═════╝  ╚═════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝
```

[![Go Version](https://img.shields.io/badge/Go-1.24-00ADD8?style=for-the-badge&logo=go&logoColor=white)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.2-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-Live_State-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![WebSocket](https://img.shields.io/badge/WebSocket-Native_Sub--5ms-010101?style=for-the-badge&logo=socket.io&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
[![WebRTC](https://img.shields.io/badge/WebRTC-Peer_Voice_Mesh-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

<p align="center">
  <strong>Deceive opponents. Spot the bluff. Interrogate your friends. Confirm your victory.</strong><br>
  A brutalist, low-latency multiplayer card game built with an Actor-based Go engine, WebSockets, and React 19.
</p>

[Quickstart](#-quickstart) •
[Architecture](#-system-architecture) •
[Game Rules](#-game-rules--turn-lifecycle) •
[Features](#-key-features) •
[Deployment](#-deployment--production-contract)

</div>

---

## ⚡ System Architecture

Chal Jhootha is engineered around an **Actor Model** and a **Write-Behind Persistence Pipeline**, guaranteeing microsecond in-memory gameplay loop execution with zero database write stall:

```mermaid
flowchart TD
    subgraph Clients["Frontend Clients (React 19 + Zustand)"]
        P1["Player 1 (Host)"]
        P2["Player 2"]
        PN["Player N..."]
    end

    subgraph TransportGateway["Transport Gateway (Go Chi + WebSockets)"]
        WS["WebSocket Handler (/ws)"]
        HUB["ClientHub (Thread-Safe User Registry)"]
        AUTH["Auth & Session Service"]
    end

    subgraph Engine["Game Engine Core (Go)"]
        ROUTER["Room Manager"]
        ACTOR["In-Memory Room Actor (Channel Inbox)"]
        TIMER["45s Turn Clock & 10s Reconnect Cushion"]
    end

    subgraph LiveStore["Volatile Real-Time Store (Redis)"]
        PRESENCE["Live Presence (cj:presence:*)"]
        INVITES["Instant Room Invites (cj:invite:*)"]
        LEASES["Distributed Room Leases"]
    end

    subgraph DurableStore["Durable Account & History (PostgreSQL)"]
        PERSIST_QUEUE["Persistence Worker Queue"]
        DB[(PostgreSQL 16)]
    end

    P1 <-->|WSS sub-5ms| WS
    P2 <-->|WSS sub-5ms| WS
    PN <-->|WSS sub-5ms| WS

    WS --> HUB
    WS <--> ROUTER
    ROUTER <--> ACTOR
    ACTOR <--> TIMER

    AUTH <-->|MGet Batching| PRESENCE
    AUTH <--> INVITES
    HUB -.->|Real-Time Push| P1
    HUB -.->|Real-Time Push| P2

    ACTOR -->|Sequence-Guarded Snapshots| PERSIST_QUEUE
    PERSIST_QUEUE -->|Async Non-Blocking Flush| DB
```

### Architectural Highlights
- **In-Memory Room Actor**: Every room executes in a dedicated Go goroutine serialized through an isolated channel `Inbox`. Eliminates mutex lock contention and concurrency hazards.
- **Write-Behind Persistence**: Turn state transitions are applied instantly in RAM and written asynchronously to PostgreSQL with sequence guards (`rooms.seq <= EXCLUDED.seq`). Database latency never stalls the active game table.
- **ClientHub Routing**: A synchronized connection hub routes server-originated social notifications (e.g. instant room invites) directly to connected users in sub-5ms.
- **Batched Redis Presence**: Client heartbeats maintain ephemeral presence records with sliding 45-second TTLs, fetched in single-roundtrip `MGet` pipelines.

---

## 🕹️ Game Rules & Turn Lifecycle

Bluff (popularly known as *Chal Jhootha* or *Cheat*) is a card game of deception and interrogation:

```mermaid
stateDiagram-v2
    [*] --> DealPhase: Host Commences Interrogation
    DealPhase --> RoundOpen: Sequential Deal (Earliest Ace of Spades Opens)
    
    RoundOpen --> PlayingTurn: Opener plays 1+ cards & locks Claimed Rank
    
    state PlayingTurn {
        [*] --> AwaitingAction: 45s Continuous Turn Timer
        AwaitingAction --> ActionAdd: Play 1+ Cards (Same Claimed Rank)
        AwaitingAction --> ActionChallenge: Challenge Top Play
        AwaitingAction --> ActionSkip: Skip Turn
    }

    ActionAdd --> CheckWin
    ActionSkip --> CheckBurn: All active players skipped?
    
    CheckBurn --> BurnStack: Yes (Stack permanently removed)
    CheckBurn --> NextPlayerTurn: No (Turn passes)
    
    ActionChallenge --> ResolveChallenge
    state ResolveChallenge {
        BluffCaught --> PickUpStack1: 1+ cards dishonest (Bluffer picks up stack)
        HonestPlay --> PickUpStack2: All cards honest (Challenger picks up stack)
    }

    PickUpStack1 --> RoundOpen: Challenger opens next round
    PickUpStack2 --> RoundOpen: Original player opens next round
    BurnStack --> RoundOpen: Next player opens fresh round

    CheckWin --> ConfirmedWinner: Hand emptied & survives 1 round
    ConfirmedWinner --> PlayingTurn: Remaining players continue until Target Winners
    PlayingTurn --> Finished: Configured Winners Reached
    Finished --> [*]
```

### Turn Mechanics & Timer Resilience
| Rule | Specification |
| :--- | :--- |
| **Opener Privilege** | Determined by the earliest dealt **Ace of Spades** ($A\spadesuit$) in clockwise deal order. |
| **Claim Locking** | The opener claims a single rank (`2` through `Ace`). All subsequent plays in that round must claim that same rank. |
| **Turn Clock** | **45-second continuous timer**. The clock runs on the server table clock and does not freeze on disconnect. |
| **Reconnect Cushion** | If a disconnected player reconnects with under 10 seconds remaining, the server grants a **one-time 10-second safety cushion**. |
| **Instant Offline Skips** | If a player is already disconnected when their turn begins, the server **instantly skips** them to keep table momentum alive. |
| **Burn Condition** | When all active players skip consecutively back to the opener and the opener skips, the stack is **burned** permanently from the game. |
| **Victory Condition** | When a player empties their hand, their win is **confirmed** once their final play survives the subsequent player's turn without being caught. |

---

## 💎 Key Features

<div align="center">

| Feature | Description | Stack |
| :--- | :--- | :--- |
| **Tactile Deck Avatars** | Custom playing card avatars (`[ A ♠ ]`, `[ K ♥ ]`, `[ Q ♦ ]`, `[ J ♣ ]`, `[ JR ★ ]`, `[ JB ★ ]`) with neo-brutalist tactile rings. | React 19 / CSS |
| **Low-Latency WebSockets** | Monotonic sequence delivery, instant state reconciliation, and connection recovery. | Go / WebSockets |
| **Permanent Sessions** | Registered users remain signed in forever (10-year rolling TTL) with automated hourly database pruning. | PostgreSQL / Go |
| **Real-Time Social Invites** | Sub-5ms room invite delivery via `ClientHub` push notifications. | Redis / WebSockets |
| **WebRTC Voice Mesh** | Integrated peer-to-peer voice communications with coturn relay fallback for up to 8 suspects. | WebRTC / Coturn |
| **Adaptive Connection Pool** | Configurable database connection scaling (`DB_MAX_OPEN_CONNS`) tuned for concurrent match traffic. | PostgreSQL (pgx) |

</div>

---

## 🚀 Quickstart

### Prerequisites
- [Docker](https://www.docker.com/) and Docker Compose
- [Bun](https://bun.sh/) (or Node.js 20+)
- [Go 1.24+](https://go.dev/) *(optional if using Docker)*

### 1. Launch the Database & Backend Server

Clone the repository and start the Docker container stack:

```bash
git clone https://github.com/AbhaySingh002/chal-jhootha.git
cd chal-jhootha
docker compose up --build
```

> **Note**: This spins up PostgreSQL and the Go API server at `http://localhost:10000`. Database migrations are executed automatically upon boot.

### 2. Launch the Frontend

In a second terminal window:

```bash
cd chal-jhootha-web
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 👥 Local Multiplayer Testing (2+ Players)

To simulate a live multiplayer interrogation table on your local machine:

1. **Host (Player 1)**:
   - Navigate to [http://localhost:5173](http://localhost:5173).
   - Enter alias: `INSPECTOR_ROY`.
   - Click **CREATE ROOM** $\rightarrow$ Note the 4-character Room Code (e.g. `X7K2`).
2. **Opponent (Player 2)**:
   - Open a **Private / Incognito Window** at [http://localhost:5173](http://localhost:5173).
   - Enter alias: `SHADOW_BLUFFER`.
   - Enter the Room Code (`X7K2`) and click **JOIN ROOM**.
3. **Commence Game**:
   - On the Host's screen, adjust deck count (1–3 decks) and target winners, then click **COMMENCE INTERROGATION**.

---

## 📁 Repository Map

```
BLUFF/
├── chal-jhootha-server/             # Authoritative Go HTTP & WebSocket Server
│   ├── cmd/server/main.go           # Server entry point & graceful shutdown
│   ├── internal/
│   │   ├── auth/                    # Permanent sessions, profile & room invites
│   │   ├── live/                    # Redis presence & ephemeral state
│   │   ├── room/                    # Actor-based Room Engine & persistence worker
│   │   ├── rules/                   # Card dealing, hand evaluation & win logic
│   │   ├── store/                   # PostgreSQL store & schema migrations
│   │   └── transport/               # WebSocket handler, rate limiting & ClientHub
│   └── Dockerfile                   # Production container build
│
├── chal-jhootha-web/                # React 19 Frontend Application
│   ├── src/
│   │   ├── components/              # Brutalist UI, Card, Table, Action Bar & Lobby
│   │   ├── hooks/                   # useTurnTimer, audio, and view transition hooks
│   │   ├── pages/                   # GameRoom, Home, Profile, and Public Dossier
│   │   ├── state/                   # Zustand gameStore with monotonic reconciliation
│   │   └── ws/                      # WebSocket client with reliable action retries
│   └── shared/                      # Isomorphic game rules & TypeScript event schemas
│
└── docker-compose.yml               # Local infrastructure orchestration
```

---

## 🌐 Deployment & Production Contract

The frontend and API are fully decoupled and can be deployed independently.

### Production Environment Variables

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
```

#### Frontend Client (`chal-jhootha-web`)
```bash
VITE_API_ORIGIN=https://api.bluff-game.com
VITE_WS_URL=wss://api.bluff-game.com/ws
```

#### Optional WebRTC Voice Relay (Coturn)
```bash
TURN_URLS=turn:turn.bluff-game.com:3478?transport=udp,turns:turn.bluff-game.com:5349?transport=tcp
TURN_SHARED_SECRET=your_static_auth_secret
```

---

## 🧪 Verification & Testing

Execute the comprehensive test suites across both server and client:

```bash
# Run server test suite (in-memory & integration)
cd chal-jhootha-server
go test -v -count=1 ./...

# Run frontend contract & store tests
cd ../chal-jhootha-web
bun test

# Validate production web build
npm run build
```

---

<div align="center">

Built with tactical brutality by **Abhay Kumar Singh** and contributors.  
Distributed under the **MIT License**.

</div>
