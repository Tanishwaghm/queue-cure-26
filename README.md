# Queue Cure '26

> Real-time patient queue management system — built for the **Wooble Queue Cure '26 Hackathon**

## 🚀 Quick Start

```bash
npm install
node server.js
```

Then open:
- **Receptionist:** `http://localhost:3000/receptionist.html`
- **Waiting Room:** `http://localhost:3000/waiting-room.html`
- **Landing:** `http://localhost:3000`

## 🏗 Architecture

```
Client A (Receptionist)          Server (Express + Socket.IO)          Client B (Waiting Room)
        |                                      |                                  |
        |── add_patient ──────────────────────>|                                  |
        |                                      |── queue_update ──────────────────>|
        |── call_next ───────────────────────>|                                  |
        |                                      |── queue_update ──────────────────>|
        |<──────────────────── queue_update ───|                                  |
```

Both screens receive the same `queue_update` event simultaneously. There is no polling.

## 📡 Socket Events

| Direction | Event | Payload | Description |
|-----------|-------|---------|-------------|
| Client → Server | `add_patient` | `{ name: string }` | Add patient to queue end |
| Client → Server | `call_next` | — | Dequeue next patient, set as current |
| Client → Server | `set_avg_time` | `{ minutes: number }` | Update avg consult time |
| Client → Server | `remove_patient` | `{ token: number }` | Remove specific token (mistake correction) |
| Client → Server | `reset_queue` | — | Clear entire queue |
| Server → All | `queue_update` | Full snapshot (see below) | Broadcast on any state change |

### `queue_update` snapshot shape

```json
{
  "queue": [
    { "token": 3, "name": "Priya Shah", "position": 1, "estimatedWaitMins": 12 }
  ],
  "currentToken": 2,
  "currentName": "Ravi Kumar",
  "avgConsultTime": 10,
  "nextTokenNum": 4,
  "servedCount": 1,
  "queueLength": 1
}
```

## ⏱ Wait Time Formula

Wait time is computed dynamically — never hardcoded.

```
waitForPatientAtPosition(i) =
  (i × avgConsultTime)                         // patients strictly ahead
  + max(0, avgConsultTime - elapsedForCurrent) // remaining time for patient being served
```

- `i = 0` → next in queue → wait = remaining current consult time
- `i = 1` → one ahead → wait = remaining + one full consult
- Refreshes every 30 seconds automatically, so displayed times decay in real time

## 🧠 Concurrency & Edge Cases

**Considered and handled:**

| Scenario | Handling |
|----------|----------|
| "Call Next" clicked on empty queue | Server-side guard: `if (state.queue.length === 0) return` |
| Two receptionists call next simultaneously | Node.js event loop is single-threaded — state mutations are atomic. No race condition. |
| Patient already being served when "Call Next" hits | Previous patient is replaced; `serviceStartedAt` resets. |
| Invalid avg time input (e.g., 0, 999, NaN) | Server validates: `1 ≤ minutes ≤ 120` |
| Patient name with XSS characters | `escHtml()` sanitizes all names before DOM insertion |
| Client disconnects mid-session | Socket.IO handles gracefully; state persists on server |
| Long name overflow | Names capped at 60 chars server-side; CSS `text-overflow: ellipsis` in UI |
| Token lookup for already-served patient | Detected via `token < nextTokenNum && not in queue` |

**Persistence note:** State lives in server memory. For production, add Redis or a DB. For the hackathon scope, single-session in-memory is sufficient.

## 📁 File Structure

```
queue-cure/
├── server.js              # Express + Socket.IO backend, queue state + all logic
├── package.json
└── public/
    ├── index.html          # Landing page (links to both views)
    ├── receptionist.html   # Screen 1: add patients, call next, set avg time
    └── waiting-room.html   # Screen 2: now serving, queue grid, token lookup
```

## 📊 Tech Stack

- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** Vanilla HTML/CSS/JS (zero frameworks, zero build step)
- **Real-time:** WebSocket via Socket.IO
- **Deployment:** Any Node host (Render, Railway, Glitch, etc.)

## 🎯 Evaluation Criteria Addressed

| Criteria | Implementation |
|----------|---------------|
| Live queue updates without refresh | `io.emit("queue_update", snapshot)` broadcasts to all clients instantly |
| Wait time from real data | Formula uses `avgConsultTime`, `serviceStartedAt`, and queue position — no hardcoding |
| Receptionist screen fast & mistake-proof | Enter key to add, instant feedback toasts, ✕ to remove mistakes, confirm before reset |
| Concurrency & edge cases | See table above; Node single-thread guarantees atomic state updates |
