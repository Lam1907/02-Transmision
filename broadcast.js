// ═══════════════════════════════════════════════
//   DANZAD MALDITOS — BROADCAST MODULE
//   State Manager · Firebase Real-Time Display
// ═══════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";

// ── Firebase Config ──────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyCxd2sdNJZaQ0Rq_mF6Sn1wLQra4Eabp1U",
  authDomain:        "danzad-maldit0s.firebaseapp.com",
  databaseURL:       "https://danzad-maldit0s-default-rtdb.firebaseio.com",
  projectId:         "danzad-maldit0s",
  storageBucket:     "danzad-maldit0s.firebasestorage.app",
  messagingSenderId: "774607843671",
  appId:             "1:774607843671:web:ec64876ba81b6b50acce12"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

// ── Firebase Paths (constants) ───────────────────────────
const PATH = {
  participants:           "participants",
  system:                 "system",
  votingActive:           "system/votingActive",
  currentRound:           "system/currentRound",
  resultsReady:           "system/resultsReady",
  votingDuration:         "system/votingDuration",
  timeRemaining:          "system/timeRemaining",
  votes:                  "votes",
  results:                "results",
  consolidatedPairs:      "results/consolidatedPairs",
  eliminatedParticipants: "results/eliminatedParticipants",
  eliminatedPairs:        "results/eliminatedPairs",
  winner:                 "results/winner"
};

// ── App State ────────────────────────────────────────────
const STATE = {
  WAITING:       "waiting",
  VOTING:        "voting",
  CONSOLIDATION: "consolidation",
  PAIRS:         "pairs",
  WINNER:        "winner"
};

let currentState        = null;
let participants        = {};
let consolidatedPairs   = {};
let votingActive        = false;
let resultsReady        = false;
let timerMax            = 300;
let pairRevealInProgress = false;
let knownElimParticipants = new Set();
let knownElimPairs        = new Set();

// ── DOM References ───────────────────────────────────────
const screens = {
  waiting:       document.getElementById("screen-waiting"),
  voting:        document.getElementById("screen-voting"),
  consolidation: document.getElementById("screen-consolidation"),
  pairs:         document.getElementById("screen-pairs"),
  winner:        document.getElementById("screen-winner")
};

const overlayElim  = document.getElementById("overlay-elimination");
const connDot      = document.getElementById("conn-dot");
const connLabel    = document.getElementById("conn-label");

// Voting
const timerValueEl    = document.getElementById("timer-value");
const timerProgressEl = document.getElementById("timer-progress");
const timerCircumf    = 2 * Math.PI * 54; // r=54
const votingRoundEl   = document.getElementById("voting-round-num");
const votingChipsEl   = document.getElementById("voting-chips");

// Waiting
const waitingGridEl   = document.getElementById("waiting-grid");

// Pairs
const pairsGridEl     = document.getElementById("pairs-grid");

// Consolidation pair reveal
const pairRevealEl    = document.getElementById("pair-reveal");

// Winner
const winnerCardsEl   = document.getElementById("winner-cards");
const winnerParticles = document.getElementById("winner-particles");

// ═══════════════════════════════════════════════
//   STATE MANAGER
// ═══════════════════════════════════════════════

function transitionTo(newState) {
  if (currentState === newState) return;

  console.log(`[Broadcast] ${currentState} → ${newState}`);

  // Deactivate all screens
  Object.values(screens).forEach(s => s.classList.remove("active"));

  currentState = newState;

  // Activate target
  if (screens[newState]) {
    screens[newState].classList.add("active");
  }

  // Per-state init
  switch (newState) {
    case STATE.WAITING:       initWaiting();       break;
    case STATE.VOTING:        initVoting();        break;
    case STATE.CONSOLIDATION: initConsolidation(); break;
    case STATE.PAIRS:         initPairs();         break;
    case STATE.WINNER:        initWinner();        break;
  }
}

// ═══════════════════════════════════════════════
//   FIREBASE LOGIC — determine active state
// ═══════════════════════════════════════════════

function evaluateState() {
  if (resultsReady && !votingActive && currentState !== STATE.WINNER) {
    // If winner exists, winner takes priority
    // Otherwise consolidation → pairs
    if (currentState !== STATE.CONSOLIDATION && currentState !== STATE.PAIRS) {
      transitionTo(STATE.CONSOLIDATION);
    }
    return;
  }

  if (votingActive) {
    transitionTo(STATE.VOTING);
    return;
  }

  // Default: waiting
  if (!votingActive && !resultsReady && currentState !== STATE.WINNER) {
    transitionTo(STATE.WAITING);
  }
}

// ═══════════════════════════════════════════════
//   LISTENER: PARTICIPANTS
// ═══════════════════════════════════════════════

function listenParticipants() {
  onValue(ref(db, PATH.participants), snap => {
    participants = snap.val() || {};
    refreshParticipantDisplays();
  });
}

function refreshParticipantDisplays() {
  // Refresh waiting grid if active
  if (currentState === STATE.WAITING) {
    renderWaitingGrid();
  }
  // Refresh voting chips if active
  if (currentState === STATE.VOTING) {
    renderVotingChips();
  }
  // Refresh pairs if active
  if (currentState === STATE.PAIRS) {
    renderPairsGrid();
  }
}

// ═══════════════════════════════════════════════
//   LISTENER: SYSTEM
// ═══════════════════════════════════════════════

function listenSystem() {
  onValue(ref(db, PATH.votingActive), snap => {
    votingActive = !!snap.val();
    evaluateState();
  });

  onValue(ref(db, PATH.resultsReady), snap => {
    resultsReady = !!snap.val();
    evaluateState();
  });

  onValue(ref(db, PATH.currentRound), snap => {
    const round = snap.val();
    if (votingRoundEl && round != null) {
      votingRoundEl.textContent = round;
    }
  });

  onValue(ref(db, PATH.votingDuration), snap => {
    const val = snap.val();
    if (val != null) timerMax = parseInt(val, 10) || 300;
  });

  onValue(ref(db, PATH.timeRemaining), snap => {
    const val = snap.val();
    if (val == null) return;
    const secs = Math.max(0, Math.round(val));
    updateTimer(secs);
  });
}

// ═══════════════════════════════════════════════
//   LISTENER: RESULTS
// ═══════════════════════════════════════════════

function listenResults() {
  onValue(ref(db, PATH.consolidatedPairs), snap => {
    consolidatedPairs = snap.val() || {};
    if (currentState === STATE.PAIRS) {
      renderPairsGrid();
    }
  });
}

// ═══════════════════════════════════════════════
//   LISTENER: ELIMINATIONS
// ═══════════════════════════════════════════════

function listenEliminations() {
  onValue(ref(db, PATH.eliminatedParticipants), snap => {
    const data = snap.val() || {};
    Object.keys(data).forEach(id => {
      if (!knownElimParticipants.has(id)) {
        knownElimParticipants.add(id);
        const p = data[id];
        showEliminationParticipant(p);
      }
    });
  });

  onValue(ref(db, PATH.eliminatedPairs), snap => {
    const data = snap.val() || {};
    Object.keys(data).forEach(key => {
      if (!knownElimPairs.has(key)) {
        knownElimPairs.add(key);
        const pair = data[key];
        showEliminationPair(pair);
      }
    });
  });
}

// ═══════════════════════════════════════════════
//   LISTENER: WINNER
// ═══════════════════════════════════════════════

function listenWinner() {
  onValue(ref(db, PATH.winner), snap => {
    const winner = snap.val();
    if (winner) {
      transitionTo(STATE.WINNER);
      renderWinner(winner);
    }
  });
}

// ═══════════════════════════════════════════════
//   STATE: WAITING
// ═══════════════════════════════════════════════

function initWaiting() {
  renderWaitingGrid();
}

function renderWaitingGrid() {
  if (!waitingGridEl) return;
  waitingGridEl.innerHTML = "";

  const list = Object.values(participants);
  const durs   = [5, 6, 7, 5.5, 6.5, 7.5, 6, 5.5, 7, 6.5];
  const delays = [0, 0.5, 1, 1.5, 0.8, 0.3, 1.2, 0.7, 0.2, 1];
  const rots   = [-1, 0.5, -0.5, 1, -1.5, 0.8, -0.3, 1.2, -0.8, 0.4];

  list.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "waiting-card";
    card.style.setProperty("--dur",   `${durs[i % durs.length]}s`);
    card.style.setProperty("--delay", `${delays[i % delays.length]}s`);
    card.style.setProperty("--rot",   `${rots[i % rots.length]}deg`);

    card.innerHTML = `
      <img src="${p.image || ''}" alt="${p.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      <div class="waiting-card-number">${p.number != null ? String(p.number).padStart(2, "0") : ""}</div>
      <div class="waiting-card-name">${p.name || "—"}</div>
    `;

    waitingGridEl.appendChild(card);
  });
}

// ═══════════════════════════════════════════════
//   STATE: VOTING
// ═══════════════════════════════════════════════

function initVoting() {
  renderVotingChips();
  // Reset timer progress
  if (timerProgressEl) {
    timerProgressEl.style.strokeDashoffset = 0;
  }
}

function renderVotingChips() {
  if (!votingChipsEl) return;
  votingChipsEl.innerHTML = "";

  Object.values(participants).forEach(p => {
    const chip = document.createElement("div");
    chip.className = "voting-chip";
    chip.innerHTML = `
      <img src="${p.image || ''}" alt="${p.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      <span class="voting-chip-num">${p.number != null ? String(p.number).padStart(2, "0") : ""}</span>
      <span>${p.name || "—"}</span>
    `;
    votingChipsEl.appendChild(chip);
  });
}

function updateTimer(seconds) {
  if (!timerValueEl) return;

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  timerValueEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  // Urgency style
  if (seconds <= 10) {
    timerValueEl.classList.add("urgent");
  } else {
    timerValueEl.classList.remove("urgent");
  }

  // Ring progress
  if (timerProgressEl) {
    const ratio   = timerMax > 0 ? seconds / timerMax : 1;
    const offset  = timerCircumf * (1 - ratio);
    timerProgressEl.style.strokeDasharray  = timerCircumf;
    timerProgressEl.style.strokeDashoffset = offset;
  }
}

// ═══════════════════════════════════════════════
//   STATE: CONSOLIDATION
// ═══════════════════════════════════════════════

function initConsolidation() {
  pairRevealInProgress = false;
  // Show title for 3s then run pair reveal sequence
  setTimeout(() => {
    runPairRevealSequence();
  }, 3000);
}

async function runPairRevealSequence() {
  if (pairRevealInProgress) return;
  pairRevealInProgress = true;

  const pairs = Object.values(consolidatedPairs);
  if (pairs.length === 0) {
    transitionTo(STATE.PAIRS);
    return;
  }

  for (let i = 0; i < pairs.length; i++) {
    await revealOnePair(pairs[i], i + 1);
    await sleep(600);
  }

  pairRevealInProgress = false;
  transitionTo(STATE.PAIRS);
}

function revealOnePair(pair, number) {
  return new Promise(resolve => {
    const pA = getParticipantById(pair.participant1Id || pair.participantA);
    const pB = getParticipantById(pair.participant2Id || pair.participantB);

    if (!pairRevealEl) { resolve(); return; }

    pairRevealEl.innerHTML = `
      <div class="pair-reveal-number">Pareja ${String(number).padStart(2, "0")}</div>
      <div class="pair-reveal-cards">
        <div class="pair-reveal-card">
          <img src="${pA?.image || ''}" alt="${pA?.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
          <div class="pair-reveal-card-name">${pA?.name || "—"}</div>
        </div>
        <div class="pair-reveal-connector">×</div>
        <div class="pair-reveal-card">
          <img src="${pB?.image || ''}" alt="${pB?.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
          <div class="pair-reveal-card-name">${pB?.name || "—"}</div>
        </div>
      </div>
    `;

    pairRevealEl.style.display = "flex";
    pairRevealEl.classList.remove("hiding");
    pairRevealEl.classList.add("showing");

    // Show for 3.5 seconds then hide
    setTimeout(() => {
      pairRevealEl.classList.remove("showing");
      pairRevealEl.classList.add("hiding");
      setTimeout(() => {
        pairRevealEl.style.display = "none";
        pairRevealEl.classList.remove("hiding");
        resolve();
      }, 600);
    }, 3500);
  });
}

// ═══════════════════════════════════════════════
//   STATE: PAIRS
// ═══════════════════════════════════════════════

function initPairs() {
  renderPairsGrid();
}

function renderPairsGrid() {
  if (!pairsGridEl) return;
  pairsGridEl.innerHTML = "";

  const pairs = Object.entries(consolidatedPairs);

  if (pairs.length === 0) {
    pairsGridEl.innerHTML = `<p style="color:var(--c-grey);font-family:var(--font-mono);font-size:0.75rem;letter-spacing:0.3em;grid-column:1/-1;text-align:center">CARGANDO PAREJAS...</p>`;
    return;
  }

  pairs.forEach(([key, pair], i) => {
    const pA = getParticipantById(pair.participant1Id || pair.participantA);
    const pB = getParticipantById(pair.participant2Id || pair.participantB);
    const isElim = knownElimPairs.has(key);

    const card = document.createElement("div");
    card.className = "pair-card" + (isElim ? " eliminated" : "");
    card.dataset.pairKey = key;
    card.style.setProperty("--delay", `${i * 0.1}s`);

    card.innerHTML = `
      <div class="pair-card-number">Pareja ${String(i + 1).padStart(2, "0")}</div>
      <div class="pair-card-photos">
        <img src="${pA?.image || ''}" alt="${pA?.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
        <img src="${pB?.image || ''}" alt="${pB?.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
      <div class="pair-card-names">
        <div class="pair-card-name">${pA?.name || "—"}</div>
        <div class="pair-card-name">${pB?.name || "—"}</div>
      </div>
    `;

    pairsGridEl.appendChild(card);
  });
}

// ═══════════════════════════════════════════════
//   ELIMINATION OVERLAYS
// ═══════════════════════════════════════════════

function showEliminationParticipant(p) {
  if (!overlayElim) return;

  overlayElim.innerHTML = `
    <div class="elim-flash"></div>
    <div class="elim-label">Participante Eliminado</div>
    <div class="elim-photos">
      <div class="elim-photo">
        <img src="${p.image || ''}" alt="${p.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
    </div>
    <div class="elim-name">${p.name || "—"}</div>
  `;

  overlayElim.style.display = "flex";
  overlayElim.classList.remove("hide");
  overlayElim.classList.add("show");

  setTimeout(() => {
    overlayElim.classList.remove("show");
    overlayElim.classList.add("hide");
    setTimeout(() => {
      overlayElim.style.display = "none";
      overlayElim.classList.remove("hide");
    }, 500);
  }, 4000);
}

function showEliminationPair(pair) {
  if (!overlayElim) return;

  const pA = getParticipantById(pair.participant1Id || pair.participantA);
  const pB = getParticipantById(pair.participant2Id || pair.participantB);

  overlayElim.innerHTML = `
    <div class="elim-flash"></div>
    <div class="elim-label">Pareja Eliminada</div>
    <div class="elim-photos">
      <div class="elim-photo">
        <img src="${pA?.image || ''}" alt="${pA?.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
      <div class="elim-photo">
        <img src="${pB?.image || ''}" alt="${pB?.name || ''}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
    </div>
    <div class="elim-name">${pA?.name || "—"} · ${pB?.name || "—"}</div>
    <div class="elim-pair-label">Pareja eliminada</div>
  `;

  overlayElim.style.display = "flex";
  overlayElim.classList.remove("hide");
  overlayElim.classList.add("show");

  setTimeout(() => {
    overlayElim.classList.remove("show");
    overlayElim.classList.add("hide");
    setTimeout(() => {
      overlayElim.style.display = "none";
      overlayElim.classList.remove("hide");
    }, 500);
  }, 5000);
}

// ═══════════════════════════════════════════════
//   STATE: WINNER
// ═══════════════════════════════════════════════

function initWinner() {
  spawnParticles();
}

function renderWinner(winner) {
  if (!winnerCardsEl) return;

  const pA = getParticipantById(winner.participant1Id || winner.participantA);
  const pB = getParticipantById(winner.participant2Id || winner.participantB);

  winnerCardsEl.innerHTML = `
    <div class="winner-card">
      <div class="winner-card-photo-wrap">
        <img src="${pA?.image || ''}" alt="${pA?.name || ''}" style="--delay:0s" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
      <div class="winner-card-name">${pA?.name || "—"}</div>
    </div>
    <div class="winner-connector">&amp;</div>
    <div class="winner-card">
      <div class="winner-card-photo-wrap">
        <img src="${pB?.image || ''}" alt="${pB?.name || ''}" style="--delay:0.5s" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 1 1%22/>'">
      </div>
      <div class="winner-card-name">${pB?.name || "—"}</div>
    </div>
  `;
}

function spawnParticles() {
  if (!winnerParticles) return;
  winnerParticles.innerHTML = "";

  const cx = window.innerWidth  / 2;
  const cy = window.innerHeight / 2;
  const count = 80;

  for (let i = 0; i < count; i++) {
    const angle  = (Math.random() * 2 * Math.PI);
    const dist   = 80 + Math.random() * 400;
    const tx     = Math.cos(angle) * dist;
    const ty     = Math.sin(angle) * dist;
    const dur    = 1.2 + Math.random() * 1.8;
    const delay  = Math.random() * 1.5;
    const size   = 1 + Math.random() * 3;

    const p = document.createElement("div");
    p.className = "particle";
    p.style.cssText = `
      left: ${cx}px;
      top: ${cy}px;
      width: ${size}px;
      height: ${size}px;
      --tx: ${tx}px;
      --ty: ${ty}px;
      --dur: ${dur}s;
      --delay: ${delay}s;
      animation-delay: ${delay}s;
      opacity: 0;
      background: ${Math.random() > 0.5 ? 'var(--c-gold)' : '#fff'};
    `;
    winnerParticles.appendChild(p);
  }

  // Re-spawn after all particles die
  setTimeout(spawnParticles, 4000);
}

// ═══════════════════════════════════════════════
//   HELPERS
// ═══════════════════════════════════════════════

function getParticipantById(id) {
  if (!id) return null;
  // Direct lookup
  if (participants[id]) return participants[id];
  // Search by number field
  const match = Object.values(participants).find(p => String(p.number) === String(id));
  return match || null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════
//   CONNECTION STATUS
// ═══════════════════════════════════════════════

function setConnected(ok) {
  if (!connDot || !connLabel) return;
  connDot.className = "connection-dot " + (ok ? "connected" : "error");
  connLabel.textContent = ok ? "EN VIVO" : "RECONECTANDO";
}

// Check connection via .info/connected
onValue(ref(db, ".info/connected"), snap => {
  setConnected(!!snap.val());
});

// ═══════════════════════════════════════════════
//   BOOT
// ═══════════════════════════════════════════════

function boot() {
  console.log("[Broadcast] Iniciando módulo Danzad Malditos…");

  // Register all listeners (single instance each)
  listenParticipants();
  listenSystem();
  listenResults();
  listenEliminations();
  listenWinner();

  // Initial state while Firebase loads
  transitionTo(STATE.WAITING);
}

boot();
