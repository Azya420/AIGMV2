"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

const PATCH_FLAG = Symbol.for("aigmv2.guestEntryPatched");
let cachedSource = null;
let cachedHtml = null;

const PENDING_DECLARATION = '    let pendingScreen = "menu";';
const PROTECTED_SCREEN_FUNCTION = `    async function openProtectedScreen(name) {
      pendingScreen = name;
      if (await ensureAccount()) {
        pendingScreen = "menu";
        showScreen(name);
        return;
      }
      setAuthMode("login");
      showScreen("auth");
    }`;

function keepSingleOccurrence(source, value) {
  const firstIndex = source.indexOf(value);
  if (firstIndex < 0) return source;
  const beforeAndFirst = source.slice(0, firstIndex + value.length);
  const afterFirst = source.slice(firstIndex + value.length).split(value).join("");
  return beforeAndFirst + afterFirst;
}

function transformIndexHtml(source) {
  if (source === cachedSource && cachedHtml) return cachedHtml;

  let html = source;

  // The repository now contains the guest flow directly. This preload only
  // normalizes older deployments and removes duplicate patches safely.
  html = html
    .replace(
      '<span class="viz-badge">◆ <span id="account-tokens">8</span> tokenów</span>',
      '<span class="viz-badge">◆ <span id="account-tokens">—</span> tokenów</span>'
    )
    .replace(
      /<section class="app-screen" data-screen="auth"(?: hidden)?>/,
      '<section class="app-screen" data-screen="auth" hidden>'
    )
    .replace(
      /<section class="app-screen" data-screen="menu"(?: hidden)?>/,
      '<section class="app-screen" data-screen="menu">'
    );

  html = keepSingleOccurrence(html, PENDING_DECLARATION);
  html = keepSingleOccurrence(html, PROTECTED_SCREEN_FUNCTION);

  // If an older index.html is deployed, add the missing declaration/function
  // once, without ever duplicating them on subsequent requests.
  if (!html.includes(PENDING_DECLARATION)) {
    html = html.replace(
      "    let accountLoadPromise = null;",
      `    let accountLoadPromise = null;\n${PENDING_DECLARATION}`
    );
  }

  if (!html.includes(PROTECTED_SCREEN_FUNCTION)) {
    const ensureAccountBlock = `    function ensureAccount() {
      if (!accountLoadPromise) accountLoadPromise = loadAccount().finally(function () { accountLoadPromise = null; });
      return accountLoadPromise;
    }`;
    html = html.replace(
      ensureAccountBlock,
      `${ensureAccountBlock}\n\n${PROTECTED_SCREEN_FUNCTION}`
    );
  }

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
  console.log("[AIGMV2 guest flow] menu gościa aktywne; duplikaty skryptu są usuwane.");
}

module.exports = { transformIndexHtml };
