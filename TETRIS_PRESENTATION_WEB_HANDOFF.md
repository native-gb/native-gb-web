# Tetris presentation changes — web runtime handoff

## Status

Implemented on 2026-07-20. The website is pinned to Tetris Modern commit
`f302337d211fd736851e0d69ab0180a9ae7b4c33`.

The shared application uses an explicit runtime host policy rather than a web
branch or a broad compile-time fork. Browser RAF calls continue to sample input
and advance the fixed simulation; C++ non-blockingly skips presentation above
the effective cap. JavaScript owns hidden-page suspension and elapsed-time
reset, while the Display UI reports VSync as browser-managed.

Chromium coverage exercises all five interpolated caps, the forced 60 Hz
non-interpolated cap, a slower host, visibility restore, GPU and CPU rendering,
automatic CPU fallback, live backend switching, settings persistence, and
schema-10 migration. The sections below retain the original handoff rationale
and acceptance contract.

## Goal

Adopt the current `native-gb-tetris-modern` presentation changes in the WASM
website without blocking the browser main thread or weakening the shared Native
GB presentation contract.

The desktop work already provides:

- a WebGL-compatible SDL texture-atlas renderer as the default;
- a selectable CPU software-raster fallback which uploads one completed frame;
- render-only active-piece interpolation over the fixed 59.7275 Hz simulation;
- persisted renderer, interpolation, render-rate, and vsync settings;
- a forced 60 Hz ceiling when interpolation is disabled;
- selectable 60, 120, 144, 165, and 240 Hz ceilings when interpolation is
  enabled;
- desktop inactive-window blocking and elapsed-time reset.

Do not redesign the game or renderer. This task is the browser adapter and its
validation.

## Current evidence

The local modified Tetris checkout was built through the website with:

```sh
TETRIS_SOURCE_DIR=../native-gb-tetris-modern \
  ./scripts/build-tetris.sh
```

The build succeeded under Emscripten 6.0.3 and SDL 3.4.0. The emitted bundle
was approximately 3.5 MiB of WASM and 232 KiB of JavaScript. `./scripts/check.sh`
then passed:

- all five static site tests;
- the cartridge/private-artifact bundle audit;
- actual WASM launch in headless Chromium;
- ROM verification, rendering, input, gameplay, ImGui, controls, audio unlock,
  fullscreen, responsive layouts, and IDBFS restoration.

This proves that the new source and GPU-default path compile and run in WebGL 2.
It does not prove all of the new host behavior described below.

## Confirmed gaps

### 1. Deployment is still pinned to the pre-change source

`runtime/tetris/source-version.sh` pins commit
`27279e962b3a562ab3ae426bf1305826f456bbfe`. The presentation work currently
exists as uncommitted changes on top of that commit. A normal website build
without `TETRIS_SOURCE_DIR` therefore builds the old clean source.

After the Tetris changes are committed and validated, update the website pin to
that exact public commit. Do not point deployment at a dirty checkout or branch
head.

### 2. Browser presentation ignores the selected hard ceiling

`site/play/tetris/runtime.js` invokes `_native_gb_frame(elapsed)` on every
`requestAnimationFrame`. `runtime/tetris/browser_main.cpp` calls
`tetris::step_application`, which always renders. The hard limiter in
`native-gb-tetris-modern/src/frame.cpp::pace` is called only from the desktop
`main.cpp`.

Consequences:

- a 240 Hz browser/display renders 240 frames per second even when the selected
  ceiling is 60;
- disabling interpolation does not enforce its required 60 Hz browser ceiling;
- the Display UI reports an effective cap which the browser adapter does not
  actually enforce;
- browser CPU/GPU work can scale to display refresh unnecessarily.

Implement a non-blocking browser ceiling. Suitable shapes include exporting the
current effective limit to JavaScript and throttling native frame delivery, or
letting C++ distinguish simulation sampling from presentation and skip renders
until due. Preserve input edge buffering and fixed-step accumulation. Do not
sleep or busy-wait on the browser thread.

### 3. Vsync is browser-managed

The browser compositor and `requestAnimationFrame` own synchronization. SDL's
`SDL_SetRenderVSync` setting is not an independent browser presentation control.
The UI should either report that synchronization is browser-managed or disable
the toggle for the WASM host. The persisted value may remain for settings-file
portability, but it must not imply control the browser does not provide.

### 4. Desktop inactive blocking must not run in WASM

Tetris Modern's inactive desktop path can call `SDL_WaitEvent` and
`SDL_Delay(50)`. Blocking an exported `_native_gb_frame` call can block the
browser main thread. The current browser JavaScript already observes
`visibilitychange`, flushes IDBFS, and resets its elapsed-time origin; browsers
also stop or heavily throttle hidden-page animation frames.

Add an explicit host policy/configuration so the WASM adapter does not enter the
desktop blocking path. JavaScript should own hidden-page suspension:

- do not call the native frame while the document is hidden;
- reset `previous` on visibility changes;
- resume without simulation catch-up;
- keep IDBFS flushing behavior;
- do not confuse loss of canvas keyboard focus with page visibility unless that
  is an explicit player setting.

Add a browser test which hides/backgrounds the page, restores it, and proves the
game resumes without a deadlock or a large fixed-step catch-up.

### 5. CPU raster is compiled but lacks a browser runtime test

`native-gb-tetris-modern/src/video/output.cpp` successfully compiles its
`SDL_CreateSoftwareRenderer` path for Emscripten. The existing browser smoke
starts from a fresh profile, whose default is GPU atlas, so it does not prove
the CPU selection works in a real browser.

Add a browser-visible test hook or a deterministic persisted-settings setup that
selects CPU raster before launch. Verify that:

- the game presents changing frames;
- the Display UI reports CPU raster as active;
- switching back to GPU succeeds without restarting;
- settings persist through IDBFS reload;
- failure to create the GPU resources automatically reaches CPU fallback;
- CPU and GPU screenshots are correct at representative original and enhanced
  scenes. Pixel identity is useful but visual/semantic correctness is the
  contract.

## Settings compatibility

The Tetris settings schema is now 11. Older browser `enhancements.cfg` files
remain loadable because parsing begins from current compiled defaults; missing
renderer/interpolation/rate/vsync keys therefore receive the new defaults.
Fresh profiles save the complete schema to the existing ROM-hash-namespaced
IDBFS mount.

Keep the following behavior:

- renderer defaults to GPU atlas;
- interpolation defaults off, producing discrete 60 Hz presentation;
- selected rate defaults to 60;
- interpolation off has an effective 60 Hz ceiling regardless of the stored
  selected rate;
- applying Original, Enhanced, or Modern visual/gameplay presets does not
  overwrite host renderer, interpolation, rate, or vsync choices.

## Files to inspect

Website:

- `runtime/tetris/source-version.sh`
- `runtime/tetris/browser_main.cpp`
- `runtime/tetris/CMakeLists.txt`
- `site/play/tetris/runtime.js`
- `tests/browser-smoke.js`
- `scripts/build-tetris.sh`
- `scripts/check.sh`

Tetris Modern:

- `src/application.cpp`
- `src/application.hpp`
- `src/frame.cpp`
- `src/frame.hpp`
- `src/window.cpp`
- `src/window.hpp`
- `src/settings.cpp`
- `src/settings.hpp`
- `src/video/backend.hpp`
- `src/video/interpolation.cpp`
- `src/video/output.cpp`
- `src/debug_menu.cpp`

Workspace policy:

- `../PRESENTATION_POLICY.md`

## Acceptance criteria

1. A normal pinned-source `./scripts/build-tetris.sh` includes the committed
   presentation changes.
2. The default browser renderer is the GPU atlas through SDL Renderer/WebGL 2.
3. CPU raster can be selected and exercised in Chromium, then switched back to
   GPU without a restart.
4. Interpolation visibly and semantically operates only on render positions;
   fixed simulation, input, replay, and audio cadence remain unchanged.
5. Interpolation off never presents more than 60 frames per second, including
   on a simulated/high-refresh browser schedule.
6. Every selected interpolated ceiling is a hard maximum; refresh rates below
   it naturally remain refresh-limited.
7. The browser implementation uses no `SDL_Delay`, `SDL_DelayPrecise`, busy
   loop, or blocking `SDL_WaitEvent` to enforce pacing.
8. Hidden/background pages stop simulation and presentation work, then resume
   without catch-up or deadlock.
9. Browser UI describes vsync as browser-managed rather than claiming an
   ineffective independent toggle.
10. Fresh and schema-10 IDBFS profiles load, save schema 12, and retain all host
    presentation choices after reload.
11. `./scripts/check.sh` passes with expanded coverage for CPU selection,
    interpolation, cap enforcement, and visibility restore.
12. The bundle audit remains clean and no ROM, WASM, generated module, capture,
    or build artifact is committed.

## Scope boundary

Do not fix the separate Super Mario Land widescreen gameplay defects as part of
this task. They are recorded in:

`../native-gb-super-mario-land-modern/docs/WIDESCREEN_PLAYTEST_2026-07-20.md`
