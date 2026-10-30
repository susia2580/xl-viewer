# Contributing

Thanks for helping. xl-viewer is a read-only viewer; please open an issue before starting on anything that changes scope (editing, formula evaluation and similar requests are out of scope).

## Setup

- Node 24 (`.nvmrc`) and pnpm via corepack: `corepack enable`
- `pnpm install`
- Python 3 for fixture generators: `python3 -m venv .venv && .venv/bin/pip install -r fixtures/scripts/requirements.txt`
- Playwright browsers: `pnpm exec playwright install`

## Commands

| Command                                      | What it does                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm dev`                                   | Playground at http://localhost:5199                                                   |
| `pnpm test`                                  | Unit, parser and paint tests (Vitest)                                                 |
| `pnpm typecheck`, `pnpm lint`, `pnpm format` | Static checks                                                                         |
| `pnpm build`                                 | Build both packages                                                                   |
| `pnpm shot <fixture>`                        | Render a fixture to `.shots/` (`--sheet`, `--mouse x,y`, `--scroll x,y`, `--browser`) |
| `pnpm size`                                  | Bundle size against the budget                                                        |
| `pnpm perf`                                  | Parse and paint timing for the 100k-row file                                          |
| `pnpm visual:docker`                         | Visual regression in the pinned Linux image                                           |
| `node scripts/consumer-check.mjs`            | Install the packed package into Vite and webpack 5 apps and check the worker          |

## Fixtures

- Never commit real business files. `.gitignore` blocks every `.xlsx` except generated ones and the reviewed files listed there.
- Add generator code to `fixtures/scripts/generate.py` and run `pnpm fixtures` (`-- --large` for the perf file).
- Files saved by other apps (Excel, Numbers, LibreOffice, Google Sheets) are welcome when they contain fake data only. Strip author metadata from `docProps/core.xml`.
- If you report a bug with a sample file, remove anything sensitive first. We ask before turning a reported file into a fixture.

## Visual tests

Baselines come only from the Linux container, where fonts are fixed. A maintainer approves new baselines by comparing them with Excel side by side (see `fixtures/reference/`). Run `pnpm visual:docker -- --update-snapshots` to regenerate, or use the "Visual baselines" workflow.

## Clean-room rule

Do not read, decompile or copy code from commercial spreadsheet products (SpreadJS and others), including through reverse-engineering tools. Reference material is limited to ECMA-376, Microsoft's published specifications (for example [MS-OI29500]) and permissively licensed open source.

## Code style

- TypeScript strict. Comments in English, short, only where the code isn't obvious.
- All text shown on screen goes through the locale files in `packages/core/src/locales/`.
- Never put file content into the DOM with `innerHTML`; use `textContent`.
- New dependencies: permissive licences only (no GPL/AGPL), check `pnpm audit` and `pnpm size`.

## Adding a language

1. Copy `packages/core/src/locales/en.ts` to `<code>.ts` and translate `messages`.
2. Fill `builtinFormats` with the region's built-in number format codes (ECMA-376 Part 1, 18.8.30).
3. Add the entry in `packages/core/vite.config.ts` (`lib.entry`) and the `./locales/<code>` export in `packages/core/package.json`.
4. Add a parser test that formats a date with the new locale.

## Commits and releases

- Conventional Commits (`feat:`, `fix:`, `docs:` ...).
- Add a changeset with `pnpm changeset` for anything that affects a published package. Releases are published from CI only.
