# Thought Process Sheet — Queue Cure '26

**Tanishka Kalghatgi · Wooble Hackathon Submission**

---

## 1. Problem Decomposition

The core challenge: two completely separate browser windows must show the same live state with zero user-initiated refresh. I broke it into three sub-problems:

1. **State management** — where does the truth live?
2. **Real-time sync** — how does a change on one screen reach the other instantly?
3. **Wait time computation** — how do I compute an estimate that's honest and dynamic?

---

## 2. Why Socket.IO (not polling, not SSE)

| Option | Latency | Bidirectional | Complexity |
|--------|---------|---------------|------------|
| HTTP polling | 1–5s lag | No (client always initiates) | Low, but wasteful |
| SSE | ~100ms | No (server → client only) | Medium |
| **WebSocket / Socket.IO** | **<50ms** | **Yes** | **Medium** |

Receptionist needs to **send** (add patient, call next) and **receive** updates. Waiting Room only needs to **receive**. WebSocket handles both naturally. Socket.IO adds auto-reconnect and fallback, useful for hackathon demos on unstable connections.

---

## 3. State Design Decision

I chose **single server-side state object** over per-client state because:

- The queue is a shared resource — there's one physical queue, not one per client
- Any client-side state diverges immediately on new connections
- One source of truth = zero sync bugs

```js
let state = {
  queue: [],           // ordered array of waiting patients
  currentToken: null,  // who is being seen RIGHT NOW
  avgConsultTime: 10,  // minutes, receptionist-adjustable
  nextTokenNum: 1,     // auto-increment, never reused
  servedCount: 0,
  serviceStartedAt: null, // timestamp when current patient was called
}
```

`serviceStartedAt` is the key insight — it lets me compute **remaining time** for the current patient, not just a static "10 minutes."

---

## 4. Wait Time Formula

**The naive approach:** `wait = position × avgTime` — wrong, because it doesn't account for how long the current patient has already been seen.

**My formula:**

```
For patient at index i in the queue (0 = next to be called):

estimatedWait(i) =
  max(0, avgConsultTime - elapsed)    ← remaining time for current patient
  + i × avgConsultTime                ← full consultations for everyone ahead
```

Where `elapsed = (now - serviceStartedAt) / 60000` minutes.

**Edge cases:**
- `elapsed > avgConsultTime` → `remaining = 0` (consultation ran over; don't subtract)
- No patient currently being served → `remaining = avgConsultTime` (next will get full slot)
- avgConsultTime changes mid-session → immediately recomputed on next broadcast

The server also re-broadcasts every 30 seconds automatically so the displayed wait times count down visually without any client-side timer logic.

---

## 5. Concurrency Analysis

Node.js is single-threaded with an event loop. All socket event handlers are synchronous mutations — this means **no two handlers can interleave**. Example:

```
T=0ms: receptionist A emits call_next
T=0ms: receptionist B emits call_next (queued behind A in the event loop)
T=1ms: handler A runs → shifts queue[0], sets currentToken = token 5
T=2ms: handler B runs → queue is now empty → guard fires, returns early
```

Result: only one patient gets called. No locking primitives needed.

**What would break this?** Async DB writes between reads and writes. If I added a database, I'd need optimistic locking or atomic transactions (e.g., a Redis `LMOVE` operation).

---

## 6. Edge Cases Handled

| Edge Case | How |
|-----------|-----|
| Call next on empty queue | Server guard: `if (queue.length === 0) return` |
| Two receptionists simultaneously | Node event loop serializes; see above |
| Invalid patient name (empty, XSS) | Server: trim + length check; client: `escHtml()` before DOM insertion |
| Invalid avg time (0, NaN, 999) | Server validates `1 ≤ minutes ≤ 120` |
| Patient added after "call next" clicked | They join the queue normally; wait times recompute |
| Consultation runs over time | `max(0, remaining)` clamps to zero — wait never goes negative |
| Client disconnects and reconnects | On reconnect, `socket.emit("queue_update", snapshot)` gives them full current state immediately |
| Token numbers after reset | `nextTokenNum` resets to 1 — avoids infinite growth |
| Looking up an already-served token | Detected by `token < nextTokenNum && not in current queue` |

---

## 7. Design Choices for the Receptionist Screen

The receptionist is under pressure — mistakes have real consequences (calling the wrong person, wrong time). I designed for:

- **Enter key** submits the add-patient form (fastest path)
- **✕ button** per patient to undo an accidental add
- **Confirm dialog** before reset (irreversible action)
- **Toast notifications** give instant feedback without interrupting flow
- **"Call Next" disabled** when queue is empty (prevents confusion)
- **Avg time** has its own Set button, separate from patient entry — reducing accidental changes

---

## 8. What I'd Add with More Time

1. **Persistent storage** — Redis or SQLite so the queue survives server restarts
2. **Multi-doctor support** — multiple `currentToken` slots, one per consultation room
3. **Patient check-in via QR code** — patients scan and self-add
4. **SMS/WhatsApp notifications** — alert patient when they're 2 spots away
5. **Analytics dashboard** — average wait drift over the day, peak hours, slow consultations
6. **Priority queue support** — emergency tokens jump the line

---

## 9. Performance Considerations

- Each `queue_update` broadcasts the full snapshot. For 1,000 concurrent patients this is ~10KB per event — fine for a clinic. For a hospital with 10,000 patients, I'd switch to **delta updates** (only broadcast what changed).
- The 30-second refresh timer re-broadcasts only when there's active state, never when the queue is empty and idle.
- No client-side timers or intervals — the server is the only time source. This prevents client clocks drifting out of sync with each other.
