<script lang="ts">
  /**
   * The project tab row. A project is a name, a folder, and (round 2) an
   * optional color — restored after round 1 cut it as "nothing to decorate";
   * with several projects on screen, color is how you tell which library you
   * are in at a glance, not decoration (`prompt_library_ux_round2_plan.md` §4).
   * Pinning stays cut — no promoted tab, every project is simply a tab.
   *
   * There is no "Global" tab, and its absence is the point: a snippet lives in
   * the folder it sits in, so a scope belonging to no folder cannot exist. An
   * empty roster is not a scope either — it renders as the add-a-folder prompt
   * in the panel below, not as a tab you could compose against.
   *
   * Plain Tab-stop buttons, not a roving tablist: the roving version was one of
   * the affordances nobody could guess without having read the UX contract, and
   * a handful of tabs does not need its own navigation model.
   *
   * The `+` button opens the native folder picker directly, no intermediate
   * popover (round 1's `ProjectManagerPopover` is gone). Right-clicking `+`
   * instead swaps in a small type-a-path input: OS directory pickers hide
   * dotfolders, so a library living in a hidden folder (e.g. a repo-local
   * `.prompt_snippets/`) is impossible to ADD through the picker at all — the
   * typed path is the only route in. Rename / change color / delete moved onto
   * a per-tab right-click menu (`ProjectContextMenu.svelte`) — there is
   * deliberately no "change path": to move a library, delete this project and
   * add the new folder (the folder IS the project's identity).
   */
  import { isTauri } from '$lib/api';
  import type { Project } from '$lib/prompts/types';
  import { prompts, setActiveProject, addProject } from '$lib/prompts.svelte';
  import ProjectContextMenu from './ProjectContextMenu.svelte';

  interface Props {
    /** So the view can disarm its keyboard shortcuts (e.g. Mod+C) while the
     *  context menu owns the keyboard — the same guard `managerOpen` used to
     *  provide for the deleted popover. */
    onProjectMenuOpenChange?: (open: boolean) => void;
  }

  let { onProjectMenuOpenChange }: Props = $props();

  let busy = $state(false);
  let menu = $state<{ project: Project; x: number; y: number } | null>(null);

  /** Non-null while the type-a-path input is open (the value being typed).
   *  Opened by right-clicking `+` — the escape hatch for folders the OS picker
   *  refuses to show (dotfolders). */
  let typedPath = $state<string | null>(null);
  let pathInputEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    pathInputEl?.focus();
  });

  /** The OS directory picker. In browser-dev there is no OS dialog, so fall back
   *  to a typed path — the add-a-project flow stays exercisable without Tauri. */
  async function pickFolder(): Promise<string | null> {
    if (!isTauri()) {
      return window.prompt('Folder path (browser-dev only):', '/dev/mock/prompts');
    }
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      directory: true,
      multiple: false,
      title: 'Choose a folder for your prompts',
    });
    return typeof picked === 'string' ? picked : null;
  }

  /** The folder's own name is the obvious default — the user picked it, so they
   *  already named it once. They can still rename it from the context menu. */
  function basename(path: string): string {
    const parts = path.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? path;
  }

  async function commit(rawPath: string | null): Promise<void> {
    const path = rawPath?.trim();
    if (!path) return;
    busy = true;
    try {
      await addProject(basename(path), path);
      prompts.loadError = null;
    } catch (e) {
      prompts.loadError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function add(): Promise<void> {
    await commit(await pickFolder());
  }

  /** Right-click on `+`: open the typed-path input instead of the picker. */
  function openTypedPath(e: MouseEvent): void {
    e.preventDefault(); // suppress the browser's native context menu
    typedPath = '';
  }

  async function submitTypedPath(): Promise<void> {
    const path = typedPath;
    typedPath = null;
    await commit(path);
  }

  function onPathKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submitTypedPath();
    } else if (e.key === 'Escape') {
      typedPath = null;
    }
  }

  function openMenu(e: MouseEvent, p: Project): void {
    e.preventDefault(); // suppress the browser's native context menu
    menu = {
      project: p,
      x: Math.min(e.clientX, window.innerWidth - 224),
      y: Math.min(e.clientY, window.innerHeight - 280),
    };
    onProjectMenuOpenChange?.(true);
  }

  function closeMenu(): void {
    menu = null;
    onProjectMenuOpenChange?.(false);
  }
</script>

<div class="project-tabs" role="tablist" aria-label="Prompt projects">
  {#each prompts.projects as p (p.path)}
    <button
      type="button"
      role="tab"
      aria-selected={prompts.activeProjectPath === p.path}
      class="project-tabs__tab"
      class:project-tabs__tab--active={prompts.activeProjectPath === p.path}
      class:project-tabs__tab--colored={!!p.color}
      style={p.color ? `--proj-color: ${p.color}` : undefined}
      title={p.path}
      onclick={() => setActiveProject(p.path)}
      oncontextmenu={(e) => openMenu(e, p)}
    >
      {#if p.color}<span class="project-tabs__dot" style="background:{p.color};"></span>{/if}
      {p.name}
    </button>
  {/each}

  {#if typedPath !== null}
    <input
      type="text"
      class="project-tabs__path"
      bind:this={pathInputEl}
      bind:value={typedPath}
      placeholder="/path/to/your/prompt/folder — Enter to add, Esc to cancel"
      spellcheck="false"
      onkeydown={onPathKeydown}
      onblur={() => (typedPath = null)}
      aria-label="Type a prompt folder path"
    />
  {:else}
    <button
      type="button"
      class="project-tabs__add"
      onclick={add}
      oncontextmenu={openTypedPath}
      disabled={busy}
      title="Add a prompt folder — right-click to type a path (OS pickers hide dotfolders)"
      aria-label="Add a prompt folder"
    >
      +
    </button>
  {/if}
</div>

{#if menu}
  <ProjectContextMenu project={menu.project} x={menu.x} y={menu.y} onClose={closeMenu} />
{/if}

<style>
  .project-tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .project-tabs__tab {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: inherit;
    font-size: 0.76rem;
    padding: 0.3rem 0.75rem;
    border: 1px solid transparent;
    border-radius: 1rem;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
  }
  .project-tabs__tab:hover {
    background: var(--bg-subtle);
    color: var(--text);
  }
  .project-tabs__tab--active {
    background: color-mix(in srgb, var(--text-muted) 12%, transparent);
    border-color: color-mix(in srgb, var(--text-muted) 25%, transparent);
    color: var(--text);
    font-weight: 600;
  }
  /* A colored project tints its active state with its own color instead of the
     neutral default — this is the "which library am I in" signal the plan
     restored color for. */
  .project-tabs__tab--active.project-tabs__tab--colored {
    background: color-mix(in srgb, var(--proj-color) 18%, transparent);
    border-color: color-mix(in srgb, var(--proj-color) 45%, transparent);
  }
  .project-tabs__dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .project-tabs__add {
    font-family: inherit;
    font-size: 0.9rem;
    line-height: 1;
    padding: 0.25rem 0.6rem;
    border: 0;
    border-radius: 1rem;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
  }
  .project-tabs__add:hover:not(:disabled) {
    background: var(--bg-subtle);
    color: var(--text);
  }
  .project-tabs__add:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .project-tabs__path {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    width: min(26rem, 60vw);
    padding: 0.28rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: var(--bg-subtle);
    color: var(--text);
  }
  .project-tabs__path:focus {
    outline: none;
    border-color: var(--border-strong);
  }
</style>
