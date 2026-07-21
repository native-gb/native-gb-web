import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "playwright-core";

const origin = process.env.NATIVE_GB_WEB_ORIGIN || "http://127.0.0.1:8788";
const romPath = process.env.TETRIS_TEST_ROM ||
  fileURLToPath(new URL(
    "../../native-gb-tetris-modern/roms/Tetris (JUE) (V1.1) [!].gb",
    import.meta.url));
const artifactRoot = fileURLToPath(new URL("../artifacts/", import.meta.url));

function digest(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

async function storedPaths(page) {
  return page.evaluate(async () => {
    const name = "/native-gb/tetris/74591cc9501af93873f9a5d3eb12da12c0723bbc";
    const request = indexedDB.open(name);
    const database = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("FILE_DATA", "readonly");
    const keys = transaction.objectStore("FILE_DATA").getAllKeys();
    return new Promise((resolve, reject) => {
      keys.onsuccess = () => resolve(keys.result);
      keys.onerror = () => reject(keys.error);
    });
  });
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => { globalThis.__NATIVE_GB_TESTING__ = true; });
  const pageErrors = [];
  const requestedPaths = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));

  await page.goto(`${origin}/play/tetris/`);
  const input = page.locator("#rom-input");
  assert(!requestedPaths.some((path) => path.startsWith("/runtime/")),
         "the play route fetched a runtime before ROM verification");

  // Reject a cartridge-shaped but incompatible input without loading WASM.
  await input.setInputFiles({ name: "wrong.gb", mimeType: "application/octet-stream",
                              buffer: Buffer.alloc(32768) });
  await page.locator("#rom-status[data-kind=bad]").waitFor();
  assert.match(await page.locator("#rom-status").textContent(), /INCOMPATIBLE ROM/);
  assert(!requestedPaths.some((path) => path.startsWith("/runtime/")),
         "an incompatible ROM caused the runtime to load");

  // Launch the actual C++ runtime and prove that live frames are presented.
  await input.setInputFiles(romPath);
  await page.locator('#runtime-frame[data-running="true"]').waitFor({ timeout: 120000 });
  await page.waitForFunction(() => globalThis.__nativeGbTest);
  const freshPresentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert(!freshPresentation.interpolation);
  assert.equal(freshPresentation.renderRate, 60);
  assert.equal(freshPresentation.preset, 2, "fresh browser profile did not use Modern mode");
  assert.equal(freshPresentation.uiState, 0);
  assert(requestedPaths.some((path) => path.endsWith("/runtime/tetris/manifest.json")));
  assert(requestedPaths.some((path) => /\/runtime\/tetris\/.*\.wasm$/.test(path)));
  await page.waitForTimeout(750);
  const canvas = page.locator("#game-canvas");
  await mkdir(artifactRoot, { recursive: true });
  const first = await canvas.screenshot();
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-first.png` });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(750);
  const second = await canvas.screenshot();
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-second.png` });
  if (pageErrors.length)
    console.error(pageErrors);
  assert.notEqual(digest(first), digest(second), "the presented game frame did not change");

  // F1 must reach the native ImGui layer.
  await page.keyboard.press("F1");
  await page.waitForTimeout(250);
  const tools = await canvas.screenshot();
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-tools.png` });
  assert.notEqual(digest(second), digest(tools), "F1 did not change the native presentation");
  assert.equal((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).uiState, 15,
               "F1 did not open the complete Tetris tools workspace");

  // A second F1 closes every ImGui window.
  await page.keyboard.press("F1");
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).uiState, 0,
               "a second F1 did not close every ImGui window");

  // The player-facing controller and binding manager must also open in WASM.
  await page.keyboard.press("F2");
  await page.waitForTimeout(250);
  const controls = await canvas.screenshot();
  assert.notEqual(digest(second), digest(controls), "F2 did not open the Controls window");
  assert.equal((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).uiState, 4);

  // F1 is the universal close even when only Controls is open.
  await page.keyboard.press("F1");
  await page.waitForTimeout(100);
  assert.equal((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).uiState, 0);

  // Advance through game type, music, and level selection.
  for (let index = 0; index < 3; index += 1) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }
  const gameplayOne = await canvas.screenshot();
  await page.waitForTimeout(750);
  const gameplayTwo = await canvas.screenshot();
  assert.notEqual(digest(gameplayOne), digest(gameplayTwo),
                  "gameplay did not advance under the fixed-step loop");

  // The browser samples every RAF but C++ independently caps presentation.
  const pacing = await page.evaluate(() => {
    const test = globalThis.__nativeGbTest;
    test.setAutomaticFrames(false);
    const results = [];
    for (const rate of [60, 120, 144, 165, 240]) {
      test.setPresentation(0, true, rate);
      const before = test.snapshot();
      const after = test.advanceFrames(120, 1 / 240);
      results.push({
        rate,
        sampled: after.sampled - before.sampled,
        stepped: after.stepped - before.stepped,
        presented: after.presented - before.presented,
        effectiveRate: after.renderRate,
      });
    }
    test.setPresentation(0, false, 240);
    const beforeNoInterpolation = test.snapshot();
    const afterNoInterpolation = test.advanceFrames(120, 1 / 240);
    const noInterpolation = {
      effectiveRate: afterNoInterpolation.renderRate,
      presented: afterNoInterpolation.presented - beforeNoInterpolation.presented,
    };
    test.setPresentation(0, true, 240);
    const beforeSlowHost = test.snapshot();
    const afterSlowHost = test.advanceFrames(30, 1 / 60);
    const slowHost = afterSlowHost.presented - beforeSlowHost.presented;
    test.setAutomaticFrames(true);
    return { results, noInterpolation, slowHost };
  });
  for (const result of pacing.results) {
    assert.equal(result.sampled, 120, `${result.rate} Hz cap stopped host sampling`);
    assert(result.stepped >= 29 && result.stepped <= 31,
           `${result.rate} Hz cap changed fixed simulation cadence`);
    assert(result.presented > 0 && result.presented <= Math.ceil(result.rate / 2),
           `${result.rate} Hz browser presentation ceiling was exceeded`);
  }
  assert.equal(pacing.noInterpolation.effectiveRate, 60);
  assert(pacing.noInterpolation.presented <= 30,
         "interpolation-off browser presentation exceeded 60 Hz");
  assert.equal(pacing.slowHost, 30, "a 60 Hz host did not remain refresh-limited");

  // Hidden pages suspend native calls and restore without a catch-up burst.
  const beforeHidden = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(300);
  const whileHidden = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert(whileHidden.sampled - beforeHidden.sampled <= 1,
         "the hidden page continued invoking native frames");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(250);
  const afterHidden = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert(afterHidden.sampled > whileHidden.sampled, "the restored page did not resume");
  assert(afterHidden.stepped - whileHidden.stepped < 25,
         "visibility restore caused a fixed-step catch-up burst");

  // Exercise both renderers, automatic GPU failure fallback, and visual presets.
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(1, true, 60)));
  await page.waitForTimeout(250);
  let presentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(presentation.activeRenderer, 1);
  assert.equal(presentation.requestedRenderer, 1);
  assert.match(await page.evaluate(() => globalThis.__nativeGbTest.readSettings()),
               /^schema=12$/m);
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-cpu-enhanced.png` });
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPreset(0)));
  await page.waitForTimeout(150);
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-cpu-original.png` });
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(0, true, 60)));
  await page.waitForTimeout(150);
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-gpu-original.png` });
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPreset(1)));
  await page.evaluate(() => globalThis.__nativeGbTest.forceGpuFallback(true));
  await page.waitForTimeout(200);
  presentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(presentation.requestedRenderer, 0);
  assert.equal(presentation.activeRenderer, 1);
  await page.evaluate(() => globalThis.__nativeGbTest.forceGpuFallback(false));
  await page.waitForTimeout(200);
  presentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(presentation.activeRenderer, 0,
               "switching back to GPU required a runtime restart");
  await canvas.screenshot({ path: `${artifactRoot}/tetris-browser-gpu-enhanced.png` });

  // Leave CPU selected long enough for the normal autosave and IDBFS flush.
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(1, true, 60)));
  await page.waitForTimeout(1000);

  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name));
  assert(databases.includes("/native-gb/tetris/74591cc9501af93873f9a5d3eb12da12c0723bbc"));
  await page.waitForTimeout(1000);
  const paths = await storedPaths(page);
  assert(paths.some((path) => path.endsWith("/enhancements.cfg")));
  assert(paths.some((path) => path.endsWith("/high-scores.txt")));
  assert(paths.some((path) => path.endsWith("/binds_profiles/default.lisp")));

  // Reload into a fresh WASM instance and prove IDBFS restores the same files.
  await page.reload();
  await page.locator("#rom-input").setInputFiles(romPath);
  await page.locator('#runtime-frame[data-running="true"]').waitFor({ timeout: 120000 });
  await page.waitForFunction(() => globalThis.__nativeGbTest);
  await page.waitForTimeout(1000);
  const restoredPaths = await storedPaths(page);
  assert(paths.every((path) => restoredPaths.includes(path)));
  presentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(presentation.requestedRenderer, 1,
               "CPU renderer selection did not survive IDBFS reload");
  assert.equal(presentation.activeRenderer, 1);
  assert(presentation.browserManagedVsync,
         "the browser host did not report compositor-managed synchronization");
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(0, true, 60)));
  await page.waitForTimeout(200);
  presentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(presentation.activeRenderer, 0);

  // A previous Enhanced browser profile migrates to Modern, then saves the
  // current schema when a presentation choice changes.
  await page.evaluate(async () => {
    const test = globalThis.__nativeGbTest;
    test.setAutomaticFrames(false);
    test.writeSettings("schema=10\npreset=enhanced\n");
    await test.flush();
  });
  await page.reload();
  await page.locator("#rom-input").setInputFiles(romPath);
  await page.locator('#runtime-frame[data-running="true"]').waitFor({ timeout: 120000 });
  await page.waitForFunction(() => globalThis.__nativeGbTest);
  presentation = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(presentation.preset, 2, "previous Enhanced profile did not migrate to Modern");
  assert.equal(presentation.requestedRenderer, 0);
  assert(!presentation.interpolation);
  assert.equal(presentation.renderRate, 60);
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(1, false, 240)));
  await page.waitForTimeout(1000);
  await page.evaluate(() => globalThis.__nativeGbTest.flush());
  const migratedSettings = await page.evaluate(() => globalThis.__nativeGbTest.readSettings());
  assert.match(migratedSettings, /^schema=12$/m);
  assert.match(migratedSettings, /^renderer=cpu$/m);
  assert.match(migratedSettings, /^motion_interpolation=false$/m);
  assert.match(migratedSettings, /^render_rate_limit=240$/m);

  // Browser audio unlock and fullscreen stay user-gesture driven.
  await page.locator("#enable-audio").click();
  await page.locator("#enable-audio").waitFor({ state: "hidden" });
  await page.locator("#fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement?.id === "runtime-frame");
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => document.fullscreenElement === null);

  // The stage keeps its 16:9 game surface at desktop and compact sizes.
  for (const [width, height, name] of [[1920, 1080, "1920x1080"], [760, 620, "small"]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(250);
    const box = await page.locator("#runtime-frame").boundingBox();
    assert(Math.abs(box.width / box.height - 16 / 9) < 0.01);
    const canvasSize = await page.locator("#game-canvas").evaluate((canvas) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    assert.deepEqual(canvasSize, { width: Math.round(box.width), height: Math.round(box.height) });
    await page.screenshot({ path: `${artifactRoot}/tetris-browser-${name}.png`, fullPage: true });
  }
  assert.deepEqual(pageErrors, []);

  await page.screenshot({ path: `${artifactRoot}/tetris-browser-1280x720.png`,
                          fullPage: true });
  console.log("browser smoke passed");
} finally {
  await browser.close();
}
