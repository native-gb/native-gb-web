const bundleRoot = new URL("../../runtime/sml/", import.meta.url);

async function loadModuleFactory() {
  const response = await fetch(new URL("manifest.json", bundleRoot));
  if (!response.ok)
    throw new Error(`runtime manifest request returned ${response.status}`);
  const manifest = await response.json();
  if (!manifest.module || !manifest.wasm)
    throw new Error("runtime manifest is incomplete");
  return import(new URL(manifest.module, bundleRoot).href);
}

function syncFilesystem(module, populate) {
  return new Promise((resolve, reject) => {
    module.FS.syncfs(populate, (error) => error ? reject(error) : resolve());
  });
}

function makeDirectory(module, path) {
  try {
    module.FS.mkdir(path);
  } catch (error) {
    if (!String(error).includes("File exists"))
      throw error;
  }
}

async function mountStorage(module, gameId, romSha1) {
  makeDirectory(module, "/native-gb");
  makeDirectory(module, `/native-gb/${gameId}`);
  const path = `/native-gb/${gameId}/${romSha1}`;
  makeDirectory(module, path);
  module.FS.mount(module.FS.filesystems.IDBFS, {}, path);
  await syncFilesystem(module, true);
  return path;
}

export async function start({ rom, canvas, gameId, romSha1, onStopped }) {
  const createModule = (await loadModuleFactory()).default;
  const module = await createModule({
    canvas,
    locateFile: (file) => new URL(file, bundleRoot).href,
    print: (line) => console.log(`[${gameId}] ${line}`),
    printErr: (line) => console.error(`[${gameId}] ${line}`),
  });
  const dataRoot = await mountStorage(module, gameId, romSha1);

  const pointer = module._malloc(rom.byteLength);
  module.HEAPU8.set(rom, pointer);
  const started = module.ccall("native_gb_start", "number",
    ["number", "number", "string"], [pointer, rom.byteLength, dataRoot]);
  module._free(pointer);
  if (!started) {
    const message = module.ccall("native_gb_last_error", "string", [], []);
    throw new Error(message || "SML Modern runtime initialization failed");
  }

  let running = true;
  let previous = performance.now();
  let suspended = document.hidden;
  let automaticFrames = true;
  let syncPending = false;
  let lastSync = previous;

  const detachPageEvents = () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", pageHide);
  };
  const flush = async () => {
    if (syncPending)
      return;
    syncPending = true;
    try {
      await syncFilesystem(module, false);
    } finally {
      syncPending = false;
    }
  };
  const frame = (now) => {
    if (!running)
      return;
    if (suspended || !automaticFrames) {
      previous = now;
      requestAnimationFrame(frame);
      return;
    }
    const elapsed = Math.min((now - previous) / 1000, 0.25);
    previous = now;
    running = Boolean(module._native_gb_frame(elapsed));
    if (now - lastSync >= 750) {
      lastSync = now;
      void flush();
    }
    if (running) {
      requestAnimationFrame(frame);
    } else {
      detachPageEvents();
      void flush();
      onStopped?.();
    }
  };
  const visibility = () => {
    suspended = document.hidden;
    if (suspended)
      void flush();
    previous = performance.now();
  };
  const pageHide = () => void flush();
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pageHide);
  requestAnimationFrame(frame);

  const test = {
    snapshot() {
      return {
        sampled: module._native_gb_debug_sampled_frames(),
        stepped: module._native_gb_debug_simulation_steps(),
        presented: module._native_gb_debug_presented_frames(),
        activeRenderer: module._native_gb_debug_active_renderer(),
        requestedRenderer: module._native_gb_debug_requested_renderer(),
        interpolation: Boolean(module._native_gb_debug_interpolation()),
        renderRate: module._native_gb_debug_render_rate(),
        behavior: module._native_gb_debug_behavior(),
        worldPolicy: module._native_gb_debug_world_policy(),
        zoom: module._native_gb_debug_zoom(),
        phase: module._native_gb_debug_phase(),
        browserManagedVsync: Boolean(module._native_gb_debug_browser_managed_vsync()),
        uiState: module._native_gb_debug_ui_state(),
        overlaysVisible: Boolean(module._native_gb_debug_overlays_visible()),
      };
    },
    setPresentation(renderer, interpolation, rate) {
      return Boolean(module._native_gb_debug_set_presentation(
        renderer, interpolation ? 1 : 0, rate));
    },
    setBehavior(behavior) {
      return Boolean(module._native_gb_debug_set_behavior(behavior));
    },
    forceGpuFallback(forced) {
      module._native_gb_debug_force_gpu_fallback(forced ? 1 : 0);
    },
    setAutomaticFrames(enabled) {
      automaticFrames = enabled;
      previous = performance.now();
    },
    advanceFrames(count, elapsed) {
      if (automaticFrames)
        throw new Error("disable automatic frames before advancing the runtime directly");
      for (let index = 0; index < count && running; index += 1)
        running = Boolean(module._native_gb_frame(elapsed));
      return this.snapshot();
    },
    readSettings() {
      return module.FS.readFile(`${dataRoot}/settings.cfg`, { encoding: "utf8" });
    },
    writeSettings(contents) {
      module.FS.writeFile(`${dataRoot}/settings.cfg`, contents);
    },
    flush,
  };

  return {
    resumeAudio() {
      return Boolean(module._native_gb_audio_resume());
    },
    async stop() {
      if (!running)
        return;
      running = false;
      module._native_gb_shutdown();
      await flush();
      detachPageEvents();
    },
    test,
  };
}
