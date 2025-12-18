const socket = io();

const statusEl = document.getElementById("status");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const restartBtn = document.getElementById("restartBtn");
const codeEl = document.getElementById("code");
const roomCodeEl = document.getElementById("roomCode");

const mapCanvas = document.getElementById("map");
const mapCtx = mapCanvas.getContext("2d");

const miniGrid = document.getElementById("miniGrid");

let roomCode = null;
let state = null;

function setStatus(msg) { statusEl.textContent = msg; }

createBtn.addEventListener("click", () => {
  socket.emit("host:createRoom", (resp) => {
    if (!resp?.ok) {
      setStatus("Create failed");
      return;
    }
    roomCode = resp.code;
    roomCodeEl.textContent = roomCode;
    setStatus(`Hosting room ${roomCode}`);
  });
});

joinBtn.addEventListener("click", () => {
  const code = codeEl.value.trim().toUpperCase();
  if (!code) return;
  socket.emit("host:joinRoom", { code }, (resp) => {
    if (!resp?.ok) {
      setStatus(resp?.error || "Join failed");
      return;
    }
    roomCode = code;
    roomCodeEl.textContent = roomCode;
    setStatus(`Hosting room ${roomCode}`);
  });
});

restartBtn.addEventListener("click", () => {
  if (!roomCode) return setStatus("No room yet.");
  socket.emit("host:restartRoom", { code: roomCode }, (resp) => {
    if (!resp?.ok) return setStatus(resp?.error || "Restart failed");
    setStatus(`🔄 Room ${roomCode} restarted`);
  });
});

socket.on("game:winner", (w) => {
  setStatus(`🏁 Winner: ${w.name}`);
});
socket.on("game:restarted", () => {
  setStatus(`🔄 Room ${roomCode || ""} restarted`);
});

socket.on("room:state", (s) => { state = s; redrawAll(); });
socket.on("room:tick", (s) => { state = s; redrawAll(); });

function redrawAll() {
  drawMap();
  drawMiniViews();
}

function drawMap() {
  mapCtx.clearRect(0,0,mapCanvas.width,mapCanvas.height);
  if (!state) {
    mapCtx.fillStyle = "rgba(255,255,255,0.75)";
    mapCtx.font = "16px system-ui";
    mapCtx.fillText("Create or join a room.", 18, 30);
    return;
  }

  const scale = 0.32;
  const cx = mapCanvas.width/2;
  const cy = mapCanvas.height/2;

  const centerX = -60;
  const centerY = 40;

  mapCtx.fillStyle = "rgba(255,255,255,0.45)";
  for (let i=0; i<140; i++) {
    const x = ((i * 173) % 1200) * 0.8;
    const y = ((i * 97) % 800) * 0.8;
    mapCtx.fillRect(x, y, 2, 2);
  }

  // planets
  state.planets.forEach(p => {
    const sx = cx + (p.x - centerX) * scale;
    const sy = cy + (p.y - centerY) * scale;
    mapCtx.beginPath();
    mapCtx.fillStyle = "rgba(255,255,255,0.22)";
    mapCtx.arc(sx, sy, Math.max(3, p.r * scale), 0, Math.PI * 2);
    mapCtx.fill();

    mapCtx.fillStyle = "rgba(255,255,255,0.6)";
    mapCtx.font = "11px system-ui";
    mapCtx.fillText(p.name, sx + 6, sy - 6);
  });

  // moon
  if (state.moon) {
    const m = state.moon;
    const sx = cx + (m.x - centerX) * scale;
    const sy = cy + (m.y - centerY) * scale;
    mapCtx.beginPath();
    mapCtx.fillStyle = "rgba(255,255,255,0.35)";
    mapCtx.arc(sx, sy, Math.max(2, m.r * scale), 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = "rgba(255,255,255,0.65)";
    mapCtx.font = "11px system-ui";
    mapCtx.fillText("Moon", sx + 6, sy - 6);
  }

  // players
  state.players.forEach(pl => {
    const sx = cx + (pl.x - centerX) * scale;
    const sy = cy + (pl.y - centerY) * scale;

    mapCtx.save();
    mapCtx.translate(sx, sy);
    mapCtx.rotate(pl.angle || 0);
    mapCtx.fillStyle = pl.color || "rgba(255,255,255,0.8)";
    mapCtx.beginPath();
    mapCtx.moveTo(10, 0);
    mapCtx.lineTo(-8, 6);
    mapCtx.lineTo(-5, 0);
    mapCtx.lineTo(-8, -6);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  });
}

function drawMiniViews() {
  miniGrid.innerHTML = "";
  if (!state) return;

  // Each mini shows that player's local view (centered on them)
  state.players.forEach(p => {
    const card = document.createElement("div");
    card.className = "miniCard";

    const header = document.createElement("div");
    header.className = "miniHeader";

    const left = document.createElement("div");
    left.textContent = p.name;

    const right = document.createElement("div");
    const collectedCount = p.quest?.collected?.length ?? 0;
    right.textContent = `Items: ${collectedCount}/9`;

    header.appendChild(left);
    header.appendChild(right);

    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 180;
    c.style.width = "100%";
    c.style.borderRadius = "10px";
    c.style.border = "1px solid rgba(255,255,255,0.12)";
    c.style.background = "rgba(0,0,0,0.22)";

    card.appendChild(header);
    card.appendChild(c);

    miniGrid.appendChild(card);

    drawMini(c.getContext("2d"), p);
  });
}

function drawMini(g, player) {
  g.clearRect(0,0,320,180);
  if (!state) return;

  const camX = player.x;
  const camY = player.y;

  g.save();
  g.translate(160, 90);
  g.translate(-camX, -camY);

  // planets
  state.planets.forEach(pl => {
    g.beginPath();
    g.fillStyle = "rgba(255,255,255,0.18)";
    g.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2);
    g.fill();
  });

  // moon
  if (state.moon) {
    const m = state.moon;
    g.beginPath();
    g.fillStyle = "rgba(255,255,255,0.28)";
    g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    g.fill();
  }

  // draw ONLY that player's ship in their mini
  g.save();
  g.translate(player.x, player.y);
  g.rotate(player.angle || 0);
  g.fillStyle = player.color || "rgba(255,255,255,0.85)";
  g.beginPath();
  g.moveTo(12, 0);
  g.lineTo(-9, 7);
  g.lineTo(-6, 0);
  g.lineTo(-9, -7);
  g.closePath();
  g.fill();
  g.restore();

  g.restore();
}
