import { writeGameData } from "../../storage.js";

const gameId = "sml-modern";
const expectedSha1 = "418203621b887caa090215d97e3f509b79affd3e";
const expectedSize = 65536;

const frame = document.querySelector("#runtime-frame");
const canvas = document.querySelector("#game-canvas");
const dropZone = document.querySelector("#drop-zone");
const input = document.querySelector("#rom-input");
const status = document.querySelector("#rom-status");
const fullscreen = document.querySelector("#fullscreen");
const enableAudio = document.querySelector("#enable-audio");
let activeRuntime = null;

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha1(buffer) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-1", buffer)));
}

function report(message, kind = "") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function resumeActiveAudio() {
  if (activeRuntime?.resumeAudio())
    enableAudio.hidden = true;
}

async function findGame() {
  const response = await fetch("../../catalog.json");
  if (!response.ok)
    throw new Error(`Catalog request returned ${response.status}`);
  const catalog = await response.json();
  const game = catalog.games.find((candidate) => candidate.id === gameId);
  if (!game)
    throw new Error("SML Modern is missing from the catalog");
  return game;
}

async function launch(file) {
  if (activeRuntime) {
    await activeRuntime.stop();
    activeRuntime = null;
    delete globalThis.__nativeGbTest;
  }
  report("READING CARTRIDGE…");
  const bytes = await file.arrayBuffer();
  const digest = await sha1(bytes);
  if (bytes.byteLength !== expectedSize || digest !== expectedSha1) {
    report(`INCOMPATIBLE ROM — ${bytes.byteLength} BYTES / SHA-1 ${digest}`, "bad");
    return;
  }

  await writeGameData(gameId, digest, "last-verified-rom", {
    name: file.name,
    verifiedAt: new Date().toISOString(),
  });
  const game = await findGame();
  if (!game.browser.ready || !game.browser.module) {
    report("ROM VERIFIED. THE SML MODERN BROWSER BUILD IS UNAVAILABLE.", "good");
    return;
  }

  report("STARTING SML MODERN…", "good");
  const runtime = await import(`../../${game.browser.module}`);
  frame.dataset.loading = "true";
  canvas.focus();
  try {
    activeRuntime = await runtime.start({
      rom: new Uint8Array(bytes),
      canvas,
      gameId,
      romSha1: digest,
      onStopped: () => {
        activeRuntime = null;
        delete globalThis.__nativeGbTest;
        frame.dataset.running = "false";
        frame.dataset.loading = "false";
        enableAudio.hidden = true;
        report("SML MODERN STOPPED. SUPPLY THE CARTRIDGE TO START AGAIN.");
      },
    });
    if (globalThis.__NATIVE_GB_TESTING__)
      globalThis.__nativeGbTest = activeRuntime.test;
    frame.dataset.loading = "false";
    frame.dataset.running = "true";
    canvas.focus();
    enableAudio.hidden = false;
  } catch (error) {
    console.error(error);
    frame.dataset.loading = "false";
    frame.dataset.running = "false";
    throw error;
  }
}

input.addEventListener("change", () => {
  const [file] = input.files;
  input.value = "";
  if (file)
    launch(file).catch((error) => report(`COULD NOT START: ${error.message}`, "bad"));
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.dataset.dragging = "true";
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.dataset.dragging = "false";
  });
}

dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file)
    launch(file).catch((error) => report(`COULD NOT START: ${error.message}`, "bad"));
});

fullscreen.addEventListener("click", async () => {
  if (document.fullscreenElement)
    await document.exitFullscreen();
  else
    await frame.requestFullscreen();
});

document.addEventListener("fullscreenchange", () => {
  fullscreen.textContent = document.fullscreenElement ? "EXIT FULLSCREEN" : "FULLSCREEN";
});

enableAudio.addEventListener("click", resumeActiveAudio);
document.addEventListener("keydown", resumeActiveAudio);
document.addEventListener("pointerdown", resumeActiveAudio);
