"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false }
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MAX_PLAYERS = 6;
const SCENE_COUNT = 5;
const SCENE_TARGETS = ["all", 0, 1, "all", "all"];

app.disable("x-powered-by");
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size }));
app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));

function cleanText(value, maxLength) {
  return String(value || "").replace(/[<>&"'`]/g, "").trim().slice(0, maxLength);
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function sceneTarget(room) {
  const rule = SCENE_TARGETS[room.sceneIndex];
  if (rule === "all") return { mode: "all", playerId: null, playerName: null };
  const player = room.players[Math.min(rule, room.players.length - 1)] || room.players[0];
  return { mode: "player", playerId: player?.id || null, playerName: player?.character?.name || player?.name || "Gracz" };
}

function requiredPlayerIds(room) {
  const target = sceneTarget(room);
  return target.mode === "all" ? room.players.map((player) => player.id) : [target.playerId].filter(Boolean);
}

function publicRoom(room) {
  const target = sceneTarget(room);
  return {
    code: room.code,
    hostId: room.hostId,
    settings: room.settings,
    status: room.status,
    sceneIndex: room.sceneIndex,
    tokens: room.tokens,
    lastDecision: room.lastDecision,
    targetMode: target.mode,
    targetPlayerId: target.playerId,
    targetPlayerName: target.playerName,
    respondedPlayerIds: room.pendingResponses.map((response) => response.playerId),
    requiredPlayerIds: requiredPlayerIds(room),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      character: player.character,
      ready: player.ready
    }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;

  room.players = room.players.filter((player) => player.id !== socket.id);
  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players[0].id;
  emitRoom(room);
}

io.on("connection", (socket) => {
  socket.emit("connection:ready", { id: socket.id });

  socket.on("room:create", (payload = {}, acknowledge = () => {}) => {
    leaveCurrentRoom(socket);
    const code = makeRoomCode();
    const playerName = cleanText(payload.playerName, 24) || "Gracz 1";
    const room = {
      code,
      hostId: socket.id,
      settings: {
        campaign: cleanText(payload.settings?.campaign, 80) || "Cień nad Żelazną Doliną",
        difficulty: cleanText(payload.settings?.difficulty, 16) || "Średni",
        maxPlayers: Math.min(MAX_PLAYERS, Math.max(1, Number(payload.settings?.maxPlayers) || 4)),
        characterMode: cleanText(payload.settings?.characterMode, 40) || "Tworzone przez graczy"
      },
      players: [{ id: socket.id, name: playerName, character: null, ready: false }],
      status: "lobby",
      sceneIndex: 0,
      tokens: 8,
      lastDecision: null,
      pendingResponses: []
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    acknowledge({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", (payload = {}, acknowledge = () => {}) => {
    const code = cleanText(payload.code, 6).toUpperCase();
    const room = rooms.get(code);
    if (!room) return acknowledge({ ok: false, error: "Nie znaleziono pokoju o takim kodzie." });
    if (room.players.length >= room.settings.maxPlayers) return acknowledge({ ok: false, error: "Ten pokój jest już pełny." });
    if (room.status !== "lobby") return acknowledge({ ok: false, error: "Ta kampania już się rozpoczęła." });

    leaveCurrentRoom(socket);
    const playerName = cleanText(payload.playerName, 24) || `Gracz ${room.players.length + 1}`;
    room.players.push({ id: socket.id, name: playerName, character: null, ready: false });
    socket.join(code);
    socket.data.roomCode = code;
    acknowledge({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:leave", () => leaveCurrentRoom(socket));

  socket.on("player:update", (payload = {}, acknowledge = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.id === socket.id);
    if (!room || !player) return acknowledge({ ok: false, error: "Nie jesteś w pokoju." });
    player.name = cleanText(payload.playerName, 24) || player.name;
    player.character = {
      name: cleanText(payload.character?.name, 30) || "Bez imienia",
      characterClass: cleanText(payload.character?.characterClass, 30) || "Wędrowiec",
      origin: cleanText(payload.character?.origin, 30),
      story: cleanText(payload.character?.story, 500)
    };
    player.ready = true;
    acknowledge({ ok: true });
    emitRoom(room);
  });

  socket.on("room:start", (_payload, acknowledge = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return acknowledge({ ok: false, error: "Nie jesteś w pokoju." });
    if (room.hostId !== socket.id) return acknowledge({ ok: false, error: "Tylko gospodarz może rozpocząć kampanię." });
    if (room.players.length < 1) return acknowledge({ ok: false, error: "W pokoju nie ma graczy." });
    if (room.settings.characterMode === "Tworzone przez graczy" && room.players.some((player) => !player.ready)) {
      return acknowledge({ ok: false, error: "Poczekaj, aż każdy gracz stworzy postać." });
    }
    room.status = "playing";
    room.sceneIndex = 0;
    room.tokens = 8;
    room.lastDecision = null;
    room.pendingResponses = [];
    acknowledge({ ok: true });
    io.to(room.code).emit("game:start", publicRoom(room));
    emitRoom(room);
  });

  socket.on("game:choice", (payload = {}, acknowledge = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return acknowledge({ ok: false, error: "Kampania nie jest aktywna." });
    const choice = cleanText(payload.choice, 600);
    if (!choice) return acknowledge({ ok: false, error: "Odpowiedź jest pusta." });
    const custom = Boolean(payload.custom);
    const required = requiredPlayerIds(room);
    if (!required.includes(socket.id)) return acknowledge({ ok: false, error: "Mistrz Gry czeka teraz na odpowiedź innego gracza." });
    if (room.pendingResponses.some((response) => response.playerId === socket.id)) return acknowledge({ ok: false, error: "Twoja odpowiedź została już zapisana. Czekamy na resztę drużyny." });
    if (custom && room.tokens < 1) return acknowledge({ ok: false, error: "Drużyna nie ma już tokenów." });
    if (custom) room.tokens -= 1;
    const player = room.players.find((item) => item.id === socket.id);
    room.lastDecision = {
      playerName: player?.name || "Gracz",
      choice,
      custom,
      createdAt: Date.now()
    };
    room.pendingResponses.push({ playerId: socket.id, choice, custom });
    const everyoneAnswered = required.every((playerId) => room.pendingResponses.some((response) => response.playerId === playerId));
    if (everyoneAnswered) {
      room.sceneIndex = (room.sceneIndex + 1) % SCENE_COUNT;
      room.pendingResponses = [];
    }
    acknowledge({ ok: true });
    io.to(room.code).emit("game:update", publicRoom(room));
    emitRoom(room);
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AIGMV2 multiplayer listening on port ${PORT}`);
});
