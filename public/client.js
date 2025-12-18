const socket = io();

const statusEl = document.getElementById("status");
const codeEl = document.getElementById("code");
const nameEl = document.getElementById("name");
const joinBtn = document.getElementById("joinBtn");
const landBtn = document.getElementById("landBtn");

const targetNameEl = document.getElementById("targetName");
const collectedCountEl = document.getElementById("collectedCount");
const inventoryEl = document.getElementById("inventory");

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

let roomCode = null;
let myId = null;

let planets = [];
let moon = null;
let roomState = null;
let myQuest = null;

const input = { up:false, down:false, left:false, right:false };

const PLANET_ICONS = {
  mercury: "☿️",
  venus: "♀️",
  earth: "🌍",
  mars: "♂️",
  jupiter: "🟠",
  saturn: "🪐",
  uranus: "🟦",
  neptune: "🔵",
  pluto: "❄️"
};

// landing animation fx
let landFx = null; // { x, y, start, duration, targetId }

function setStatus(msg) { statusEl.textContent = msg; }

function planetById(id) {
  return planets.find(p => p.id === id);
}

function targetById(id) {
  if (id === "moon") return moon || { id:"moon", name:"Moon", x:0, y:0, r:10 };
  return planetById(id);
}

function myPlayer() {
  if (!roomState || !myId) return null;
  return roomState.players.find(p => p.id === myId) || null;
}

function renderInventory() {
  if (!myQuest) return;
  const collected = new Set(myQuest.collected);
  inventoryEl.innerHTML = "";

  const order = ["mercury","venus","earth","mars","jupiter","saturn","uranus","neptune","pluto"];
  for (const id of order) {
    const div = document.createElement("div");
    div.className = "invItem" + (collected.has(id) ? " collected" : "");
    div.title = id[0].toUpperCase() + id.slice(1);
    div.textContent = PLANET_ICONS[id] || "•";
    inventoryEl.appendChild(div);
  }
}

function updateHud() {
  if (!myQuest) return;
  const targetId = myQuest.order[myQuest.index];
  const target = targetById(targetId);
  targetNameEl.textContent = target ? target.name : "—";
  collectedCountEl.textContent = myQuest.collected.length;

  const me = myPlayer();
  if (!me || !target) {
    landBtn.disabled = true;
    renderInventory();
    return;
  }
  const dist = Math.hypot(me.x - target.x, me.y - target.y);
  landBtn.disabled = dist > target.r + 45;

  renderInventory();
}

joinBtn.addEventListener("click", () => {
  const code = codeEl.value.trim().toUpperCase();
  const name = nameEl.value.trim();
  if (!code) return;

  socket.emit("player:joinRoom", { code, name }, (resp) => {
    if (!resp?.ok) {
      setStatus(resp?.error || "Join failed");
      return;
    }
    roomCode = resp.code;
    myId = resp.playerId;
    planets = resp.planets || planets;
    moon = resp.moon || moon;
    myQuest = resp.quest;

    setStatus(`Joined room ${roomCode} as ${name || "Pilot"}`);
    updateHud();
  });
});

function playPickupSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ac = new AudioCtx();

    const o = ac.createOscillator();
    const g = ac.createGain();

    o.type = "triangle";
    o.frequency.setValueAtTime(740, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(1240, ac.currentTime + 0.12);

    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.18);

    o.connect(g);
    g.connect(ac.destination);

    o.start();
    o.stop(ac.currentTime + 0.19);

    o.onended = () => ac.close();
  } catch {
    // ignore
  }
}

landBtn.addEventListener("click", () => {
  if (!roomCode) return;
  socket.emit("player:land", { code: roomCode }, (resp) => {
    if (!resp?.ok) {
      setStatus(resp?.error || "Cannot land");
      return;
    }

    const me = myPlayer();
    if (me) {
      landFx = {
        x: me.x,
        y: me.y,
        start: performance.now(),
        duration: 600,
        targetId: resp.collected || "moon"
      };
    }
    playPickupSound();

    if (resp.done) {
      setStatus(resp.winner ? `🏁 You WIN! (${resp.winner.name})` : "✅ Finished!");
    } else {
      const nextT = targetById(resp.next);
      setStatus(`Collected ${resp.collected}. Next: ${nextT?.name || resp.next}`);
    }
  });
});

// Winner/restart events
socket.on("game:winner", (w) => {
  setStatus(`🏁 Winner: ${w.name}`);
});
socket.on("game:restarted", () => {
  setStatus("🔄 Room restarted. New spawn + new quest!");
});

// Keyboard controls
window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") input.up = true;
  if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") input.down = true;
  if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") input.left = true;
  if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") input.right = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "ArrowUp" || e.key.toLowerCase() === "w") input.up = false;
  if (e.key === "ArrowDown" || e.key.toLowerCase() === "s") input.down = false;
  if (e.key === "ArrowLeft" || e.key.toLowerCase() === "a") input.left = false;
  if (e.key === "ArrowRight" || e.key.toLowerCase() === "d") input.right = false;
});

// Mobile on-screen buttons
document.querySelectorAll(".padBtn").forEach(btn => {
  const key = btn.dataset.key;
  const down = () => { input[key] = true; };
  const up = () => { input[key] = false; };

  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
});

// Send input at 30Hz
setInterval(() => {
  if (!roomCode) return;
  socket.emit("player:input", { code: roomCode, input });
}, 33);

// Receive states
socket.on("room:state", (state) => {
  if (!state) return;
  roomState = state;
  planets = state.planets || planets;
  moon = state.moon || moon;

  const me = myPlayer();
  if (me?.quest) {
    myQuest = {
      order: me.quest.order,
      index: me.quest.index,
      collected: me.quest.collected
    };
  }
  updateHud();
});

socket.on("room:tick", (state) => {
  roomState = state;
  planets = state.planets || planets;
  moon = state.moon || moon;

  const me = myPlayer();
  if (me?.quest) {
    myQuest = {
      order: me.quest.order,
      index: me.quest.index,
      collected: me.quest.collected
    };
  }
  updateHud();
  render();
});

function drawStars(camX, camY) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 90; i++) {
    const x = ((i * 173) % 1200) - 600 - (camX * 0.12);
    const y = ((i * 97) % 800) - 400 - (camY * 0.12);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();
}

function drawLandingBeam(nowMs) {
  if (!landFx) return;
  const t = (nowMs - landFx.start) / landFx.duration;
  if (t >= 1) { landFx = null; return; }

  const pulse = 1 + Math.sin(t * Math.PI * 6) * 0.08;
  const radius = 42 * (1 - t) * pulse;

  ctx.save();
  ctx.globalAlpha = 0.55 * (1 - t);
  ctx.strokeStyle = "rgba(107,191,89,0.95)";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.arc(landFx.x, landFx.y, Math.max(8, radius), 0, Math.PI * 2);
  ctx.stroke();

  ctx.globalAlpha = 0.25 * (1 - t);
  ctx.fillStyle = "rgba(107,191,89,0.85)";
  ctx.beginPath();
  ctx.arc(landFx.x, landFx.y, Math.max(6, radius * 0.55), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const me = myPlayer();
  if (!me) {
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "16px system-ui";
    ctx.fillText("Join a room to start.", 18, 30);
    return;
  }

  const camX = me.x;
  const camY = me.y;

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  drawStars(camX, camY);

  ctx.translate(-camX, -camY);

  // planets
  planets.forEach(p => {
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.arc(p.x, p.y, p.r + 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "12px system-ui";
    ctx.fillText(p.name, p.x - p.r, p.y - p.r - 8);
  });

  // moon
  if (moon) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "12px system-ui";
    ctx.fillText("Moon", moon.x - 18, moon.y - moon.r - 8);
  }

  // highlight current target ring (only for me)
  const targetId = myQuest?.order?.[myQuest.index];
  const target = targetById(targetId);
  if (target) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(107,191,89,0.9)";
    ctx.lineWidth = 3;
    ctx.arc(target.x, target.y, (target.r || 10) + 40, 0, Math.PI * 2);
    ctx.stroke();
  }

  // draw ONLY my ship
  drawShip(me);

  // landing beam fx
  drawLandingBeam(performance.now());

  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "12px system-ui";
  ctx.fillText("Camera: YOU ONLY", 16, canvas.height - 14);
}

function drawShip(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);

  ctx.fillStyle = p.color || "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(-14, 10);
  ctx.lineTo(-10, 0);
  ctx.lineTo(-14, -10);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(107,191,89,0.6)";
  ctx.fillRect(-18, -3, 8, 6);

  ctx.restore();
}

setStatus("Ready. Join a room code.");
render();
