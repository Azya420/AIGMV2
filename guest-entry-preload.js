"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");

const PATCH_FLAG = Symbol.for("aigmv2.guestEntryPatched");
let cachedSource = null;
let cachedHtml = null;

function transformIndexHtml(source) {
  if (source === cachedSource && cachedHtml) return cachedHtml;

  const html = source
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
  console.log("[AIGMV2 guest flow] szybkie menu gościa aktywne.");
}

module.exports = { transformIndexHtml };
