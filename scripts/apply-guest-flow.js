"use strict";

const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "index.html");
let html = fs.readFileSync(filePath, "utf8");

function replaceOnce(searchValue, replacement, label) {
  if (html.includes(searchValue)) {
    html = html.replace(searchValue, replacement);
    return;
  }
  if (!html.includes(replacement)) throw new Error(`Nie znaleziono fragmentu: ${label}`);
}

replaceOnce(
  '<span class="viz-badge">◆ <span id="account-tokens">8</span> tokenów</span>',
  '<span class="viz-badge">◆ <span id="account-tokens">—</span> tokenów</span>',
  "saldo gościa"
);

replaceOnce(
  '<section class="app-screen" data-screen="auth">',
  '<section class="app-screen" data-screen="auth" hidden>',
  "ukrycie logowania na wejściu"
);

replaceOnce(
  '<section class="app-screen" data-screen="menu" hidden>',
  '<section class="app-screen" data-screen="menu">',
  "pokazanie menu na wejściu"
);

replaceOnce(
  '<div class="app-header"><div><h1>Twoje konto gracza</h1><div class="app-muted">Zaloguj się, aby grać online i zachować tokeny.</div></div></div>',
  '<div class="app-header"><div><h1>Twoje konto gracza</h1><div class="app-muted">Zaloguj się lub utwórz konto, aby rozpocząć albo dołączyć do kampanii.</div></div><button class="btn" type="button" data-go="menu">← Wróć</button></div>',
  "nagłówek logowania"
);

replaceOnce(
  '    let accountLoadPromise = null;\n',
  '    let accountLoadPromise = null;\n    let pendingScreen = "menu";\n',
  "pendingScreen"
);

replaceOnce(
  '      if (!authSession?.access_token) { showScreen("auth"); return false; }',
  '      if (!authSession?.access_token) return false;',
  "ciche sprawdzanie sesji"
);

replaceOnce(
  '        if (!authSession?.refresh_token) { showScreen("auth"); return false; }',
  '        if (!authSession?.refresh_token) {\n          localStorage.removeItem("aigmv2-auth-session");\n          authSession = null;\n          document.querySelector("#account-name").textContent = "Gość";\n          document.querySelector("#account-tokens").textContent = "—";\n          document.querySelector("#logout-button").hidden = true;\n          return false;\n        }',
  "brak refresh tokena"
);

const staleRefreshFailure = '          localStorage.removeItem("aigmv2-auth-session");\n          authSession = null;\n          showScreen("auth");\n          return false;';
const silentRefreshFailure = '          localStorage.removeItem("aigmv2-auth-session");\n          authSession = null;\n          document.querySelector("#account-name").textContent = "Gość";\n          document.querySelector("#account-tokens").textContent = "—";\n          document.querySelector("#logout-button").hidden = true;\n          return false;';
if (html.includes(staleRefreshFailure)) html = html.replace(staleRefreshFailure, silentRefreshFailure);

replaceOnce(
  '    function ensureAccount() {\n      if (!accountLoadPromise) accountLoadPromise = loadAccount().finally(function () { accountLoadPromise = null; });\n      return accountLoadPromise;\n    }',
  '    function ensureAccount() {\n      if (!accountLoadPromise) accountLoadPromise = loadAccount().finally(function () { accountLoadPromise = null; });\n      return accountLoadPromise;\n    }\n\n    async function openProtectedScreen(name) {\n      pendingScreen = name;\n      if (await ensureAccount()) {\n        pendingScreen = "menu";\n        showScreen(name);\n        return;\n      }\n      setAuthMode("login");\n      showScreen("auth");\n    }',
  "ochrona ekranów kampanii"
);

replaceOnce(
  '        await ensureAccount();\n        showScreen("menu");',
  '        if (!(await ensureAccount())) throw new Error("Nie udało się wczytać konta.");\n        const destination = pendingScreen || "menu";\n        pendingScreen = "menu";\n        showScreen(destination);',
  "powrót po logowaniu"
);

replaceOnce(
  '      document.querySelector("#account-name").textContent = "Gość";\n      document.querySelector("#logout-button").hidden = true;\n      showScreen("auth");',
  '      document.querySelector("#account-name").textContent = "Gość";\n      document.querySelector("#account-tokens").textContent = "—";\n      document.querySelector("#logout-button").hidden = true;\n      pendingScreen = "menu";\n      showScreen("menu");',
  "wylogowanie do menu"
);

replaceOnce(
  '      if (goButton) {\n        if (goButton.dataset.go === "menu" && currentRoom && socket) {',
  '      if (goButton) {\n        const destination = goButton.dataset.go;\n        if (["setup", "join", "saves"].includes(destination)) {\n          event.preventDefault();\n          openProtectedScreen(destination);\n          return;\n        }\n        if (destination === "menu") pendingScreen = "menu";\n        if (destination === "menu" && currentRoom && socket) {',
  "ochrona nawigacji"
);

if (html.includes('        showScreen(goButton.dataset.go);')) {
  html = html.replace('        showScreen(goButton.dataset.go);', '        showScreen(destination);');
}

replaceOnce(
  '    ensureAccount().then(function (loggedIn) { if (loggedIn && !currentRoom) showScreen("menu"); });',
  '    document.querySelector("#account-tokens").textContent = authSession?.access_token ? document.querySelector("#account-tokens").textContent : "—";\n    showScreen("menu");\n    ensureAccount().then(function (loggedIn) { if (loggedIn && !currentRoom) showScreen("menu"); });',
  "start jako gość"
);

fs.writeFileSync(filePath, html);
console.log("Zastosowano logowanie dopiero przy kampanii w index.html.");
