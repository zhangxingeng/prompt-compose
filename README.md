# Prompt Compose

An offline desktop app for managing prompt snippets — built with Tauri v2 and SvelteKit.

## What it is

- **A snippet is a Markdown file.** Its filename (minus `.md`) is its name; the file's whole content is the prompt. No database, no schema, no ids — the filesystem is the source of truth.
- **A project is a folder.** Point Prompt Compose at any folder and every `*.md` inside it, recursively, becomes a snippet. Because your library is just Markdown files in a folder, you can keep it in your own git repo and read the diffs.
- **Variables are Python-style format strings.** Write `{name}` anywhere in a snippet and it becomes a fillable variable — uniformly, code fences included. Double the braces (`{{`, `}}`) to emit a literal brace, exactly as in Python. There is no special protocol to learn.
- **Compose, fill, copy.** Insert snippets into a compose box, fill their variables once (a repeated variable shares one value), and copy the assembled prompt.
- **Offline by design.** Your prompts never leave your machine: the app **only ever fetches, never sends**, and nothing you write is uploaded anywhere. It makes exactly two kinds of network request, neither of which its core job depends on. An optional semantic-match model improves result ranking; it downloads silently in the background and its absence only falls back to instant lexical match. And it checks for its own updates on launch — those artifacts are cryptographically signed, so you can trust they came from this project. Offline forever still works: both simply fail quietly.

The app owns nothing inside your project folders. The project roster, the active project, usage timestamps, and the (rebuildable) embedding cache all live under `~/.prompt-compose` — never written into your git-tracked prompt files.

## The contracts

Two living design docs govern the product:

- [`project_docs/prompts-design.md`](project_docs/prompts-design.md) — the engineering contract: storage model, the snippet/project data model, the command surface, and the hybrid match engine.
- [`project_docs/prompts-ux.md`](project_docs/prompts-ux.md) — the interaction design, scenario by scenario.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the verify commands.

## License

MIT
