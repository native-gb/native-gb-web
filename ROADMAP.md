# Browser runtime roadmap

## Complete

- Static, serverless catalog with independently addressable game routes.
- Lazy runtime loading only after local ROM size and SHA-1 verification.
- Pinned Emscripten toolchain and reproducible SDL 3/Gubsy/ImGui build.
- Real native-gb-tetris-modern game, video, audio, controls, and tools in WASM.
- Direct in-memory ROM handoff; no cartridge upload or default persistence.
- RequestAnimationFrame presentation with a 59.7275 Hz fixed simulation.
- Enhanced default presentation, responsive 16:9 stage, and fullscreen.
- Keyboard and SDL browser-gamepad input using persistent Gubsy bindings.
- User-gesture audio resume for synthesized music and sound effects.
- ROM-hash-namespaced IndexedDB persistence for scores, settings, and bindings.
- Headless browser coverage for rejection, launch, input, rendering, ImGui,
  persistence, audio unlock, fullscreen, and responsive layouts.
- Content-hashed deploy bundles kept outside source control.
- Playable SML Modern catalog card, local-ROM launcher, direct-domain C++ browser
  lifecycle, Emscripten build, GPU/CPU renderer, RAF pacing, IDBFS persistence,
  bundle audit, and Chromium smoke coverage.

## Next games

Each game adds one catalog record, one play route, and one independently loaded
bundle. Shared browser host behavior remains here. Game logic and desktop
targets remain in their public game repositories. Private reverse-engineering
repositories are never build or deployment inputs.

Release work before reproducible public deployment:

1. Complete the qualified IP review; neither reference repository is part of
   this website release.
2. Deploy its pinned build only after every native/WASM/browser audit passes.
3. Shared touch controls if a game needs a phone-first presentation.
4. Optional, explicit remember-ROM support only after its privacy and storage
   interface is designed; ROMs remain memory-only by default.
