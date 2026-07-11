"use strict";

const crypto = require("crypto");

const nativeFetch = globalThis.fetch;
if (typeof nativeFetch !== "function") {
  throw new Error("AIGMV2 TTS cache requires Node.js 20 or newer with global fetch support.");
}

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_API_BASE_URL = String(process.env.OPENAI_API_BASE_URL || "https://api.openai.com").replace(/\/$/, "");
const TTS_CACHE_BUCKET = String(process.env.TTS_CACHE_BUCKET || "tts-cache").replace(/[^a-zA-Z0-9_-]/g, "") || "tts-cache";
const CACHE_VERSION = "v1";
const MEMORY_CACHE_LIMIT = 100;

const memoryCache = new Map();
const inFlight = new Map();
let bucketPromise = null;
let storageWarningShown = false;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function remember(cacheKey, audioBuffer) {
  memoryCache.delete(cacheKey);
  memoryCache.set(cacheKey, audioBuffer);
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    memoryCache.delete(memoryCache.keys().next().value);
  }
}

function storageEnabled() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function storageHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra
  };
}

function publicObjectUrl(objectPath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(TTS_CACHE_BUCKET)}/${objectPath}`;
}

function warnStorage(error) {
  if (storageWarningShown) return;
  storageWarningShown = true;
  console.warn(`[AIGMV2 TTS cache] Supabase Storage unavailable; using memory cache only: ${error.message}`);
}

async function ensureBucket() {
  if (!storageEnabled()) return false;
  if (!bucketPromise) {
    bucketPromise = (async () => {
      const response = await nativeFetch(`${SUPABASE_URL}/storage/v1/bucket`, {
        method: "POST",
        headers: storageHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          id: TTS_CACHE_BUCKET,
          name: TTS_CACHE_BUCKET,
          public: true,
          file_size_limit: 20 * 1024 * 1024,
          allowed_mime_types: ["audio/mpeg"]
        })
      });
      if (response.ok || response.status === 409) return true;
      const message = await response.text();
      if (/already exists|duplicate/i.test(message)) return true;
      throw new Error(`cannot create bucket (${response.status}): ${message.slice(0, 200)}`);
    })().catch((error) => {
      bucketPromise = null;
      throw error;
    });
  }
  return bucketPromise;
}

async function readPersistentCache(objectPath) {
  if (!storageEnabled()) return null;
  try {
    const response = await nativeFetch(publicObjectUrl(objectPath), {
      method: "GET",
      headers: { Accept: "audio/mpeg" },
      cache: "no-store"
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    warnStorage(error);
    return null;
  }
}

async function writePersistentCache(objectPath, audioBuffer) {
  if (!storageEnabled()) return false;
  try {
    await ensureBucket();
    const response = await nativeFetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(TTS_CACHE_BUCKET)}/${objectPath}`, {
      method: "POST",
      headers: storageHeaders({
        "Content-Type": "audio/mpeg",
        "Cache-Control": "31536000",
        "x-upsert": "false"
      }),
      body: audioBuffer
    });
    if (response.ok || response.status === 409) return true;
    const message = await response.text();
    if (/already exists|duplicate/i.test(message)) return true;
    throw new Error(`upload failed (${response.status}): ${message.slice(0, 200)}`);
  } catch (error) {
    warnStorage(error);
    return false;
  }
}

function responseFromBuffer(audioBuffer, cacheStatus) {
  return new Response(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audioBuffer.length),
      "X-AIGMV2-TTS-Cache": cacheStatus
    }
  });
}

async function requestBodyText(input, init) {
  if (typeof init?.body === "string") return init.body;
  if (Buffer.isBuffer(init?.body)) return init.body.toString("utf8");
  if (init?.body instanceof Uint8Array) return Buffer.from(init.body).toString("utf8");
  if (typeof Request !== "undefined" && input instanceof Request) return input.clone().text();
  return "";
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input?.url || "";
}

function requestMethod(input, init) {
  return String(init?.method || input?.method || "GET").toUpperCase();
}

function isOpenAiSpeechRequest(input, init) {
  if (requestMethod(input, init) !== "POST") return false;
  try {
    const url = new URL(requestUrl(input));
    const base = new URL(OPENAI_API_BASE_URL);
    return url.origin === base.origin && url.pathname === `${base.pathname.replace(/\/$/, "")}/v1/audio/speech`;
  } catch {
    return false;
  }
}

async function generateAudio(input, init, cacheKey, objectPath) {
  const persistentAudio = await readPersistentCache(objectPath);
  if (persistentAudio) {
    remember(cacheKey, persistentAudio);
    return { buffer: persistentAudio, cacheStatus: "persistent" };
  }

  const openAiResponse = await nativeFetch(input, init);
  const responseBuffer = Buffer.from(await openAiResponse.arrayBuffer());
  if (!openAiResponse.ok) {
    return {
      buffer: responseBuffer,
      cacheStatus: "error",
      status: openAiResponse.status,
      statusText: openAiResponse.statusText,
      headers: Object.fromEntries(openAiResponse.headers.entries())
    };
  }

  remember(cacheKey, responseBuffer);
  await writePersistentCache(objectPath, responseBuffer);
  return { buffer: responseBuffer, cacheStatus: "generated" };
}

globalThis.fetch = async function aigmv2CachedFetch(input, init) {
  if (!isOpenAiSpeechRequest(input, init)) return nativeFetch(input, init);

  let payload;
  try {
    payload = JSON.parse(await requestBodyText(input, init));
  } catch {
    return nativeFetch(input, init);
  }

  if (!payload?.input || String(payload.response_format || "mp3").toLowerCase() !== "mp3") {
    return nativeFetch(input, init);
  }

  const fingerprint = stableStringify({
    cacheVersion: CACHE_VERSION,
    endpoint: "/v1/audio/speech",
    payload
  });
  const cacheKey = crypto.createHash("sha256").update(fingerprint).digest("hex");
  const objectPath = `${CACHE_VERSION}/${cacheKey}.mp3`;

  const memoryAudio = memoryCache.get(cacheKey);
  if (memoryAudio) return responseFromBuffer(memoryAudio, "memory");

  if (!inFlight.has(cacheKey)) {
    inFlight.set(cacheKey, generateAudio(input, init, cacheKey, objectPath).finally(() => inFlight.delete(cacheKey)));
  }

  const result = await inFlight.get(cacheKey);
  if (result.status && result.status !== 200) {
    return new Response(result.buffer, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers
    });
  }
  return responseFromBuffer(result.buffer, result.cacheStatus);
};

console.log(`[AIGMV2 TTS cache] enabled; persistent storage ${storageEnabled() ? `Supabase bucket ${TTS_CACHE_BUCKET}` : "disabled"}.`);
