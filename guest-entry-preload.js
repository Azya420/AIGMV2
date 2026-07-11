"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

const PATCH_FLAG = Symbol.for("aigmv2.guestEntryPatched");
let cachedSource = null;
let cachedHtml = null;

function replaceRequired(source, searchValue, replacement, label) {
  const updated = source.replace(searchValue, replacement);
  if (updated === source) console.warn(`[AIGMV2 guest flow] Nie zastosowano poprawki: ${label}`);
  return updated;
}

function transformIndexHtml(source) {
  if (source === cachedSource && cachedHtml) return cachedHtml;

  let html = source;

  html = replaceRequired(
    html,
    '<span class="viz-badge">◆ <span id="account-tokens">8</span> tokenów</span>',
    '<span class="viz-badge">◆ <span id="account-tokens">—</span> tokenów</span>',
    "saldo gościa"
  );

  html = replaceRequired(
    html,
    '<section class="app-screen" data-screen="auth">',
    '<section class="app-screen" data-screen="auth" hidden>',
    "ukrycie logowania na wejściu"
  );

  html = replaceRequired(
    html,
    '<section class="app-screen" data-screen="menu" hidden>',
    '<section class="app-screen" data-screen="menu">',
    "pokazanie menu na wejściu"
  );

  html = replaceRequired(
    html,
    '<div class="app-header"><div><h1>Twoje konto gracza</h1><div class="app-muted">Zaloguj się, aby grać online i zachować tokeny.</div></div></div>',
    '<div class="app-header"><div><h1>Twoje konto gracza</h1><div class="app-muted">Zaloguj się lub utwórz konto, aby rozpocząć albo dołączyć do kampanii.</div></div><button class="btn" type="button" data-go="menu">← Wróć</button></div>',
    "przycisk powrotu z logowania"
  );

  html = replaceRequired(
    html,
    '    let accountLoadPromise = null;\n',
    '    let accountLoadPromise = null;\n    let pendingScreen = "menu";\n',
    "zapamiętanie wybranej akcji"
  );

  html = replaceRequired(
    html,
    '      if (!authSession?.access_token) { showScreen("auth"); return false; }',
    '      if (!authSession?.access_token) return false;',
    "ciche sprawdzanie sesji"
  );

  html = replaceRequired(
    html,
    '        if (!authSession?.refresh_token) { showScreen("auth"); return false; }',
    '        if (!authSession?.refresh_token) {\n          localStorage.removeItem("aigmv2-auth-session");\n          authSession = null;\n          document.querySelector("#account-name").textContent = "Gość";\n          document.querySelector("#account-tokens").textContent = "—";\n          document.querySelector("#logout-button").hidden = true;\n          return false;\n        }',
    "obsługa wygasłej sesji bez wymuszania logowania"
  );

  html = replaceRequired(
    html,
    '          localStorage.removeItem("aigmv2-auth-session");\n          authSession = null;\n          showScreen("auth");\n          return false;',
    '          localStorage.removeItem("aigmv2-auth-session");\n          authSession = null;\n          document.querySelector("#account-name").textContent = "Gość";\n          document.querySelector("#account-tokens").textContent = "—";\n          document.querySelector("#logout-button").hidden = true;\n          return false;',
    "odświeżenie wygasłej sesji"
  );

  html = replaceRequired(
    html,
    '    function ensureAccount() {\n      if (!accountLoadPromise) accountLoadPromise = loadAccount().finally(function () { accountLoadPromise = null; });\n      return accountLoadPromise;\n    }',
    '    function ensureAccount() {\n      if (!accountLoadPromise) accountLoadPromise = loadAccount().finally(function () { accountLoadPromise = null; });\n      return accountLoadPromise;\n    }\n\n    async function openProtectedScreen(name) {\n      pendingScreen = name;\n      if (await ensureAccount()) {\n        pendingScreen = "menu";\n        showScreen(name);\n        return;\n      }\n      setAuthMode("login");\n      showScreen("auth");\n    }',
    "ochrona ekranów kampanii"
  );

  html = replaceRequired(
    html,
    '        await ensureAccount();\n        showScreen("menu");',
    '        if (!(await ensureAccount())) throw new Error("Nie udało się wczytać konta.");\n        const destination = pendingScreen || "menu";\n        pendingScreen = "menu";\n        showScreen(destination);',
    "powrót do wybranej akcji po logowaniu"
  );

  html = replaceRequired(
    html,
    '      document.querySelector("#account-name").textContent = "Gość";\n      document.querySelector("#logout-button").hidden = true;\n      showScreen("auth");',
    '      document.querySelector("#account-name").textContent = "Gość";\n      document.querySelector("#account-tokens").textContent = "—";\n      document.querySelector("#logout-button").hidden = true;\n      pendingScreen = "menu";\n      showScreen("menu");',
    "powrót do menu po wylogowaniu"
  );

  html = replaceRequired(
    html,
    '      if (goButton) {\n        if (goButton.dataset.go === "menu" && currentRoom && socket) {',
    '      if (goButton) {\n        const destination = goButton.dataset.go;\n        if (["setup", "join", "saves"].includes(destination)) {\n          event.preventDefault();\n          openProtectedScreen(destination);\n          return;\n        }\n        if (destination === "menu") pendingScreen = "menu";\n        if (destination === "menu" && currentRoom && socket) {',
    "logowanie dopiero po wyborze kampanii"
  );

  html = replaceRequired(
    html,
    '        showScreen(goButton.dataset.go);',
    '        showScreen(destination);',
    "nawigacja po ekranach"
  );

  html = replaceRequired(
    html,
    '    ensureAccount().then(function (loggedIn) { if (loggedIn && !currentRoom) showScreen("menu"); });',
    '    document.querySelector("#account-tokens").textContent = authSession?.access_token ? document.querySelector("#account-tokens").textContent : "—";\n    showScreen("menu");\n    ensureAccount().then(function (loggedIn) { if (loggedIn && !currentRoom) showScreen("menu"); });',
    "start aplikacji jako gość"
  );

  cachedSource = source;
  cachedHtml = html;
  return html;
}

if (!express.response[PATCH_FLAG]) {
  const originalSendFile = express.response.sendFile;

  express.response.sendFile = function aigmv2SendFile(filePath, options, callback) {
    if (path.basename(String(filePath)) !== "index.html") {
      return originalSendFile.call(this, filePath, options, callback);
    }

    let actualOptions = options;
    let actualCallback = callback;
    if (typeof actualOptions === "function") {
      actualCallback = actualOptions;
      actualOptions = undefined;
    }

    fs.readFile(filePath, "utf8", (error, source) => {
      if (error) {
        if (typeof actualCallback === "function") actualCallback(error);
        else originalSendFile.call(this, filePath, actualOptions);
        return;
      }

      try {
        this.type("html").send(transformIndexHtml(source));
        if (typeof actualCallback === "function") actualCallback();
      } catch (transformError) {
        console.error("[AIGMV2 guest flow] Nie udało się przygotować strony:", transformError);
        if (typeof actualCallback === "function") actualCallback(transformError);
        else originalSendFile.call(this, filePath, actualOptions);
      }
    });

    return this;
  };

  express.response[PATCH_FLAG] = true;
  console.log("[AIGMV2 guest flow] menu dostępne przed logowaniem; konto wymagane przy wejściu do kampanii.");
}

module.exports = { transformIndexHtml };
