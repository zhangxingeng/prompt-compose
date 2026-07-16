# Contributing

## Stack

- **Frontend:** SvelteKit (Svelte 5, TypeScript), built as a static SPA via `@sveltejs/adapter-static`.
- **Backend:** Tauri v2 (Rust). Rust owns the filesystem (the Markdown snippet store, the app-local roster) and the semantic-match machinery; the frontend owns rendering and the variable grammar.
- **Package manager:** pnpm.

## Setup

```bash
pnpm install
```

For the native desktop app you also need the Rust toolchain and the Tauri system
dependencies for your platform — see https://v2.tauri.app/start/prerequisites/.

## Run

```bash
pnpm dev       # frontend only, in a browser — uses a seeded in-memory store
pnpm tauri dev # the full native desktop app
```

`pnpm dev` runs the whole UI in a plain browser against a bundled sample library
(no native shell needed), which is the fastest way to feel-check a change.

## Verify

Run these before committing:

```bash
pnpm check                    # svelte-check type-check
pnpm test:smoke               # the variable-grammar + compose-box logic vectors
pnpm build                    # production frontend build
cd src-tauri && cargo test --lib   # the Rust module tests
```

CI (`.github/workflows/ci.yml`) runs the same four on every push/PR to `main`.

## Where things live

- `src/lib/compose/` — the variable grammar (`variables.ts`) and the compose-box node model (`doc.ts`). `tests/prompts_smoke.mjs` is the whole safety net for this logic; there is no second implementation.
- `src/lib/prompts.svelte.ts` — the reactive store (Svelte 5 runes).
- `src/lib/components/prompts/` — the compose box, match panel, project tabs, and modals.
- `src/lib/api.ts` + `src/lib/prompts/types.ts` — the TypeScript side of the Rust command seam. It mirrors `src-tauri/src/prompts/` by hand, because `pnpm check` cannot verify a Rust↔TS signature; keep both sides in step.
- `src-tauri/src/prompts/` — the snippet store, the app-local roster, and the hybrid match engine (lexical + semantic).
- `src-tauri/src/datadir.rs` — resolves the `~/.prompt-compose` data root (env `PROMPT_COMPOSE_DATA_DIR` overrides, for tests).

## Design

Read `project_docs/prompts-design.md` (engineering) and `project_docs/prompts-ux.md`
(interaction) before a non-trivial change — they carry the reasoning behind the
current shape.
