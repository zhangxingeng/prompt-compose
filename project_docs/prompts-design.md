# Prompt Compose — Engineering Contract

The *engineering* contract: storage, the Rust↔JS command surface, the variable grammar, the match
engine, the compose-surface model, and the network surface. It ages with the code — when the
implementation changes, this doc changes with it.

Its sibling is [prompts-ux.md](prompts-ux.md), the **interaction contract**: every user scenario
and what happens back. Where this doc says what the system *is*, that one says what the user
*does*. Neither is authoritative over the other's half.

**The whole model, in two sentences.** A snippet is a **Markdown file whose filename is its name**;
its entire content is the prompt. A project is a **name and a folder**, and every `*.md` under that
folder, recursively, is one of its snippets. There is no uuid, no schema, no scope field, no
cross-reference — the filesystem is the source of truth. Everything below falls out of that.

## Why the filesystem, and not a schema

The library exists to be **hand-editable and git-committable**: a user keeps their prompts in a
repo and reads the diffs. Every decision here serves that, and the ones that look austere are the
ones that serve it hardest.

Markdown rather than "nicer JSON", because once keywords, tags, category, versions and defaults are
gone the schema has exactly **one** structured field left — the body. A JSON file wrapping a single
string field is a worse text file: prompts are dense with quotes and newlines, so JSON escapes the
body into one unreadable line and a GitHub diff of a prompt edit becomes noise — which defeats the
entire reason for wanting the library in git. A `.md` file *is* the prompt: GitHub renders it,
diffs are line-by-line, any editor edits it, and "is this file schema-compliant?" stops being a
question because there is no schema.

Four invariants follow, and every writer in `src-tauri/src/prompts/` honors them:

- **The filename is the identity.** Renaming a file renames the snippet. This is what makes the
  folder hand-manageable, and it is the point — not a side effect to be papered over with an id.
- **Subfolders are the organization system.** A name is the path relative to the project root minus
  `.md` (`rust/code_review`), so grouping is `mkdir` — doable in Finder, with no UI at all. This is
  what replaced tags/categories rather than a browse panel.
- **Never write app state into a project folder.** It is git-tracked. A `last_used` write on every
  insert would dirty the user's tree every single time they used the app — and reading clean diffs
  is the whole reason the library is Markdown-in-git. Usage timestamps, the roster and the active
  project therefore live in app-local state (below), never in a `.md` file and never in a sidecar.
- **The app is a viewer onto a folder it does not own.** It creates and deletes the files the user
  asks it to, and nothing else: it never prunes a directory a deletion left empty, never rewrites a
  file it did not understand, never touches a non-snippet. `remove_project` **forgets a path and
  never deletes files** — the prompts are the user's, which is the entire reason the folder is
  theirs to choose.

### Save is byte-exact; a missing folder is loud

`store::save_snippet` writes content **verbatim** — no trailing newline added, no normalization —
because a save that "tidied" the text would show the user edits they never made in the very diff
this library exists to serve. Writes are atomic (temp sibling + rename), so a crash cannot leave a
half-written prompt.

`store::scan_snippets` **errors** on a missing or non-directory project path rather than returning
`[]`. A folder that was deleted, renamed, or sits on an unmounted drive is a real failure, and an
empty list would present it to the user as "you have no prompts" — breakage that reads as
emptiness. A single unreadable *file* (permissions, non-UTF-8) is skipped and logged instead: one
bad file must not hide every other snippet. Symlinks are not followed (a symlinked directory can
escape the folder or cycle) and dot-entries are skipped (the folder is typically a git repo; `.git`
is not content).

### Names are a trust boundary, not a formality

`save_snippet` creates parent directories for a slashed name, so `../../.ssh/authorized_keys` would
write cleanly outside the project. Names come from the frontend and are untrusted input.
`store::validate_name` rejects: empty names and empty segments, `.`/`..` segments, absolute paths,
backslashes (a name is always `/`-separated; on Windows a backslash would act as an unchecked second
separator), `:` (the usage map keys on `<project path>::<name>`, so a colon makes that key
ambiguous), and NUL (it truncates the path at the syscall boundary). `snippet_path` then re-checks
that the *resolved* path really sits under the project root — belt and braces, because if a future
edit ever weakens the name rules that check still holds the line.

## App-local state — the only non-Markdown persistence

`<data root>/prompts-state.json` (`src-tauri/src/prompts/appstate.rs`). Outside every project
folder, never in git, never in the user's prompt repo.

```jsonc
{
  "projects": [{ "name": "juror", "path": "/abs/path/prompt_snippets" }],
  "active": "/abs/path/prompt_snippets",
  "usage": { "/abs/path/prompt_snippets::rust/code_review": 1720000000 }
}
```

A project folder can be any directory, hidden ones included. Adding a hidden one is a first-class
route, not a workaround: `+` opens a path field, and `Browse…` only fills it, so a path the picker
refuses to show can be pasted or edited in by hand (`prompts-ux.md` S1).

A **visible** name like `prompt_snippets/` is still the friendlier default — file managers hide
dotfolders too, so a hidden library is easy to forget exists when you go to edit the `.md` files by
hand. That is a convenience argument, not a capability one.

- `usage` is keyed `<project path>::<snippet name>` → last-used epoch, and is the **only** input to
  the at-rest sort order. It lives here rather than in the snippet file for the git-cleanliness
  reason above.
- A project's **path is its identity**: it is canonicalized on add, so two spellings of one folder
  cannot become two projects with divergent usage keys, and re-adding a registered path is a
  *rename*, not a duplicate.
- The folder must already exist to be added — a project *is* a folder, so registering a path that
  isn't one would create a roster entry whose every future scan errors.
- **A corrupt state file is a loud error, never a silent reset.** Quietly returning an empty roster
  would read to the user as every project having vanished, and the next save would then persist that
  emptiness over the file that still held them. A *missing* file is a fresh install (empty state) —
  a different case, handled differently.
- The first project added becomes active, and removing the active project falls back to another,
  because a roster with no selection is a state the UI has no way to leave.

The data root itself is `~/.prompt-compose` (env `PROMPT_COMPOSE_DATA_DIR` overrides it, for tests);
`src-tauri/src/datadir.rs` is the source of truth. Also under the root: `models/` (embedding
artifacts) and `cache/embeddings.sqlite` (the vector cache) — both derived data, rebuildable at any
time from the `.md` files.

## Variables — a Python format string, and nothing more

`src/lib/compose/variables.ts` is the **one and only implementation**. The Rust half (`grammar.rs`)
is deleted, not simplified: after the schema cut nothing in the backend parses a body (`content` is
an opaque string to Rust), and keeping a second implementation of a subtle rule with zero product
callers is a liability that buys nothing. Deleting it makes two-language divergence *structurally
impossible* rather than test-guarded — which is why there is no shared cross-language vector table
any more. The vectors live once, in `tests/prompts_smoke.mjs`.

The grammar, whole:

1. `{name}` is a variable, `name` matching `[A-Za-z0-9_-]+`, case-sensitive.
2. `{{` emits a literal `{`, `}}` a literal `}`. A literal `{{` is written `{{{{` — as in Python.
3. Anything else braced is literal, because Python could not read it as a plain field either:
   `{my var}`, `{a.b}`, `{:x}`, `{"json": 1}`, `{ return x }`, and `{task:write tests}` (the removed
   default form) all simply fail rule 1's name test. This is not a list of exceptions — it is rule 1
   seen from the other side.
4. One name is one variable, document-wide, first-appearance order. Two occurrences of `{language}`
   share one value: the model cannot tell two identically-named variables apart, so pretending they
   differ would be a fiction the UI maintains and the output discards.
5. An unfilled variable resolves to the literal sentinel `variable not set, ask user for it`
   (`UNSET_VALUE`) on copy. A forgotten variable therefore still produces a working
   prompt — the model asks, rather than silently receiving a blank or a stray `{placeholder}`. This
   is what replaced per-variable defaults: every variable is a string (an LLM only consumes strings,
   so a type system here was ceremony) and every variable has the same implicit default, so both the
   default-declaration syntax and the "remember to set a default" step disappear.

### There is no Markdown awareness. Do not add any.

The grammar is **uniform over the whole body**. It does not know what a code fence is, or a
backtick. A `{name}` inside ```-fenced code **is** a variable.

An earlier design excluded fenced blocks and inline code spans, to stop a code sample's braces from
false-positiving. It was cut on purpose, and the reason it was cut is reason enough on its own:
*"variables work everywhere, except inside backticks, and except inside fences"* is a rule you have
to be **told**. It cannot be guessed. *"It's a Python format string"* is a rule the
user already knows — and so does every LLM reading the output. **Less to remember beats
more-correct-in-a-corner. We do not invent protocols.** The carve-out also failed on contact: the
first realistic dev-prompt fixture anyone wrote put its placeholder in backticks
(`` `{command_name}` ``), which the carve-out silently turned into literal text.

**The accepted cost, stated plainly.** A fenced code sample containing `{name}` does become a
variable — and that is **loud, not silent**: the fill list surfaces every variable it finds in the
composed prompt, so a stray `name` appears in the UI and the author escapes it `{{name}}`,
exactly as they would in Python. *The UI surfacing every parsed variable is what makes this safe*,
and it is the load-bearing half of the trade.

**One case is genuinely silent, and is accepted knowingly:** `{{` inside a code sample (a Rust
`format!("{{}}")`) unescapes to `format!("{}")` on copy. That is not a bug — under Python semantics
`{{` *means* a literal brace, so unescaping it is correct, and a user who wants a literal `{{` writes
`{{{{`. Re-introducing a fence carve-out to "protect" this would trade one quiet surprise for an
unguessable rule, which is the worse trade. It is documented in `variables.ts` for the same reason
it is documented here: so the next reader does not "fix" it back.

## Copy output — every variable is hoisted

```ts
copyText(text: string, fills: Record<string, string>): string
```

Copy rendering is **frontend-only**; Rust never renders. Every variable is **always hoisted** — one
behavior, no per-variable choice. Every occurrence becomes `<prompt_var name="x"/>` in place, and one
`<prompt_vars>` block is appended carrying each distinct variable's value once, in first-appearance
order.

```
Review the PR for <prompt_var name="ticket"/> and summarize.

<prompt_vars>
<prompt_var name="ticket">ABC-123</prompt_var>
</prompt_vars>
```

Hoist is the whole behavior because it is the one that never surprises: it dedups a long value to a
single statement, and it can never break a prompt. An earlier round shipped a per-variable
as-variable toggle whose OFF mode substituted the value inline instead — nobody flipped it, and
substituting unexpected data in place can silently bloat a prompt where hoisting cannot. A control
that is never used and whose alternative is strictly riskier is exactly the forgotten feature this
redesign exists to delete, so it was cut to the single safe path.

The wrapper form `<prompt_var name="x">` is used rather than `<x>` because names may start with
digits or hyphens, which are invalid XML element names. Block values are **XML-escaped** (`&` first,
or you re-escape the entities you just produced): the wrapper exists to be parseable, and an
unescaped value containing `</prompt_var>` could inject phantom variables into what the reading LLM
sees. Names need no escaping — rule 1's name class is attribute-safe by construction.

An empty fill input reads as untouched and resolves to `UNSET_VALUE` exactly as an absent one does.
There is deliberately no way to fill a variable with the empty string: to say nothing, delete the
`{name}`.

## The compose model — inserted snippets are tinted text

`src/lib/compose/doc.ts`. A Doc is a **flat list of nodes**, each either free-typed `text` or `tint`
— the body of an inserted snippet, marked to signal template provenance. Both carry ordinary
**editable** text; they differ only in how the box paints them. Pure data and pure transforms — no
DOM, no Svelte.

**This model has been through two rewrites, and the arc is the load-bearing wisdom.** The first Doc
was one `text` string plus `spans[]` tiling it (`sum(span.length) === text.length`). A snippet's
body sat in the box as editable text, and editing it in place silently diverged the composed text
from the stored file, flipping the span into a `linked-modified` provenance that persisted nothing.
Phase 2 killed that by making a snippet a **chip** — a `contenteditable="false"` atom that rendered
as its name+variables but contributed its whole body: rendered ≠ contributed, so inline editing was
structurally impossible. But a chip still carried a link back to its library file, which is the seam
the divergence bug lived on.

Phase 3 deletes the seam at the root instead of guarding it. An inserted snippet is now its **whole
body text**, dropped into the box as ordinary editable text and tinted. **There is no link back to
the library file.** Once inserted, the text is just text with a tint; editing it touches nothing on
disk, so the divergence class cannot return — not because editing is blocked (it isn't), but because
there is nothing left to diverge *from*. The library is written only through the explicit
Save-as-snippet action, never as a side effect of editing composed text.

Rendered == contributed again, so the entire chip apparatus is gone: no `cid` instance identity, no
body-carried-on-the-node, no ZWSP caret scaffolding, no popup edit surface, no `dirty` state, and no
clip-and-demote algebra (the `linked-modified` state, applyEdit transition table, linkRange,
replaceSpan, spanStarts, diffTexts all deleted). A `tint` node is a `text` node wearing a highlight.

Consequences worth knowing before you touch this file:

- **A `tint` node carries no identity and no link** — the tint is a pure visual flag. Two snippets
  inserted back to back merge into one tinted run (`normalize`), which is fine precisely because
  there is no instance to keep apart. Editing a tinted run, in any way, writes nothing to the
  library.
- **The DOM is read back wholesale** (`fromRawNodes`), not patched edit-by-edit. Typing, paste, cut,
  drag, undo and IME composition all arrive as "the box now contains this", so there is no
  per-inputType transition table to get wrong. The round-trip `doc → (render) → DOM → readRawNodes →
  fromRawNodes → doc` must be the identity; if it is not, a prompt silently corrupts into something
  that still *looks* plausible in the box and copies out wrong. The invariant that matters is that
  **text is never lost** — a mis-tinted run is a cosmetic drift, a lost run is data loss.
- **Tint follows the text through edits for free**, via whether the browser kept a run inside a
  `.tint` span. To keep a snippet's tint from bleeding onto the words typed after it, the post-insert
  caret is dropped at box level *after* the tint span (not at its trailing edge), so a continuation
  keystroke starts a fresh untinted text node.
- `flatten(doc)` returns every node's text in order — typed text and tinted text alike. Everything
  downstream (the variable fill list, Copy Prompt) reads it, and the variable grammar parses `{name}`
  out of that flattened text uniformly. There is no rendered≠contributed seam to reconcile any more,
  so a plain selection copy from the box is already correct.
- **Editing or deleting an existing snippet is not an in-app action.** A snippet is a `.md` file
  whose filename is its name, so that is done in `$EDITOR` or the file manager; the app keeps only
  *create* (the library's `+` → Save-as-snippet) and *insert*. This is a deliberate consequence of
  deleting the chip popup — flagged for the founder's feel-check, not an oversight.

## Rust ↔ JS command contract

All async, `Result<T, String>`, snake_case, registered in `invoke_handler`. Module
`src-tauri/src/prompts/`; the TS mirror is `src/lib/api.ts` + `src/lib/prompts/types.ts`. **Those two
files and the Rust commands have one author on purpose**: `pnpm check` cannot catch a Rust↔TS
mismatch, so a drift here fails at runtime, not at build.

```
list_projects() -> { projects: Project[], active: string | null }
add_project(name, path) -> Project        // folder must exist; re-adding a path renames it
remove_project(path)                      // forgets the path. NEVER deletes files.
set_active_project(path)                  // persisted; restored on launch
list_snippets(project) -> Snippet[]       // recursive *.md scan
save_snippet(project, name, content) -> Snippet   // creates parent dirs for a slashed name
delete_snippet(project, name)             // idempotent; also drops the usage entry
match_snippets(project, query, limit) -> MatchHit[]   // empty query = everything, recency-first
touch_snippet(project, name)              // records usage in app-local state
```

`Project { name, path }`. `Snippet { name, content }`. `MatchHit { name, score }` — a name is an
identity, so that is all a hit needs to carry.

**`active: null` is not a "global" scope — it means no project is configured yet** (first launch),
and renders as the empty state that asks for a folder. Under folder-as-project there *is* no global
scope: a snippet lives in the folder it sits in. Keeping a Global tab would be the old design
wearing new labels.

**Embedding has no command surface at all** — see below.

## Match engine — lexical always, semantic silently

**Empty query returns the whole library, most-recently-used first**, then never-used ones
alphabetically (`state::at_rest_order`). The list **filters down**; it does not build up. The old
behavior bailed on an empty query in both layers, so the user was shown an empty panel and had to
type to make their own library appear — backwards, and the thing the founder hit every day. No
"recent or relevant?" toggle exists because the question answers itself: with no query there is no
score to rank by, so recency is the only meaningful order; with a query, the score is.

**Lexical** (`lexical.rs`) is always on, unconditional, instant: fzf-style weighted scoring over the
only two fields that exist — the name (`W_NAME`, which dominates) and the content (`W_CONTENT`).
The name outweighs the content because it is a deliberate, hand-chosen label, while the content is
prose that merely happens to contain the query. Deliberately not BM25/tantivy: term-frequency
statistics earn their keep on large, noisy corpora; over a few hundred curated snippets, subsequence
match plus field weights is better-fitting and dependency-free. Two field-specific rules
carry real reasoning:

- The **name** gets full fuzzy treatment (substring, else in-order subsequence scored by
  compactness), so `snrev` still finds `senior-reviewer`. A subfolder path is part of the name, which
  is what makes "grouping by `mkdir`" actually searchable.
- The **content** is **substring-only**. Subsequence over long prose scatter-matches almost
  anything, which would turn the content weight into pure noise.
- Multi-token queries are **AND** (every whitespace token must land somewhere), scored as the mean
  of per-token best-field scores so longer queries aren't inflated.

**Semantic** (`embed.rs`) is fastembed-rs `bge-small-en-v1.5-onnx-Q` with `ort` `load-dynamic`,
pinned and sha256-verified artifacts, a linear cosine KNN over `cache/embeddings.sqlite`. Cache
identity is `(project, name, model_id)` — there is no uuid to key on, and a bare name is not unique
across projects.

**It has no user-facing surface.** The model downloads and indexes itself in the background on first
launch and never asks (`state::spawn_background_index`). Two conditions define it, and they are the
whole design: it never blocks startup or any user action, and it **fails silently to lexical** — no
toast, no notice, no retry nagging. That is affordable precisely *because* lexical works
unconditionally: a download that is slow, failed, or impossible on this platform degrades to
lexical-only with nothing for the user to see, decide, or retry. Semantic match improves ranking; it
is never a prerequisite for it. Failures are logged, not swallowed.

Three guards keep it from ever hurting the panel: `INFERENCE_BUDGET_MS` (a query embedding slower
than the UI's debounce budget means this machine is too slow — degrade to lexical-only for the rest
of the session), `EMBED_TOPUP_PER_QUERY` (a capped top-up so a large library cannot freeze one
keystroke; the cache warms over a few queries and the background pass does the bulk), and a
`downloading` flag so semantic match sits out the download rather than racing it.

**Fusion** (`state::fuse`) blends normalized lexical with cosine, weighted by `LEX_BLEND`. Lexical
leads because on a curated corpus the user's own words beat inferred similarity more often than not;
semantic exists to catch the phrasings the name and the content missed. `SEM_MIN_COSINE` floors
semantic-only candidates, without which low-similarity vectors pad the panel with head-scratchers.
The one hard constraint is enforced **structurally**: a hit flagged `exact` (a full-query name match)
sorts above every non-exact hit no matter what either engine scored, so an exact name match can never
be buried.

**The panel relevance floor** (`MATCH_MIN_SCORE`, 0.2) drops any hit whose fused score falls under it
— applied on the **non-empty-query path only** (the at-rest listing is scored 0.0 and must never be
filtered, or the whole library would vanish). Without it a query just reordered the entire library,
low-relevance hits included; the founder's complaint was exactly that. **One knob covers both
engines** because the fused score is normalized: the lexical term is `LEX_BLEND·(raw/lex_max)`, so a
fixed floor is *gap-adaptive* on the lexical side (a scattered tail hit next to a strong winner
normalizes low and drops; when the best hit is itself weak, everything sits near 1.0 and survives)
and *absolute* on the semantic side, where `(1-LEX_BLEND)·cosine ≥ 0.2` means a semantic-only hit
needs `cosine ≥ 0.5` — well above `SEM_MIN_COSINE`, which is what cuts the 0.35–0.5 noise band.
**Why 0.2 and not 0.5:** 0.5 would also drop a legitimate mid-strength lexical substring hit
(normalized ≈0.6·0.6 with no semantic boost), which is a real match, not noise. Exact hits are
**exempt** — the "exact never buried" invariant outranks the floor. When every hit is floored out,
the frontend's existing "No matching snippets." empty state covers it, so the floor needs no
frontend change.

## The updater — and the whole network surface

**The network surface, stated exactly: the app makes two kinds of request, both are fetches, and it
never sends anything.** Nothing the user writes is ever transmitted. The two:

1. The embedding model + ONNX Runtime artifacts (pinned URL + sha256, [above](#match-engine--lexical-always-semantic-silently)).
2. **The update check** — `GET` of the release manifest on launch:
   `https://github.com/zhangxingeng/prompt-compose/releases/latest/download/latest.json`.

Both are optional to the app's job and both fail quietly; the app works forever offline. Say it this
way in the README and the bundle `longDescription` too — the bare claim "fully offline" ships inside
every installer's metadata, and once the app calls GitHub on launch it is simply false. Accuracy
here is not cosmetic: it is the claim the product's whole trust story rests on.

**Artifacts are signed, and the pubkey is a one-way door.** `plugins.updater.pubkey` in
`tauri.conf.json` is pinned at build time into every installed copy; CI signs the artifacts with the
matching `TAURI_SIGNING_PRIVATE_KEY`. **prompt-compose and ccdeck deliberately share one keypair.**
Change the pubkey and every already-installed copy rejects every future update, permanently and
silently — there is no recovery path except a manual reinstall, so treat the string as copy-only.
`bundle.createUpdaterArtifacts` is what makes the signed artifacts and `latest.json` exist at all;
`.github/workflows/release.yml` must carry the signing env or a release builds fine and ships
updates nothing will accept.

**The seam: the frontend owns the whole lifecycle; Rust owns none of it.** `src/lib/updater.svelte.ts`
drives `check()` → `downloadAndInstall()` → `relaunch()` directly against the plugins. There is **no
Rust command surface** here and no `plugins.updater.dialog` to hand off to — that option was v1; in
v2 a custom UI around `check()` is the supported path, not a workaround. `lib.rs` registers the two
plugins and stops there; `tauri-plugin-process` exists *only* for the post-install relaunch.

Three behaviors in that module are load-bearing, and each encodes a decision:

- **`check()` returns `Update | null`** — `null` means nothing newer (strictly-greater semver against
  the running version). It is also treated as null when a non-null `Update` carries a blank or
  missing `version`: an unconfirmed report
  ([plugins-workspace#2998](https://github.com/tauri-apps/plugins-workspace/issues/2998)) says some
  plugin versions can return empty data, which would render a banner advertising "v". The guard is
  free if the report is noise.
- **The seen-version memory is entirely ours** — the plugin has no skip/dismiss primitive.
  `localStorage['promptcompose-update-seen']` holds one version string, read directly, following
  `theme.ts`'s convention. **Deliberately not a Rust config file**: persisting one string that way
  costs a module, a command, and a settings surface, and buys nothing over the browser storage the
  app already relies on for the theme. There is no storage wrapper module and this did not justify
  inventing one. The behavior it encodes is the interaction contract's
  ([S11](prompts-ux.md#s11-an-update-is-available--told-once-reachable-forever)) — read it before
  changing when the write happens, because writing it on *click* instead of on *render* silently
  turns the feature back into a nag.
- **A failed check is swallowed on the silent path** and only surfaced on the manual one. Failures
  are logged, never rethrown: an update check that breaks startup is a far worse bug than a missed
  update. Same posture as the embedding download.

The launch check lives in `+layout.svelte` inside the existing `if (!isTauri()) return` guard, so the
whole surface is inert in `pnpm dev` — browser-dev has no IPC bridge, and the convention here is a
guard at each call site rather than one centralized wrapper. The footer's affordance
(`+page.svelte`) gates on `isTauri()` for the same reason.

## Deliberately out (filed, not dropped)

- **The tag/category organization layer** was cut, not deferred: subfolders replaced it as the
  organization system.
- **Compose-surface Playwright e2e** — held until the interactions settle.

The **`prompt-import` skill was retired**, not fixed: importing a hand-written Markdown prompt into a
folder of Markdown prompts is `cp`. The skill existed to translate prose into a JSON schema; there is
no schema to translate into, so nothing was left for it to do. Do not rebuild one — a bulk-import
path, if ever needed, is a one-off script, not a product surface.
