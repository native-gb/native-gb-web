# Native GB Web

Static browser launcher for Native GB games. Tetris and the clean Super Mario
Land Modern implementation are playable runtimes. Neither Mario reference
implementation is a website build or runtime input; making those repositories
safe to share is separate future work.

No cartridge data is uploaded or included in a build.

## Build and run

Bootstrap the pinned Emscripten 6.0.3 SDK, install the browser-test dependency,
build the content-hashed runtime, and serve the site:

```sh
./scripts/bootstrap-emsdk.sh
npm ci
./scripts/build-tetris.sh
./scripts/serve.sh
```

Open `http://127.0.0.1:8788`, choose Tetris, and drop a compatible `.gb` file.
The supported image is 32,768 bytes with SHA-1
`74591cc9501af93873f9a5d3eb12da12c0723bbc`.

The build fetches the exact public Tetris commit named in
`runtime/tetris/source-version.sh` into an ignored cache. Set
`TETRIS_SOURCE_DIR` to use an explicit local checkout while developing. The
SDK, source cache, CMake tree, generated JavaScript, WebAssembly, screenshots,
and ROM remain ignored. A build emits hashed JavaScript and WebAssembly names
plus a small runtime manifest under `site/runtime/tetris/`.

SML Modern normally builds from its exact audited source commit. An explicit
local clean-implementation checkout can override that pin during development:

```sh
SML_SOURCE_DIR=../native-gb-super-mario-land-modern ./scripts/build-sml.sh
./scripts/test-sml-browser.sh
```

`runtime/sml/source-version.sh` pins the audited one-commit publication root.
The build refuses an unpinned remote source rather than silently using a moving
branch. The expected user ROM is 65,536 bytes with SHA-1
`418203621b887caa090215d97e3f509b79affd3e`.

## Tests

`./scripts/audit-distribution.py` checks the current publication inputs and all
reachable Git history for cartridge/media artifacts, generated WASM, private
runtime coupling, machine paths, and credential-like text. Use
`--current-only` only while preparing a verified history rewrite.

Run the complete web check with the ignored local ROM in the sibling Tetris
repository:

```sh
./scripts/check.sh
```

The check covers static catalog boundaries, JavaScript syntax, forbidden
tracked artifacts, incompatible-ROM rejection, a real headless WASM launch,
menu-to-gameplay input, live rendering, F1 ImGui, audio unlock, fullscreen,
GPU/CPU switching and fallback, every presentation ceiling, hidden-page resume,
schema-10 migration, IDBFS restoration, and responsive 1280x720, 1920x1080,
and compact layouts.
Set `TETRIS_TEST_ROM` when the ROM is elsewhere. Set
`NATIVE_GB_SKIP_BROWSER=1` only for a quick static check.

The SML Modern smoke additionally covers its enhanced/interpolated defaults,
direct-domain lifecycle, F1 deployed and F2 tester layouts, exact
60/120/144/165/240 presentation ceilings, fixed 59.7275 Hz simulation,
GPU/CPU switching and fallback, ROM-hash-namespaced settings restoration,
hidden-page suspension, responsive layouts, audio unlock, and fullscreen.
Set `SML_TEST_ROM` when its validation ROM is elsewhere.

## Runtime boundary

The catalog loads only HTML, CSS, catalog JavaScript, and small original site
art. Opening either play route does not fetch a game bundle. After the
browser hashes and accepts the ROM, the route loads `runtime.js`, its manifest,
the hashed Emscripten module, and WebAssembly.

The adapter mounts persistent storage, copies the verified bytes directly into
WASM memory, and calls the native `content::load_rom(std::span<...>)` path. The
ROM buffer is freed after extraction and is never written to IDBFS. JavaScript
drives the host with `requestAnimationFrame`; C++ keeps the simulation at
59.7275 fixed steps per second and independently skips presentation work above
the selected 60/120/144/165/240 Hz ceiling. Input is sampled on every delivered
RAF, so lowering the render ceiling does not discard button edges. JavaScript
suspends native calls while the page is hidden and resets elapsed time before
resuming. The browser compositor owns VSync.

SDL 3 owns the canvas, keyboard, browser Gamepad API devices, and Web Audio
stream. Gubsy owns bindings and the ImGui layer. SML Modern retains direct
sibling ownership of game state, clock, input, replay, motion, tools, audio,
and video; it does not introduce an `Application` or `App` aggregate for the
browser. Browser-only entry code, storage mounting, fullscreen, deployment,
and ROM-drop behavior stay here.

## Persistence

IDBFS is mounted at:

```text
/native-gb/<game-id>/<verified-rom-sha1>/
```

It stores progress/scores, enhancement settings, and Gubsy controller profiles.
Tetris F2 opens its Controls window; SML Modern uses F1 for deployed settings
and controls and F2 for the tester workspace.
Writes reach the virtual filesystem immediately and are flushed to IndexedDB
regularly, on visibility loss, and on page exit. Reload restoration is covered
by the browser smoke test. The separate `native-gb` metadata database records
only the verified filename and verification time; it does not contain ROM
bytes.

## Deployment

The Cloudflare Pages deployment is static and serverless. It builds and checks
both playable runtimes. From a clean commit with both source commits pinned:

```sh
./scripts/deploy-pages.sh
```

The script installs the pinned Node dependency, rebuilds the runtime, runs all
checks, creates the Pages project when needed, and deploys `site/` with
Wrangler 4.110.0. Set
`NATIVE_GB_PAGES_PROJECT` to override the default `native-gb-web` project.

Native GB is unofficial and is not affiliated with Nintendo or any game's
developers, publishers, or rights holders. Game names identify compatibility.
