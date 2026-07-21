import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "playwright-core";

const origin = process.env.NATIVE_GB_WEB_ORIGIN || "http://127.0.0.1:8791";
const romPath = process.env.SML_TEST_ROM ||
  fileURLToPath(new URL(
    "../../native-gb-super-mario-land-modern/roms/Super Mario Land (World) (Rev A).gb",
    import.meta.url));

function digest(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.addInitScript(() => { globalThis.__NATIVE_GB_TESTING__ = true; });
  const pageErrors = [];
  const consoleErrors = [];
  const requestedPaths = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(message.text());
  });
  page.on("request", (request) => requestedPaths.push(new URL(request.url()).pathname));

  await page.goto(`${origin}/play/sml/`);
  const input = page.locator("#rom-input");
  assert(!requestedPaths.some((path) => path.startsWith("/runtime/")));
  await input.setInputFiles({ name: "wrong.gb", mimeType: "application/octet-stream",
                              buffer: Buffer.alloc(65536) });
  await page.locator("#rom-status[data-kind=bad]").waitFor();
  assert(!requestedPaths.some((path) => path.startsWith("/runtime/")));

  await input.setInputFiles(romPath);
  try {
    await page.locator('#runtime-frame[data-running="true"]').waitFor({ timeout: 30000 });
  } catch (error) {
    console.error("launcher status:", await page.locator("#rom-status").textContent());
    console.error("browser console:", consoleErrors);
    console.error("page errors:", pageErrors);
    throw error;
  }
  await page.waitForFunction(() => globalThis.__nativeGbTest?.snapshot().presented > 0);
  let state = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert(state.interpolation, "SML Modern did not default to interpolation");
  assert.equal(state.renderRate, 60);
  assert.equal(state.behavior, 1, "SML Modern did not default to enhanced behavior");
  assert(state.browserManagedVsync);
  assert(requestedPaths.some((path) => path.endsWith("/runtime/sml/manifest.json")));
  assert(requestedPaths.some((path) => /\/runtime\/sml\/.*\.wasm$/.test(path)));

  const canvas = page.locator("#game-canvas");
  const first = await canvas.screenshot();
  const beforeStart = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  await page.keyboard.down("Enter");
  await page.waitForTimeout(100);
  await page.keyboard.up("Enter");
  await page.waitForTimeout(1500);
  const second = await canvas.screenshot();
  const afterStart = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert(afterStart.stepped > beforeStart.stepped, "SML Modern simulation did not advance");
  assert.notEqual(afterStart.phase, beforeStart.phase, "Start did not leave the title phase");

  await page.keyboard.press("F1");
  await page.waitForTimeout(250);
  const tools = await canvas.screenshot();
  assert.notEqual(digest(first), digest(tools), "F1 did not open Modern ImGui tools");
  assert.notEqual((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).uiState, 0);
  await page.keyboard.down("F1");
  await page.waitForTimeout(100);
  await page.keyboard.up("F1");
  await page.keyboard.down("F2");
  await page.waitForTimeout(100);
  await page.keyboard.up("F2");
  await page.waitForTimeout(200);
  assert.notEqual((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).uiState, 0,
                  "F2 did not open the Modern tester workspace");
  await page.keyboard.down("F2");
  await page.waitForTimeout(100);
  await page.keyboard.up("F2");

  const pacing = await page.evaluate(() => {
    const test = globalThis.__nativeGbTest;
    test.setAutomaticFrames(false);
    const results = [];
    for (const rate of [60, 120, 144, 165, 240]) {
      test.setPresentation(0, true, rate);
      const before = test.snapshot();
      const after = test.advanceFrames(120, 1 / 240);
      results.push({ rate, effectiveRate: after.renderRate,
                     sampled: after.sampled - before.sampled,
                     stepped: after.stepped - before.stepped,
                     presented: after.presented - before.presented });
    }
    test.setPresentation(0, false, 240);
    const before = test.snapshot();
    const after = test.advanceFrames(120, 1 / 240);
    test.setAutomaticFrames(true);
    return { results, noInterpolation: after.presented - before.presented,
             effectiveRate: after.renderRate };
  });
  for (const result of pacing.results) {
    assert.equal(result.sampled, 120);
    assert(result.stepped >= 29 && result.stepped <= 31);
    assert(result.presented > 0 && result.presented <= Math.ceil(result.rate / 2));
  }
  assert.equal(pacing.effectiveRate, 60);
  assert(pacing.noInterpolation <= 30);

  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(1, true, 60)));
  await page.waitForTimeout(200);
  state = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(state.activeRenderer, 1);
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(0, true, 60)));
  await page.evaluate(() => globalThis.__nativeGbTest.forceGpuFallback(true));
  await page.waitForTimeout(200);
  state = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(state.requestedRenderer, 0);
  assert.equal(state.activeRenderer, 1);
  await page.evaluate(() => globalThis.__nativeGbTest.forceGpuFallback(false));
  await page.waitForTimeout(200);
  assert.equal((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).activeRenderer, 0);

  const beforeHidden = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(250);
  const whileHidden = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert(whileHidden.sampled - beforeHidden.sampled <= 1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  assert((await page.evaluate(() => globalThis.__nativeGbTest.snapshot())).sampled >
         whileHidden.sampled);

  assert.match(await page.evaluate(() => globalThis.__nativeGbTest.readSettings()),
               /^schema=/m);

  // Settings live under the game/ROM namespace and survive a fresh WASM instance.
  assert(await page.evaluate(() => globalThis.__nativeGbTest.setPresentation(1, true, 144)));
  await page.waitForTimeout(1000);
  await page.evaluate(() => globalThis.__nativeGbTest.flush());
  const savedSettings = await page.evaluate(() => globalThis.__nativeGbTest.readSettings());
  assert.match(savedSettings, /^renderer=cpu$/m);
  assert.match(savedSettings, /^render_rate_limit=144$/m);
  await page.reload();
  await page.locator("#rom-input").setInputFiles(romPath);
  await page.locator('#runtime-frame[data-running="true"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => globalThis.__nativeGbTest?.snapshot().presented > 0);
  state = await page.evaluate(() => globalThis.__nativeGbTest.snapshot());
  assert.equal(state.requestedRenderer, 1);
  assert.equal(state.activeRenderer, 1);
  assert.equal(state.renderRate, 144);

  for (const [width, height] of [[1920, 1080], [760, 620]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const box = await page.locator("#runtime-frame").boundingBox();
    assert(Math.abs(box.width / box.height - 16 / 9) < 0.01);
  }
  if (await page.locator("#enable-audio").isVisible())
    await page.locator("#enable-audio").click();
  await page.locator("#enable-audio").waitFor({ state: "hidden" });
  await page.locator("#fullscreen").click();
  await page.waitForFunction(() => document.fullscreenElement?.id === "runtime-frame");
  await page.evaluate(() => document.exitFullscreen());
  assert.deepEqual(pageErrors, []);
  console.log("SML Modern browser smoke passed");
} finally {
  await browser.close();
}
