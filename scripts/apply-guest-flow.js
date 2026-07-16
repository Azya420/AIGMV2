"use strict";

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const requiredFragments = [
  '<section class="app-screen" data-screen="auth" hidden>',
  '<section class="app-screen" data-screen="menu">',
  'let pendingScreen = "menu";',
  "async function openProtectedScreen(name)",
  'showScreen("menu");'
];

const missing = requiredFragments.filter(function (fragment) { return !html.includes(fragment); });
if (missing.length) {
  throw new Error("Brakuje elementów szybkiego menu gościa: " + missing.join(", "));
}

console.log("Szybkie menu gościa jest poprawnie skonfigurowane.");
