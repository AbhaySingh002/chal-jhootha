# Chal Jhootha — Full Codebase Audit

> **Read-only audit.** No files were modified. This covers UI quality, UX friction, dead/duplicate code, and actionable suggestions organized by severity.

---

## 🔴 Critical — Bugs & Functional Dead Points

### 1. `profile.ts` import at EOF (dead/broken placement)
**File:** [`profile.ts:117`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/lib/profile.ts#L117)

```ts
// Line 117 — AFTER all functions that use apiURL
import { apiURL } from './api';
```

The `import` statement is at the **bottom** of the file, after every function that already calls `apiURL()`. This works only because of ES module hoisting, but it's a maintenance landmine — any tool that transpiles to CJS (or a human reading top-down) will be confused. **Move it to line 1.**

---

### 2. `handleLeaveGame` does nothing if connection is lost
**File:** [`GameRoom.tsx:342-344`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L342-L344)

```ts
const handleLeaveGame = () => {
  leaveRoom();   // ← silent no-op when connectionStatus !== 'CONNECTED'
};
```

`leaveRoom()` in [`gameStore.ts:185-191`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/state/gameStore.ts#L185-L191) early-returns if `connectionStatus !== 'CONNECTED'` or `pendingAction` is set. If the user taps **Leave** while reconnecting, nothing happens — no error, no navigation, no feedback. The button appears functional but is silently dead.

**Suggestion:** When disconnected, bypass the WS event and do a local `resetSession()` + `setLocation('/')`.

---

### 3. Verdict "Return to Lobby" button fires `leaveRoom()` — wrong action
**File:** [`GameRoom.tsx:602-608`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L602-L608)

```tsx
<button onClick={handleLeaveGame} className="...">Return to Lobby</button>
```

The label says "Return to Lobby" but it fires `leaveRoom()`, which sends a `leave_room` WS event and triggers `resetSession()` (erasing room code + token), then navigates home. The user expects to go back to the lobby screen, not leave the room entirely. This is a **UX mislabel** — should either:
- Rename to "Leave Room" / "Return Home", OR
- Actually call `resetToLobby()` if the intent is to stay in the room

---

### 4. `GameRoom` silent redirect creates a confusing flash
**File:** [`GameRoom.tsx:209-213`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L209-L213)

```ts
useEffect(() => {
  if (hasAttemptedJoin.current && !roomCode && !gameState) {
    setLocation('/');   // ← no message, no transition
  }
}, [gameState, roomCode, setLocation]);
```

When a join attempt fails silently (e.g., invalid room code via direct URL), the user is teleported back to Home with no indication of what happened. They see a brief flash of the "Connecting" spinner, then suddenly Home. No error toast, no explanation.

**Suggestion:** Set `lastError` before redirecting, or show a transient error banner on Home.

---

## 🟠 High — Duplicate Functions & Redundant Logic

### 5. `winRate()` duplicated across Profile and PublicProfile
**Files:**
- [`Profile.tsx:36-40`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/Profile.tsx#L36-L40)
- [`PublicProfile.tsx:85-88`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/PublicProfile.tsx#L85-L88)

Identical computation, different function names (`winRate` vs inline `rate`). Extract to a shared util.

---

### 6. `useSession()` hook called independently in 6+ components
**Files:** `Home.tsx`, `GameRoom.tsx`, `Lobby.tsx`, `Navbar.tsx`, `Profile.tsx`, `PublicProfile.tsx`

Each component independently fires `fetchSession()` (a network call) on mount. On a page like `GameRoom` → `Lobby`, that's two separate `/api/auth/session` fetches on the same render. No caching, no dedup.

**Suggestion:** Replace with a context provider or SWR/react-query cache so the session is fetched once per mount and shared.

---

### 7. Two separate `ThemeToggle` instances on Lobby page
**Files:**
- [`Lobby.tsx:158`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/Lobby.tsx#L158) — in the lobby header
- Theme toggle is also architecturally independent per page — Navbar has its own, Lobby has its own, PageHeader has its own.

Not harmful, but each `ThemeToggle` independently calls `initialTheme()` on mount (reads localStorage). Consistent, but wasteful.

---

### 8. `selectedCards` filtering done twice on every render
**File:** [`GameRoom.tsx:328-330`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L328-L330) AND [`GameRoom.tsx:335`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L335)

```ts
// Line 328: filter for rendering
const currentSelectedCards = gameState?.phase === 'playing'
  ? selectedCards.filter((id) => myHand.some((card) => card.id === id))
  : [];

// Line 335: identical filter inside toggleSelect
const current = cards.filter((cardId) => myHand.some((card) => card.id === cardId));
```

Same O(n²) filter, executed both on render AND inside every card tap. Should reconcile once.

---

### 9. `createFriendRequest` used in 3 separate components with duplicated error handling
**Files:**
- [`Lobby.tsx:122-131`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/Lobby.tsx#L122-L131)
- [`Profile.tsx:167-178`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/Profile.tsx#L167-L178)
- [`PublicProfile.tsx:39-51`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/PublicProfile.tsx#L39-L51)

Each wraps the same API call in its own try/catch with slightly different error messages. A shared `useFriendRequest()` hook would eliminate 30+ lines of duplication.

---

## 🟡 Medium — UX Friction Points

### 10. No haptic/visual feedback when tapping a card
**File:** [`Card.tsx`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/Card.tsx)

Cards have `whileTap={{ scale: 0.96 }}` but on mobile the response feels subtle. The only selection indicator is a `ring-2 ring-caution-yellow` and a `shadow` change — no sound cue, no color flash, no bounce. On a crowded hand (10+ cards), it's easy to tap and not realize a card was (de)selected.

**Suggestion:** Add a brief color pulse (background flash to yellow at 20% opacity for 120ms) or a stronger `whileTap` spring bounce.

---

### 11. Claim composer UX on mobile is cramped
**File:** [`ActionBar.tsx:65-81`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/ActionBar.tsx#L65-L81)

The claim declaration grid (`grid-cols-[minmax(0,1fr)_5rem_auto]`) with a `<select>` + `<input type="number">` + remove button is tight on a 390px viewport. The `<input type="number">` with `inputMode="numeric"` brings up the full numeric keyboard, but the input is only `5rem` wide — fat-finger-prone.

**Suggestion:** Make the count input wider on mobile, or use stepper buttons (−/+) instead of a raw number input.

---

### 12. No scroll-to-top when navigating between pages
**File:** [`App.tsx`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/App.tsx)

Wouter doesn't auto-scroll to top on route change. If a user scrolls deep on Profile then clicks "Play" to go Home, they land mid-scroll on the Home page.

**Suggestion:** Add a `useEffect` with `window.scrollTo(0, 0)` on route change, or a small Wouter wrapper.

---

### 13. Room invite polling at 10-second intervals is aggressive
**File:** [`Navbar.tsx:32`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/Navbar.tsx#L32)

```ts
const timer = window.setInterval(refresh, 10_000);
```

Every 10 seconds, every page that renders `<Navbar>` fires `GET /api/room-invites`. On Home + Profile both open in tabs, that's 6 requests/minute per tab. This is expensive for a feature most users never actively wait for.

**Suggestion:** Increase to 30s, or use a WS push for incoming invites (you already have the socket infrastructure).

---

### 14. Voice error banner persists with no dismiss action
**File:** [`GameRoom.tsx:476-480`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L476-L480)

```tsx
{voiceError && !voiceUnavailable ? (
  <p role="alert" className="...bg-evidence-red...">{voiceError}</p>
) : null}
```

If mic access is denied, this red banner stays visible for the entire game session with no way to dismiss it. It takes up valuable table area real estate.

**Suggestion:** Add a dismiss `X` button, or auto-fade after 8 seconds.

---

### 15. Friends drawer has no animation (instant mount/unmount)
**File:** [`Lobby.tsx:390-478`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/Lobby.tsx#L390-L478)

The friends invite drawer uses a raw conditional render (`{showFriendsDrawer && (<div>...`)). Unlike the `PlayerRosterSheet` (which uses `AnimatePresence` with spring transitions), this drawer snaps in/out instantly.

**Suggestion:** Wrap in `AnimatePresence` with a slide-up + backdrop-fade to match the rest of the app's motion language.

---

### 16. No loading state while creating a room
**File:** [`Home.tsx:43-61`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/Home.tsx#L43-L61)

`handleCreate` sets `isCreating(true)` and text changes to "Creating Room...", but there's an 8-second timeout before showing an error. During those 8 seconds, the button is disabled but there's no spinner, no progress bar — just static text. On slow connections, it feels frozen.

**Suggestion:** Add a pulsing dot or spinner icon next to "Creating Room..."

---

## 🔵 Low — Style & Polish

### 17. Inconsistent border-radius language
The codebase mixes `rounded-xl`, `rounded-2xl`, `rounded-lg`, `rounded-md`, and raw `border-radius` in CSS. Cards use `rounded-xl sm:rounded-2xl`, brutalist cards use `border-radius: 0.875rem` (≈14px), buttons use `0.625rem` (10px), inputs use `0.625rem`. This is close to the design-taste-frontend "shape consistency lock" — it mostly works, but a couple of rogue radii break the pattern.

---

### 18. `Stack.tsx` empty state shows "0 stack" — odd copy
**File:** [`Stack.tsx:12`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/Stack.tsx#L12)

```ts
const emptyClaimLabel = '0 stack';
```

Displayed as a badge below the empty dashed-border card. "0 stack" reads oddly — should be "Empty" or "No cards played" or just hide the badge entirely.

---

### 19. `PlayerSeat` has hardcoded 2-letter avatar fallback
**File:** [`PlayerSeat.tsx:16`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/components/PlayerSeat.tsx#L16)

```ts
const avatarMark = avatarMarks[player.avatarId || ''] || player.name.substring(0, 2).toUpperCase();
```

If a player's name is 1 character, this returns that single character with no padding. The avatar box would look lopsided. Minor, but worth a `padStart` or a minimum of 2 chars.

---

### 20. `Home.tsx` guest alias input has no visual link to Create/Join
When a guest enters their name in the "Player Alias" field and then scrolls down to "Join Room," there's no visual indicator that the alias they entered above is what will be used. The two inputs (alias + room code) are visually disconnected. A subtle "Playing as: XXXXX" echo below the join button would help.

---

## 🟣 Architecture & Performance

### 21. `GameRoom.tsx` is a 616-line mega-component
This single file handles:
- Pre-game states (error, name entry, connecting, timeout)
- Lobby delegation
- Voice controls (inline sub-component)
- Card flight animation orchestration
- Reaction system (state, events, rendering)
- Player seat layout
- Action bar delegation
- Verdict overlay

**Suggestion:** Extract `VoiceControls`, `ReactionSystem`, `VerdictOverlay`, and the pre-game screens into separate components. Each is self-contained and would reduce `GameRoom` to ~200 lines of orchestration.

---

### 22. `useLayoutEffect` for animation snapshots may cause jank
**File:** [`GameRoom.tsx:269-320`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L269-L320)

`useLayoutEffect` blocks paint. This one runs on every `gameState` change and calls `queueFlights()` which does `requestAnimationFrame` → DOM queries → state updates. The RAF inside a layout effect means:
1. Paint is blocked while the effect runs (up to the RAF scheduling)
2. Then RAF fires after paint, potentially causing a flash of un-animated cards

**Suggestion:** Move to `useEffect` — the animation snapshot comparison doesn't need to block paint.

---

### 23. `processedChallengeSeqsRef` grows unbounded
**File:** [`GameRoom.tsx:150`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/pages/GameRoom.tsx#L150)

```ts
const processedChallengeSeqsRef = useRef(new Set<number>());
```

This `Set` accumulates every challenge sequence number for the lifetime of the component. In a long session with many rounds, this grows indefinitely. Should be pruned when the phase changes or when the last processed seq exceeds the stored ones by a threshold.

---

### 24. No error boundary per route — one crash kills the whole app
**File:** [`App.tsx`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/App.tsx)

The single `ErrorBoundary` in [`main.tsx`](file:///Users/abhaykumarsingh/Desktop/Projects/BLUFF/chal-jhootha-web/src/main.tsx) wraps the entire app. If Profile crashes, the game room is also gone. Route-level error boundaries would contain blast radius.

---

## 📊 Summary Table

| # | Severity | Area | File | Issue |
|---|----------|------|------|-------|
| 1 | 🔴 Critical | Dead code | `profile.ts` | `import` at EOF |
| 2 | 🔴 Critical | UX dead point | `GameRoom.tsx` | Leave button no-op when disconnected |
| 3 | 🔴 Critical | UX mislabel | `GameRoom.tsx` | "Return to Lobby" fires leave instead |
| 4 | 🔴 Critical | UX dead point | `GameRoom.tsx` | Silent redirect with no error feedback |
| 5 | 🟠 High | Duplicate | `Profile.tsx` / `PublicProfile.tsx` | `winRate()` duplicated |
| 6 | 🟠 High | Performance | Multiple files | `useSession()` fires separate fetches per component |
| 7 | 🟠 High | Duplicate | Multiple files | `ThemeToggle` independently mounted 3× |
| 8 | 🟠 High | Performance | `GameRoom.tsx` | `selectedCards` filtered twice per render |
| 9 | 🟠 High | Duplicate | 3 files | `createFriendRequest` error handling repeated 3× |
| 10 | 🟡 Medium | UX | `Card.tsx` | Weak selection feedback on mobile |
| 11 | 🟡 Medium | UX | `ActionBar.tsx` | Claim composer cramped on mobile |
| 12 | 🟡 Medium | UX | `App.tsx` | No scroll-to-top on route change |
| 13 | 🟡 Medium | Performance | `Navbar.tsx` | 10-second invite polling too aggressive |
| 14 | 🟡 Medium | UX | `GameRoom.tsx` | Voice error banner undismissable |
| 15 | 🟡 Medium | UX polish | `Lobby.tsx` | Friends drawer has no animation |
| 16 | 🟡 Medium | UX | `Home.tsx` | No spinner during room creation wait |
| 17 | 🔵 Low | Style | `index.css` | Inconsistent border-radius tokens |
| 18 | 🔵 Low | Copy | `Stack.tsx` | "0 stack" label reads oddly |
| 19 | 🔵 Low | Edge case | `PlayerSeat.tsx` | 1-char name avatar fallback |
| 20 | 🔵 Low | UX | `Home.tsx` | Guest alias not echoed near Join button |
| 21 | 🟣 Arch | Maintainability | `GameRoom.tsx` | 616-line mega-component needs extraction |
| 22 | 🟣 Arch | Performance | `GameRoom.tsx` | `useLayoutEffect` may cause paint jank |
| 23 | 🟣 Arch | Memory | `GameRoom.tsx` | Unbounded `processedChallengeSeqsRef` set |
| 24 | 🟣 Arch | Resilience | `App.tsx` | No per-route error boundaries |

---

## ✅ What's Already Good

- **Design system consistency** — The brutalist card/button/input token system is extremely well-executed. The `--color-*` custom property architecture with light/dark mode is clean and correct.
- **Safe area handling** — Every edge (game shell, bottom bar, overlays) correctly uses `env(safe-area-inset-*)`. This is rare and well done.
- **WebSocket reliability** — The `socket.ts` reconnection with exponential backoff, reliable action queue, and `pendingReliableEvents` retry map is production-grade networking code.
- **Reduced motion respect** — Every animated component checks `useReducedMotion()`. The CSS also has `@media (prefers-reduced-motion: reduce)`. This is complete.
- **Card flight animation** — The `CardFlightLayer` + `queueFlights` system is genuinely impressive. Source → target interpolation with stagger delays and per-card reveal concealment is polished game UX.
- **Hand density adaptation** — The `getHandDensity()` breakpoint system (`phone` / `regular` / `short`) with dynamic arc calculations is smart responsive game design.
- **Voice P2P** — Full WebRTC peer mesh with ICE candidate relay over WS, TURN server fetch, and graceful degradation when rooms exceed 8 players. Clean implementation.

---

> **Next step:** Tell me which group of fixes to prioritize and I'll implement them.
