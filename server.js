"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const MAX_PLAYERS = 6;
const SCENE_COUNT = 5;
const SCENE_TARGETS = ["all", 0, 1, "all", "all"];
const disconnectTimers = new Map();
const ttsCache = new Map();
const ttsLastRequest = new Map();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_API_BASE_URL = String(process.env.OPENAI_API_BASE_URL || "https://api.openai.com").replace(/\/$/, "");

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size }));
app.get("/", (_request, response) => response.sendFile(path.join(__dirname, "index.html")));

function bearerToken(request) {
  const header = String(request.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function parseApiResponse(response) {
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || data?.error || "Błąd usługi zewnętrznej.");
  return data;
}

async function supabaseRequest(pathname, { method = "GET", body, accessToken, service = false } = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || (service && !SUPABASE_SERVICE_ROLE_KEY)) throw new Error("Supabase nie został jeszcze skonfigurowany na Render.");
  const key = service ? SUPABASE_SERVICE_ROLE_KEY : SUPABASE_ANON_KEY;
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken || key}`,
      "Content-Type": "application/json",
      ...(service ? { Prefer: "return=representation,resolution=merge-duplicates" } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return parseApiResponse(response);
}

async function getSupabaseUser(accessToken) {
  if (!accessToken) throw new Error("Zaloguj się ponownie.");
  return supabaseRequest("/auth/v1/user", { accessToken });
}

async function getProfile(userId, accessToken) {
  const rows = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,display_name,tokens`, { accessToken });
  if (!rows?.[0]) throw new Error("Nie znaleziono profilu gracza. Uruchom skrypt supabase.sql.");
  return rows[0];
}

async function spendAccountToken(userId) {
  const result = await supabaseRequest("/rest/v1/rpc/spend_token", { method: "POST", service: true, body: { p_user_id: userId } });
  const balance = Array.isArray(result) ? result[0] : result;
  if (!Number.isFinite(Number(balance))) throw new Error("Nie udało się zaktualizować salda tokenów.");
  return Number(balance);
}

app.post("/api/auth/signup", async (request, response) => {
  try {
    const email = cleanText(request.body?.email, 160).toLowerCase();
    const password = String(request.body?.password || "");
    const displayName = cleanText(request.body?.displayName, 24) || "Gracz";
    if (!email.includes("@") || password.length < 8) return response.status(400).json({ error: "Podaj poprawny e-mail i hasło mające minimum 8 znaków." });
    const result = await supabaseRequest("/auth/v1/signup", { method: "POST", body: { email, password, data: { display_name: displayName } } });
    const session = result.access_token ? result : null;
    response.json({ user: result.user, session, message: session ? "Konto utworzone." : "Sprawdź e-mail i potwierdź konto." });
  } catch (error) { response.status(400).json({ error: error.message }); }
});

app.post("/api/auth/signin", async (request, response) => {
  try {
    const result = await supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", body: { email: String(request.body?.email || "").toLowerCase(), password: String(request.body?.password || "") } });
    const profile = await getProfile(result.user.id, result.access_token);
    response.json({ session: result, profile });
  } catch (error) { response.status(401).json({ error: error.message }); }
});

app.post("/api/auth/refresh", async (request, response) => {
  try {
    const result = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: request.body?.refreshToken } });
    response.json({ session: result });
  } catch (error) { response.status(401).json({ error: error.message }); }
});

app.get("/api/account", async (request, response) => {
  try {
    const accessToken = bearerToken(request);
    const user = await getSupabaseUser(accessToken);
    const profile = await getProfile(user.id, accessToken);
    response.json({ user: { id: user.id, email: user.email }, profile });
  } catch (error) { response.status(401).json({ error: error.message }); }
});

app.post("/api/tts", async (request, response) => {
  try {
    const user = await getSupabaseUser(bearerToken(request));
    if (!OPENAI_API_KEY) throw new Error("Klucz OpenAI nie został jeszcze dodany na Render.");
    const input = cleanText(request.body?.text, 2000);
    const rate = Number(request.body?.rate) || 0.95;
    const pace = rate < 0.85 ? "Mów spokojnie i wolniej." : (rate > 1.05 ? "Mów nieco szybciej, nadal wyraźnie." : "Mów w naturalnym tempie.");
    if (!input) return response.status(400).json({ error: "Brak tekstu do odczytania." });
    const cacheKey = crypto.createHash("sha256").update(`${input}|${pace}`).digest("hex");
    if (ttsCache.has(cacheKey)) {
      response.set("Content-Type", "audio/mpeg");
      response.set("Cache-Control", "private, max-age=3600");
      return response.send(ttsCache.get(cacheKey));
    }
    const lastRequest = ttsLastRequest.get(user.id) || 0;
    if (Date.now() - lastRequest < 1500) return response.status(429).json({ error: "Odczekaj chwilę przed kolejną narracją." });
    ttsLastRequest.set(user.id, Date.now());
    const audioResponse = await fetch(`${OPENAI_API_BASE_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "cedar",
        input,
        instructions: `Mów po polsku jak doświadczony mistrz gry fantasy: naturalnie, ciepłym niskim głosem, z filmową intonacją, subtelnym napięciem i wyraźnymi pauzami. Nie przesadzaj z teatralnością. ${pace}`,
        response_format: "mp3"
      })
    });
    if (!audioResponse.ok) throw new Error((await audioResponse.text()).slice(0, 300) || "Nie udało się wygenerować głosu.");
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    ttsCache.set(cacheKey, audioBuffer);
    if (ttsCache.size > 50) ttsCache.delete(ttsCache.keys().next().value);
    response.set("Content-Type", "audio/mpeg");
    response.set("Cache-Control", "private, max-age=3600");
    response.send(audioBuffer);
  } catch (error) { response.status(400).json({ error: error.message }); }
});

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
      ready: player.ready,
      connected: player.connected
    }))
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function timerKey(code, sessionToken) {
  return `${code}:${sessionToken}`;
}

function clearDisconnectTimer(code, sessionToken) {
  const key = timerKey(code, sessionToken);
  const timer = disconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  disconnectTimers.delete(key);
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  const sessionToken = socket.data.sessionToken;
  socket.leave(code);
  socket.data.roomCode = null;
  if (!room) return;

  clearDisconnectTimer(code, sessionToken);
  room.players = room.players.filter((player) => player.sessionToken !== sessionToken && player.id !== socket.id);
  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }
  if (room.hostId === socket.id) room.hostId = room.players[0].id;
  emitRoom(room);
}

function holdPlayerPlace(socket) {
  const code = socket.data.roomCode;
  const sessionToken = socket.data.sessionToken;
  const room = rooms.get(code);
  if (!room || !sessionToken) return;
  const player = room.players.find((item) => item.sessionToken === sessionToken);
  if (!player) return;
  player.connected = false;
  player.lastSeen = Date.now();
  emitRoom(room);
  clearDisconnectTimer(code, sessionToken);
  const key = timerKey(code, sessionToken);
  disconnectTimers.set(key, setTimeout(() => {
    const latestRoom = rooms.get(code);
    if (!latestRoom) return;
    latestRoom.players = latestRoom.players.filter((item) => item.sessionToken !== sessionToken);
    latestRoom.pendingResponses = latestRoom.pendingResponses.filter((response) => response.playerId !== player.id);
    if (latestRoom.players.length === 0) rooms.delete(code);
    else {
      if (latestRoom.hostId === player.id) {
        latestRoom.hostId = latestRoom.players[0].id;
        latestRoom.hostToken = latestRoom.players[0].sessionToken;
      }
      emitRoom(latestRoom);
    }
    disconnectTimers.delete(key);
  }, 2 * 60 * 1000));
}

io.on("connection", (socket) => {
  socket.emit("connection:ready", { id: socket.id });

  if (socket.recovered && socket.data.roomCode && socket.data.sessionToken) {
    const recoveredRoom = rooms.get(socket.data.roomCode);
    const recoveredPlayer = recoveredRoom?.players.find((player) => player.sessionToken === socket.data.sessionToken);
    if (recoveredRoom && recoveredPlayer) {
      recoveredPlayer.id = socket.id;
      recoveredPlayer.connected = true;
      recoveredPlayer.lastSeen = Date.now();
      if (recoveredRoom.hostToken === recoveredPlayer.sessionToken) recoveredRoom.hostId = socket.id;
      clearDisconnectTimer(recoveredRoom.code, recoveredPlayer.sessionToken);
      emitRoom(recoveredRoom);
    }
  }

  socket.on("room:create", async (payload = {}, acknowledge = () => {}) => {
    let user;
    try { user = await getSupabaseUser(payload.accessToken); }
    catch (error) { return acknowledge({ ok: false, error: error.message }); }
    leaveCurrentRoom(socket);
    const code = makeRoomCode();
    const sessionToken = cleanText(payload.sessionToken || socket.handshake.auth?.sessionToken, 64) || `${socket.id}-${Date.now()}`;
    const playerName = cleanText(payload.playerName, 24) || "Gracz 1";
    const room = {
      code,
      hostId: socket.id,
      hostToken: sessionToken,
      settings: {
        campaign: cleanText(payload.settings?.campaign, 80) || "Cień nad Żelazną Doliną",
        difficulty: cleanText(payload.settings?.difficulty, 16) || "Średni",
        maxPlayers: Math.min(MAX_PLAYERS, Math.max(1, Number(payload.settings?.maxPlayers) || 4)),
        characterMode: cleanText(payload.settings?.characterMode, 40) || "Tworzone przez graczy"
      },
      players: [{ id: socket.id, sessionToken, userId: user.id, name: playerName, character: null, ready: false, connected: true, lastSeen: Date.now() }],
      status: "lobby",
      sceneIndex: 0,
      lastDecision: null,
      pendingResponses: []
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.sessionToken = sessionToken;
    socket.data.userId = user.id;
    acknowledge({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:join", async (payload = {}, acknowledge = () => {}) => {
    let user;
    try { user = await getSupabaseUser(payload.accessToken); }
    catch (error) { return acknowledge({ ok: false, error: error.message }); }
    const code = cleanText(payload.code, 6).toUpperCase();
    const room = rooms.get(code);
    if (!room) return acknowledge({ ok: false, error: "Nie znaleziono pokoju o takim kodzie." });
    if (room.players.length >= room.settings.maxPlayers) return acknowledge({ ok: false, error: "Ten pokój jest już pełny." });
    if (room.status !== "lobby") return acknowledge({ ok: false, error: "Ta kampania już się rozpoczęła." });

    leaveCurrentRoom(socket);
    const sessionToken = cleanText(payload.sessionToken || socket.handshake.auth?.sessionToken, 64) || `${socket.id}-${Date.now()}`;
    const playerName = cleanText(payload.playerName, 24) || `Gracz ${room.players.length + 1}`;
    room.players.push({ id: socket.id, sessionToken, userId: user.id, name: playerName, character: null, ready: false, connected: true, lastSeen: Date.now() });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.sessionToken = sessionToken;
    socket.data.userId = user.id;
    acknowledge({ ok: true, room: publicRoom(room) });
    emitRoom(room);
  });

  socket.on("room:leave", () => leaveCurrentRoom(socket));

  socket.on("room:resume", async (payload = {}, acknowledge = () => {}) => {
    let user;
    try { user = await getSupabaseUser(payload.accessToken); }
    catch (error) { return acknowledge({ ok: false, error: error.message }); }
    const code = cleanText(payload.code, 6).toUpperCase();
    const sessionToken = cleanText(payload.sessionToken || socket.handshake.auth?.sessionToken, 64);
    const room = rooms.get(code);
    const player = room?.players.find((item) => item.sessionToken === sessionToken);
    if (!room || !player || player.userId !== user.id) return acknowledge({ ok: false, error: "Nie udało się przywrócić miejsca w pokoju." });
    const previousId = player.id;
    player.id = socket.id;
    player.connected = true;
    player.lastSeen = Date.now();
    room.pendingResponses.forEach((response) => {
      if (response.playerId === previousId) response.playerId = socket.id;
    });
    if (room.hostToken === sessionToken) room.hostId = socket.id;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.sessionToken = sessionToken;
    socket.data.userId = user.id;
    clearDisconnectTimer(code, sessionToken);
    const state = publicRoom(room);
    acknowledge({ ok: true, room: state });
    emitRoom(room);
  });

  socket.on("session:heartbeat", (_payload, acknowledge = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find((item) => item.sessionToken === socket.data.sessionToken);
    if (player) {
      player.connected = true;
      player.lastSeen = Date.now();
    }
    acknowledge({ ok: Boolean(player) });
  });

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
    room.lastDecision = null;
    room.pendingResponses = [];
    acknowledge({ ok: true });
    io.to(room.code).emit("game:start", publicRoom(room));
    emitRoom(room);
  });

  socket.on("game:choice", async (payload = {}, acknowledge = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== "playing") return acknowledge({ ok: false, error: "Kampania nie jest aktywna." });
    const choice = cleanText(payload.choice, 600);
    if (!choice) return acknowledge({ ok: false, error: "Odpowiedź jest pusta." });
    const custom = Boolean(payload.custom);
    const required = requiredPlayerIds(room);
    if (!required.includes(socket.id)) return acknowledge({ ok: false, error: "Mistrz Gry czeka teraz na odpowiedź innego gracza." });
    if (room.pendingResponses.some((response) => response.playerId === socket.id)) return acknowledge({ ok: false, error: "Twoja odpowiedź została już zapisana. Czekamy na resztę drużyny." });
    let accountTokens;
    if (custom) {
      try { accountTokens = await spendAccountToken(socket.data.userId); }
      catch (error) { return acknowledge({ ok: false, error: error.message.includes("token") ? "Nie masz wystarczającej liczby tokenów." : error.message }); }
    }
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
    acknowledge({ ok: true, tokens: accountTokens });
    io.to(room.code).emit("game:update", publicRoom(room));
    emitRoom(room);
  });

  socket.on("disconnect", () => holdPlayerPlace(socket));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AIGMV2 multiplayer listening on port ${PORT}`);
});
