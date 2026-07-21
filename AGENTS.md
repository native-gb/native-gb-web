## Organization

- Keep the site static and serverless.
- Keep catalog code independent from game runtimes.
- Load a game's JavaScript and WebAssembly only after the user opens its play page and supplies a verified ROM.
- Keep files focused and generally below 500 lines.

## Style

- Prefer plain HTML, CSS, and JavaScript over framework machinery.
- Use direct control flow, explicit state, and small functions.
- Keep browser storage and ROM handling easy to inspect.
- Do not add generated bundles, ROMs, extracted assets, or cartridge-derived screenshots.

## ROM handling

- Hash ROMs locally with the browser Web Crypto API.
- Never upload a ROM or extracted content.
- Do not persist a ROM unless the user explicitly opts in.
- Namespace persistent data by game ID and verified ROM SHA-1.

## Deployment

- The deployable directory is `site/`.
- Cloudflare Pages is the intended host.
- Run `./scripts/check.sh` before publishing.
