const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname)));
app.use(express.json());

// ─── Queue State ───────────────────────────────────────────────────────────
let state = {
  queue: [],           // Array of { token, name, addedAt }
  currentToken: null,  // Token currently being served
  currentName: null,
  avgConsultTime: 10,  // minutes, receptionist can update
  nextTokenNum: 1,
  servedCount: 0,
  serviceStartedAt: null, // when current patient started being served
};

// ─── Helpers ───────────────────────────────────────────────────────────────
function computeWait(positionInQueue) {
  // position 0 = next to be called
  // Each patient ahead = avgConsultTime minutes
  // We also factor in remaining time for current patient if being served
  let waitMins = positionInQueue * state.avgConsultTime;

  if (state.serviceStartedAt && state.currentToken !== null) {
    const elapsedMs = Date.now() - state.serviceStartedAt;
    const elapsedMins = elapsedMs / 60000;
    const remaining = Math.max(0, state.avgConsultTime - elapsedMins);
    waitMins += remaining;
  } else {
    waitMins += state.avgConsultTime; // next patient hasn't started yet
  }

  return Math.round(waitMins);
}

function buildSnapshot() {
  return {
    queue: state.queue.map((p, i) => ({
      ...p,
      position: i + 1,
      estimatedWaitMins: computeWait(i),
    })),
    currentToken: state.currentToken,
    currentName: state.currentName,
    avgConsultTime: state.avgConsultTime,
    nextTokenNum: state.nextTokenNum,
    servedCount: state.servedCount,
    queueLength: state.queue.length,
  };
}

function broadcast() {
  io.emit("queue_update", buildSnapshot());
}

// ─── REST (thin, mainly for initial page load) ─────────────────────────────
app.get("/api/state", (req, res) => res.json(buildSnapshot()));

// ─── Socket Events ─────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  // Send full state on connect
  socket.emit("queue_update", buildSnapshot());

  // Receptionist: add patient
  socket.on("add_patient", ({ name }) => {
    if (!name || typeof name !== "string") return;
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;

    const patient = {
      token: state.nextTokenNum,
      name: trimmed,
      addedAt: Date.now(),
    };
    state.queue.push(patient);
    state.nextTokenNum++;
    broadcast();
  });

  // Receptionist: call next token
  socket.on("call_next", () => {
    if (state.queue.length === 0) return;

    const next = state.queue.shift();
    state.currentToken = next.token;
    state.currentName = next.name;
    state.serviceStartedAt = Date.now();
    state.servedCount++;
    broadcast();
  });

  // Receptionist: update average consult time
  socket.on("set_avg_time", ({ minutes }) => {
    const mins = parseInt(minutes);
    if (isNaN(mins) || mins < 1 || mins > 120) return;
    state.avgConsultTime = mins;
    broadcast();
  });

  // Receptionist: remove a patient from queue (mistake correction)
  socket.on("remove_patient", ({ token }) => {
    const before = state.queue.length;
    state.queue = state.queue.filter((p) => p.token !== token);
    if (state.queue.length !== before) broadcast();
  });

  // Receptionist: reset entire queue
  socket.on("reset_queue", () => {
    state.queue = [];
    state.currentToken = null;
    state.currentName = null;
    state.serviceStartedAt = null;
    state.servedCount = 0;
    state.nextTokenNum = 1;
    broadcast();
  });
});

// Rebroadcast every 30s so estimated times stay fresh for waiting patients
setInterval(() => {
  if (state.currentToken !== null || state.queue.length > 0) {
    broadcast();
  }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Queue Cure '26 running on http://localhost:${PORT}`);
  console.log(`  Receptionist: http://localhost:${PORT}/receptionist.html`);
  console.log(`  Waiting Room: http://localhost:${PORT}/waiting-room.html`);
});
