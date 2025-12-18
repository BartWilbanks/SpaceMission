const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

// ---- Game constants ----
const PLANETS = [
  { id: "mercury", name: "Mercury", x: -420, y: -110, r: 18 },
  { id: "venus", name: "Venus", x: -260, y: 130, r: 22 },
  { id: "earth", name: "Earth", x: -60, y: 40, r: 24 },
  { id: "mars", name: "Mars", x: 140, y: -40, r: 20 },
  { id: "jupiter", name: "Jupiter", x: 370, y: 120, r: 40 },
  { id: "saturn", name: "Saturn", x: 620, y: -120, r: 36 },
  { id: "uranus", name: "Uranus", x: 860, y: 80, r: 30 },
  { id: "neptune", name: "Neptune", x: 1100, y: -70, r: 30 },
  { id: "pluto", name: "Pluto", x: 1320, y: 140, r: 14 }
];

const MOON = { id: "moon", name: "Moon", x: -10, y: 95, r: 10 }; // near Earth

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeQuestOrder() {
  // Collect items from all 9 planets in random order, then deposit on the Moon
  const planetsOnly = PLANETS.map(p => p.id);
  const shuffled = shuffle(planetsOnly);
  return [...shuffled, "moon"];
}

function now() { return Date.now(); }

// rooms[code] = { players: Map(socketId -> playerObj), hostId: socketId|null, winner: null|{id,name,time} }
const rooms = new Map();

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getRoom(code) {
  return rooms.get(code);
}

function publicRoomState(code) {
  const room = rooms.get(code);
  if (!room) return null;
  const players = [];
  for (const [id, p] of room.players.entries()) {
    players.push({
      id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      color: p.color,
      speed: p.speed,
      spawnPlanetId: p.spawnPlanetId,
      quest: {
        order: p.questOrder,
        index: p.questIndex,
        collected: p.collected
      },
      lastSeen: p.lastSeen
    });
  }
  return { code, players, planets: PLANETS, moon: MOON, winner: room.winner };
}

function randomColor() {
  const colors = ["#7dd3fc", "#a7f3d0", "#fda4af", "#fde68a", "#c4b5fd", "#fdba74"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function pickSpawnPlanet(room) {
  // Prefer unused planets for unique spawns (until 9 players)
  const used = new Set();
  for (const p of room.players.values()) used.add(p.spawnPlanetId);

  const all = PLANETS.map(p => p.id);
  const unused = all.filter(id => !used.has(id));
  const choiceList = unused.length ? unused : all;
  return choiceList[Math.floor(Math.random() * choiceList.length)];
}

function spawnNearPlanet(planetId) {
  const pl = PLANETS.find(p => p.id === planetId) || PLANETS[0];
  return { x: pl.x + pl.r + 55, y: pl.y - (pl.r + 25) };
}

// ---- Socket.IO ----
io.on("connection", (socket) => {
  socket.on("host:createRoom", (ack) => {
    let code;
    do { code = createRoomCode(); } while (rooms.has(code));

    rooms.set(code, {
      hostId: socket.id,
      players: new Map(),
      winner: null,
      createdAt: now()
    });

    socket.join(code);
    ack?.({ ok: true, code });
    socket.emit("room:state", publicRoomState(code));
  });

  socket.on("host:joinRoom", ({ code }, ack) => {
    const room = getRoom(code);
    if (!room) return ack?.({ ok: false, error: "Room not found" });

    room.hostId = socket.id;
    socket.join(code);
    ack?.({ ok: true });
    socket.emit("room:state", publicRoomState(code));
  });

  socket.on("host:restartRoom", ({ code }, ack) => {
    const room = getRoom(code);
    if (!room) return ack?.({ ok: false, error: "Room not found" });
    if (room.hostId !== socket.id) return ack?.({ ok: false, error: "Only host can restart" });

    room.winner = null;

    const existing = Array.from(room.players.entries());
    room.players.clear();

    for (const [id, old] of existing) {
      const spawnPlanetId = pickSpawnPlanet(room);
      const { x, y } = spawnNearPlanet(spawnPlanetId);

      room.players.set(id, {
        ...old,
        x, y,
        angle: 0,
        speed: 0,
        spawnPlanetId,
        questOrder: makeQuestOrder(),
        questIndex: 0,
        collected: [],
        input: { up: false, down: false, left: false, right: false },
        lastSeen: now()
      });
    }

    io.to(code).emit("game:restarted", { time: now() });
    io.to(code).emit("room:state", publicRoomState(code));
    ack?.({ ok: true });
  });

  socket.on("player:joinRoom", ({ code, name }, ack) => {
    const room = getRoom(code);
    if (!room) return ack?.({ ok: false, error: "Room not found" });

    const n = (name || "Pilot").toString().trim().slice(0, 16);
    const spawnPlanetId = pickSpawnPlanet(room);
    const { x, y } = spawnNearPlanet(spawnPlanetId);

    const player = {
      name: n,
      x, y,
      angle: 0,
      speed: 0,
      color: randomColor(),
      spawnPlanetId,
      questOrder: makeQuestOrder(),
      questIndex: 0,
      collected: [],
      input: { up:false, down:false, left:false, right:false },
      lastSeen: now()
    };

    room.players.set(socket.id, player);
    socket.join(code);

    ack?.({
      ok: true,
      code,
      playerId: socket.id,
      planets: PLANETS,
      moon: MOON,
      quest: { order: player.questOrder, index: player.questIndex, collected: player.collected }
    });

    io.to(code).emit("room:state", publicRoomState(code));
  });

  socket.on("player:input", ({ code, input }) => {
    const room = getRoom(code);
    if (!room) return;
    const p = room.players.get(socket.id);
    if (!p) return;

    p.input = {
      up: !!input?.up,
      down: !!input?.down,
      left: !!input?.left,
      right: !!input?.right
    };
    p.lastSeen = now();
  });

  socket.on("player:land", ({ code }, ack) => {
    const room = getRoom(code);
    if (!room) return ack?.({ ok:false, error:"Room not found" });
    if (room.winner) return ack?.({ ok:false, error:`Game over. Winner: ${room.winner.name}` });

    const p = room.players.get(socket.id);
    if (!p) return ack?.({ ok:false, error:"Player not found" });

    const targetId = p.questOrder[p.questIndex]; // planet id or "moon"
    const target =
      targetId === "moon"
        ? MOON
        : PLANETS.find(pl => pl.id === targetId);

    if (!target) return ack?.({ ok:false, error:"Bad target" });

    const dist = Math.hypot(p.x - target.x, p.y - target.y);
    if (dist > target.r + 45) {
      return ack?.({ ok:false, error:"Too far to land. Get closer." });
    }

    if (targetId !== "moon") {
      if (!p.collected.includes(targetId)) p.collected.push(targetId);
      if (p.questIndex < p.questOrder.length - 1) p.questIndex++;

      io.to(code).emit("room:state", publicRoomState(code));
      return ack?.({
        ok: true,
        collected: targetId,
        deposited: false,
        done: false,
        next: p.questOrder[p.questIndex]
      });
    }

    // Moon deposit: require all 9 planet items
    const needed = new Set(PLANETS.map(pl => pl.id));
    const haveAll = [...needed].every(id => p.collected.includes(id));
    if (!haveAll) {
      return ack?.({ ok:false, error:"You must collect all planet items before depositing on the Moon." });
    }

    room.winner = { id: socket.id, name: p.name, time: now() };
    io.to(code).emit("game:winner", room.winner);
    io.to(code).emit("room:state", publicRoomState(code));

    return ack?.({ ok:true, deposited:true, done:true, winner: room.winner });
  });

  socket.on("room:leave", ({ code }) => {
    const room = getRoom(code);
    if (!room) return;
    room.players.delete(socket.id);
    socket.leave(code);
    io.to(code).emit("room:state", publicRoomState(code));
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms.entries()) {
      let changed = false;

      if (room.hostId === socket.id) {
        room.hostId = null;
        changed = true;
      }

      if (room.players.delete(socket.id)) {
        changed = true;
      }

      if (!room.hostId && room.players.size === 0) {
        rooms.delete(code);
        continue;
      }

      if (changed) {
        io.to(code).emit("room:state", publicRoomState(code));
      }
    }
  });
});

// ---- Simple physics tick ----
const TICK_HZ = 30;
setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    // Freeze movement after winner, but still broadcast state
    if (room.winner) {
      io.to(code).emit("room:tick", publicRoomState(code));
      continue;
    }

    for (const [id, p] of room.players.entries()) {
      const turnRate = 0.09; // rad per tick
      if (p.input.left) p.angle -= turnRate;
      if (p.input.right) p.angle += turnRate;

      const accel = 0.25;
      const maxSpeed = 6.0;
      if (p.input.up) p.speed += accel;
      if (p.input.down) p.speed -= accel * 0.8;

      p.speed *= 0.92;
      p.speed = Math.max(Math.min(p.speed, maxSpeed), -maxSpeed * 0.6);

      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed;

      const bound = 1700;
      p.x = Math.max(-bound, Math.min(bound, p.x));
      p.y = Math.max(-bound, Math.min(bound, p.y));

      p.lastSeen = now();
    }

    io.to(code).emit("room:tick", publicRoomState(code));
  }
}, Math.floor(1000 / TICK_HZ));

server.listen(PORT, () => {
  console.log(`Solar Quest running on port ${PORT}`);
});
