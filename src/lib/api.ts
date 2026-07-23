/**
 * Bridge to the native Rust commands via Tauri `invoke`, with a browser-dev
 * fallback so the full UI can be exercised in a plain browser (Vite dev) using
 * bundled mock fixtures. No data ever leaves the machine in either mode.
 *
 * The seam to Rust: this file and prompts/types.ts mirror src-tauri/src/prompts/
 * and have one author, because `pnpm check` cannot verify a Rust↔TS command
 * signature — a drift here fails at runtime, not at build. All payloads are
 * serde-default snake_case; Tauri camelCases the invoke argument keys.
 *
 * Embedding has no command surface: the model downloads and indexes itself in
 * the background, silently, and a failure degrades to lexical match with nothing
 * for the user to see or decide.
 */
import type { Snippet, MatchHit, Project, ProjectList } from './prompts/types';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------------------------------------------------------------------------
// Prompt Library — snippets (Markdown files) and projects (folders).
// ---------------------------------------------------------------------------

/** The project roster plus the active project (persisted by the backend and
 *  restored on launch, so it rides along rather than living in frontend state). */
export async function listProjects(): Promise<ProjectList> {
  if (!isTauri()) return { projects: devProjects.map((p) => ({ ...p })), active: devActive };
  return call<ProjectList>('list_projects');
}

/** Register a folder as a project. Re-adding a path renames it — the path is the
 *  project's identity. The folder must already exist. */
export async function addProject(name: string, path: string): Promise<Project> {
  if (!isTauri()) return devAddProject(name, path);
  return call<Project>('add_project', { name, path });
}

/** Set (or clear, with `color: null`) a project's color. `color` is a resolved
 *  hex string from the fixed swatch in `ProjectContextMenu.svelte`; this call
 *  does not validate it. */
export async function setProjectColor(path: string, color: string | null): Promise<Project> {
  if (!isTauri()) return devSetProjectColor(path, color);
  return call<Project>('set_project_color', { path, color });
}

/** Forget a project. **Never deletes files** — the user's prompts are their own,
 *  and the app is a viewer onto a folder it does not own. Re-adding the folder
 *  restores the project intact. */
export async function removeProject(path: string): Promise<void> {
  if (!isTauri()) {
    devRemoveProject(path);
    return;
  }
  await call<null>('remove_project', { path });
}

/** Persisted; restored on launch. */
export async function setActiveProject(path: string): Promise<void> {
  if (!isTauri()) {
    devActive = path;
    return;
  }
  await call<null>('set_active_project', { path });
}

/** Every `*.md` under the project folder, recursively — each one a snippet whose
 *  name is its path minus the extension. */
export async function listSnippets(project: string): Promise<Snippet[]> {
  if (!isTauri()) return (devStore[project] ?? []).map((s) => ({ ...s }));
  return call<Snippet[]>('list_snippets', { project });
}

/** Write `<project>/<name>.md`. Same name updates that file; a new name creates a
 *  new snippet — which is the whole of "Save as new". A slashed name creates its
 *  parent folders. */
export async function saveSnippet(
  project: string,
  name: string,
  content: string
): Promise<Snippet> {
  if (!isTauri()) return devSaveSnippet(project, name, content);
  return call<Snippet>('save_snippet', { project, name, content });
}

export async function deleteSnippet(project: string, name: string): Promise<void> {
  if (!isTauri()) {
    devDeleteSnippet(project, name);
    return;
  }
  await call<null>('delete_snippet', { project, name });
}

/** Rank the project's snippets against `query`.
 *
 *  **An empty query returns everything, most-recently-used first** (then the
 *  never-used, alphabetically) — the list filters *down*, not up. Which engine
 *  ran is the backend's business; callers only see the hit list. */
export async function matchSnippets(
  project: string,
  query: string,
  limit: number
): Promise<MatchHit[]> {
  if (!isTauri()) return devMatchSnippets(project, query, limit);
  return call<MatchHit[]>('match_snippets', { project, query, limit });
}

/** Record that a snippet was used — this is what orders the at-rest list. It
 *  writes to app-local state, never into the project folder, which is git-tracked:
 *  a timestamp written into a `.md` file would dirty the user's git tree on every
 *  insert. */
export async function touchSnippet(project: string, name: string): Promise<void> {
  if (!isTauri()) {
    devUsage[`${project}::${name}`] = Math.floor(Date.now() / 1000);
    return;
  }
  await call<null>('touch_snippet', { project, name });
}

// ---------------------------------------------------------------------------
// Dictation — local speech-to-text (src-tauri/src/dictate/). Device, language
// and model are the only controls. One-shot: the whole utterance is decoded
// once when `stopDictation` is called, arriving via the `dictate:final` event
// (not a return value), with `dictate:done` always following once decoding
// finishes so the frontend can clear a "transcribing…" state.
// ---------------------------------------------------------------------------

/** One selectable input device. `id` is opaque — round-trip it back into
 *  `startDictation`, never parse it. */
export interface AudioDevice {
  id: string;
  name: string;
}

/** Every input device on the system. There is no mic in headless `pnpm dev`,
 *  so the browser-dev fallback is just an empty list rather than a fixture —
 *  the picker renders "no devices found" instead of pretending to record. */
export async function listAudioDevices(): Promise<AudioDevice[]> {
  if (!isTauri()) return [];
  return call<AudioDevice[]>('list_audio_devices');
}

/** Is the Whisper large-v3-turbo model already on disk? Settings uses this to
 *  decide "Download" vs "Ready"; the dictate store caches it so Space can
 *  refuse instantly instead of round-tripping to the backend on every press. */
export async function dictateModelStatus(): Promise<boolean> {
  if (!isTauri()) return false;
  return call<boolean>('dictate_model_status');
}

/** Download the Whisper large-v3-turbo model — a Settings-only, explicit
 *  action. Progress arrives via `onDictateModelProgress`; this resolves once
 *  the model is verified and on disk. */
export async function downloadDictateModel(): Promise<void> {
  if (!isTauri()) {
    throw new Error('Model download needs the desktop app.');
  }
  await call<null>('download_dictate_model');
}

/** Download progress for `downloadDictateModel`, 0..1. */
export async function onDictateModelProgress(cb: (fraction: number) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ fraction: number }>('dictate:model-progress', (e) => cb(e.payload.fraction));
}

/** The exact error `start_dictation` rejects with when the model hasn't been
 *  downloaded yet — kept in sync with `MODEL_NOT_DOWNLOADED` in
 *  `src-tauri/src/dictate/state.rs`. */
export const MODEL_NOT_DOWNLOADED = 'MODEL_NOT_DOWNLOADED';

/** Start one capture+decode session. `deviceId` of `null` uses the system
 *  default input. `language` is `"auto" | "en" | "zh"`. Requires the model to
 *  already be downloaded (Settings' job, not this call's) — rejects with
 *  `MODEL_NOT_DOWNLOADED` otherwise. */
export async function startDictation(deviceId: string | null, language: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('Dictation needs the desktop app — there is no microphone in browser-dev.');
  }
  await call<null>('start_dictation', { deviceId, language });
}

/** Stop capturing and trigger the one decode. Resolves immediately — the
 *  actual decode happens in the background and its result (if any) arrives
 *  via `dictate:final`, with `dictate:done` always following. */
export async function stopDictation(): Promise<void> {
  if (!isTauri()) return;
  await call<null>('stop_dictation');
}

/** The one committed utterance — lands at the compose box's cursor. */
export async function onDictateFinal(cb: (text: string) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<{ text: string }>('dictate:final', (e) => cb(e.payload.text));
}

/** Fires once decoding finishes, whether or not there was any text — the
 *  frontend's cue to clear a "transcribing…" state. */
export async function onDictateDone(cb: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen('dictate:done', () => cb());
}

// --- Browser-dev prompt store ------------------------------------------------
// Real folder/file semantics over seeded samples, so `pnpm dev` exercises the
// whole view with no native shell — this is how the app is feel-checked and how
// the frontend develops.
//
// The seeded library doubles as the screenshot set, so the content is real
// prompt text rather than placeholder prose: a reader should learn what the
// feature is *for* from a screenshot alone. Coverage is deliberate — snippets in
// subfolders and at the top level (folders are the whole organization system
// now), with and without variables, a repeated variable across two snippets (they
// share one value), and one containing a fenced code block (which the variable
// grammar must treat as verbatim).

const devProjects: Project[] = [
  { name: 'engineering', path: '/dev/mock/engineering' },
  { name: 'writing', path: '/dev/mock/writing' },
  { name: 'research', path: '/dev/mock/research' },
];

let devActive: string | null = '/dev/mock/engineering';

/** `<project path>::<snippet name>` → last-used epoch seconds. Deliberately kept
 *  out of the snippet objects, mirroring the backend: usage is app state, not
 *  something that belongs in a git-tracked prompt file. */
const devUsage: Record<string, number> = {
  '/dev/mock/engineering::review/senior-reviewer': 1751300000,
  '/dev/mock/engineering::debug/bug-repro-first': 1751200000,
};

const devStore: Record<string, Snippet[]> = {
  '/dev/mock/engineering': [
    {
      name: 'review/senior-reviewer',
      content:
        'You are a senior reviewer. Be rigorous about correctness, but do not nitpick style that a formatter owns. Say plainly when something is fine.',
    },
    {
      name: 'review/pr-checklist',
      content:
        'Review the PR for {ticket}. Focus especially on {concern}. Check error handling, tests, and naming. Flag anything that reads as a silent failure.',
    },
    {
      name: 'debug/bug-repro-first',
      content:
        'Before proposing a fix for {symptom}, write the smallest failing test that reproduces it. If you cannot reproduce it, say so instead of guessing.',
    },
    {
      name: 'testing/test-plan',
      content:
        'Write a test plan for {surface}. Cover the happy path once, then spend the rest of your effort on {risk} — the cases where a bug would be silent.',
    },
    {
      name: 'refactor/refactor-safely',
      content:
        'Refactor {target} without changing behavior. Land the characterization tests first, then move code. If a test is hard to write, that is the design talking.',
    },
    {
      name: 'code/format-string',
      content:
        'A body is a Python-style format string, uniformly: `{name}` is substituted everywhere, code fences included — which is exactly what you want here:\n\n```python\nprint(f"deploy {service} to {env}")\n```\n\nTo emit a literal brace, double it: `{{` and `}}`.',
    },
    {
      name: 'release-notes-draft',
      content:
        'Draft release notes for {version}. Lead with what a user can now do that they could not before. Migrations and breaking changes go first, not last.',
    },
    { name: 'style/be-terse', content: 'Be terse and concrete. Lead with the answer; skip preamble and hedging.' },
  ],
  '/dev/mock/writing': [
    {
      name: 'tone-notes',
      content: 'Prefer plain words over jargon. Say {audience} when addressing the reader.',
    },
    {
      name: 'headline-rewrite',
      content:
        'Rewrite {draft} three ways: one that states the outcome, one that names the reader, one that asks the question they already have. No clickbait.',
    },
    {
      name: 'cut-it-in-half',
      content:
        'Cut this by half without losing an idea. Delete throat-clearing, restatement, and any sentence that only announces the next one.',
    },
    {
      name: 'explain-like-staff-eng',
      content:
        'Explain {topic} to a strong engineer who has never touched it. Lead with what it is for, then how it works. No analogies to food.',
    },
  ],
  '/dev/mock/research': [
    {
      name: 'literature-scan',
      content:
        'Survey the {n} strongest sources on {question}. For each: the claim, the evidence, and the strongest objection to it. Mark what you could not verify.',
    },
    {
      name: 'steelman-then-rebut',
      content:
        'State the strongest version of {claim} — the one its smartest advocate would recognize. Only then argue against it. A rebuttal of a weak version proves nothing.',
    },
    {
      name: 'weekend-scope-guard',
      content:
        'This is a weekend project. Name the one thing it must do by Sunday, and the things you are deliberately not building.',
    },
  ],
};

function devAddProject(name: string, path: string): Project {
  const existing = devProjects.find((p) => p.path === path);
  if (existing) {
    existing.name = name; // the path is the identity: re-adding is a rename
    return { ...existing };
  }
  const project: Project = { name, path };
  devProjects.push(project);
  devStore[path] ??= [];
  devActive ??= path;
  return { ...project };
}

function devSetProjectColor(path: string, color: string | null): Project {
  const project = devProjects.find((p) => p.path === path);
  if (!project) throw new Error(`not a known project: ${path}`);
  project.color = color ?? undefined;
  return { ...project };
}

/** Forgets the path. Never deletes files — `devStore` deliberately keeps the
 *  snippets, so re-adding the folder restores the project intact, exactly as the
 *  real filesystem would. */
function devRemoveProject(path: string): void {
  const i = devProjects.findIndex((p) => p.path === path);
  if (i < 0) return;
  devProjects.splice(i, 1);
  for (const key of Object.keys(devUsage)) {
    if (key.startsWith(`${path}::`)) delete devUsage[key];
  }
  if (devActive === path) devActive = devProjects[0]?.path ?? null;
}

function devSaveSnippet(project: string, name: string, content: string): Snippet {
  const snippets = (devStore[project] ??= []);
  const existing = snippets.find((s) => s.name === name);
  if (existing) {
    existing.content = content; // same name = same file = an update
    return { ...existing };
  }
  const snippet: Snippet = { name, content };
  snippets.push(snippet);
  snippets.sort((a, b) => a.name.localeCompare(b.name));
  return { ...snippet };
}

function devDeleteSnippet(project: string, name: string): void {
  const snippets = devStore[project] ?? [];
  const i = snippets.findIndex((s) => s.name === name);
  if (i >= 0) snippets.splice(i, 1);
  delete devUsage[`${project}::${name}`];
}

// A stand-in weighted fuzzy scorer for browser-dev — deliberately a fixture, not
// shared production logic: the real engine (fzf-style subsequence with field
// weights, plus hybrid fusion) lives in Rust. This one only needs to make the
// match panel behave believably in `pnpm dev`.
function devFuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  if (t.includes(q)) return 100 + q.length * 2 - Math.min(20, t.length / 10);
  // Subsequence match: every query char in order, closer together = better.
  let ti = 0;
  let matched = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) continue;
    matched++;
    if (last >= 0) gaps += found - last - 1;
    last = found;
    ti = found + 1;
  }
  const qLen = q.replace(/ /g, '').length;
  if (qLen === 0 || matched < qLen * 0.8) return 0;
  return Math.max(0, matched * 8 - gaps);
}

function devMatchSnippets(project: string, query: string, limit: number): MatchHit[] {
  const pool = devStore[project] ?? [];
  // Empty query returns EVERYTHING, most-recently-used first, then the never-used
  // alphabetically — the same rule the backend applies. The old behavior (empty
  // query → empty list) forced the user to type to see their own library.
  if (!query.trim()) {
    return [...pool]
      .sort((a, b) => {
        const aUsed = devUsage[`${project}::${a.name}`];
        const bUsed = devUsage[`${project}::${b.name}`];
        if (aUsed && bUsed) return bUsed - aUsed || a.name.localeCompare(b.name);
        if (aUsed) return -1;
        if (bUsed) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit)
      .map((s) => ({ name: s.name, score: 0 }));
  }
  const hits: MatchHit[] = [];
  for (const s of pool) {
    const score = Math.max(devFuzzyScore(query, s.name) * 3, devFuzzyScore(query, s.content));
    if (score > 0) hits.push({ name: s.name, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
