<script module lang="ts">
  /** How the popup was opened. It has one entrance now — the library's `+`
   *  button — and one job: create a snippet (write a `.md` file to the active
   *  project folder). There is no chip-edit entrance any more: an inserted
   *  snippet is tinted editable text with no link back to its file, so editing
   *  composed text writes nothing to the library. */
  export interface SnippetModalContext {
    /** Prefilled name — empty when creating from scratch. */
    name?: string;
    /** Prefilled body — empty when creating from scratch. */
    content: string;
  }
</script>

<script lang="ts">
  /**
   * The snippet popup: the one explicit **Save-as-snippet** action — the only
   * in-app way the library is written.
   *
   * This is deliberately the ONLY writer. An inserted snippet is ordinary tinted
   * text with no link to its file, so editing it in the compose box touches
   * nothing on disk; the library changes only when the user explicitly saves one
   * here. That is what kills the old defect class — composed text and a library
   * file drifting apart because editing in the box silently rewrote (or failed to
   * rewrite) the file.
   *
   * Editing or deleting an EXISTING snippet is not an in-app action: a snippet is
   * a `.md` file whose filename is its name, so that is done in `$EDITOR` or the
   * file manager. Saving here under an existing name overwrites that file (the
   * filename is the identity), which is the whole of "Save vs Save as new" —
   * collapsed into one button and disambiguated by the name field.
   *
   * The variable fills below are the SAME global cells as the list under the
   * compose box; this popup just shows the subset THIS body uses. A variable is
   * one global value by name, and showing one cell in two views is convenience,
   * not a second place to edit.
   */
  import { untrack } from 'svelte';
  import { prompts, saveSnippet, setFill } from '$lib/prompts.svelte';
  import { parseVariables, UNSET_VALUE } from '$lib/compose/variables';
  import { focusTrap } from '$lib/attachments/focusTrap';

  interface Props {
    context: SnippetModalContext;
    /** The active project's folder — a snippet is a file inside it. */
    project: string;
    onClose: () => void;
  }

  let { context, project, onClose }: Props = $props();

  let name = $state(untrack(() => context.name ?? ''));
  let content = $state(untrack(() => context.content));
  let error = $state<string | null>(null);
  let busy = $state(false);
  let nameEl: HTMLInputElement | undefined = $state(undefined);

  /** The variables THIS body uses. Derived as you type, so a variable you add
   *  shows up the moment it parses — which is also the feedback that tells you the
   *  grammar saw what you meant. */
  const variables = $derived(parseVariables(content));

  /** Write `<name>.md` to the project folder. Same name overwrites; a new name
   *  creates — the filename is the identity. */
  async function save(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'A snippet needs a name.';
      return;
    }
    busy = true;
    error = null;
    try {
      await saveSnippet(project, trimmed, content);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      busy = false;
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  // Focus the name on open — naming the snippet is the first thing to do.
  $effect(() => {
    nameEl?.focus();
  });
</script>

<div
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-labelledby="snippet-modal-title"
  onkeydown={handleKeydown}
  tabindex="-1"
>
  <div class="modal snippet-modal" tabindex="-1" {@attach focusTrap}>
    <h3 id="snippet-modal-title">Save as snippet</h3>

    <label class="snippet-modal__field">
      <span>Name</span>
      <input
        type="text"
        bind:this={nameEl}
        bind:value={name}
        autocomplete="off"
        spellcheck="false"
        placeholder="e.g. rust/code_review"
      />
    </label>
    <p class="snippet-modal__hint">
      <!-- Subfolders ARE the organization system: the user groups prompts with a
           folder, which they can make here or in Finder. No tags, no UI. -->
      A <code>/</code> in the name makes a folder. Saving under an existing name overwrites it.
    </p>

    <label class="snippet-modal__field snippet-modal__field--body">
      <span>Content</span>
      <textarea
        class="snippet-modal__body"
        bind:value={content}
        spellcheck="false"
      ></textarea>
    </label>

    {#if variables.length}
      <div class="snippet-modal__vars">
        <span class="snippet-modal__vars-label">Variables</span>
        {#each variables as v (v.name)}
          <div class="snippet-modal__var-row">
            <span class="snippet-modal__var-name">{v.name}</span>
            <input
              type="text"
              class="snippet-modal__var-value"
              value={prompts.fills[v.name] ?? ''}
              oninput={(e) => setFill(v.name, e.currentTarget.value)}
              placeholder={UNSET_VALUE}
              autocomplete="off"
              spellcheck="false"
              aria-label="Value for {v.name}"
            />
          </div>
        {/each}
      </div>
    {/if}

    {#if error}
      <div class="modal__warning">{error}</div>
    {/if}

    <div class="modal__actions">
      <button type="button" class="btn btn--ghost btn--sm" onclick={onClose}>Cancel</button>
      <button type="button" class="btn btn--primary btn--sm" disabled={busy} onclick={save}>
        Save
      </button>
    </div>
  </div>
</div>

<style>
  .snippet-modal {
    max-width: 560px;
  }

  .snippet-modal__field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.68rem;
    color: var(--text-muted);
  }
  .snippet-modal__field--body {
    margin-top: 0.5rem;
  }
  .snippet-modal__field input {
    font-family: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--text);
  }

  .snippet-modal__hint {
    margin: 0.3rem 0 0;
    font-size: 0.66rem;
    color: var(--text-faint);
  }
  .snippet-modal__hint code {
    font-family: var(--font-mono);
  }

  .snippet-modal__body {
    width: 100%;
    min-height: 9rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1.5;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg);
    color: var(--text);
    resize: vertical;
    box-sizing: border-box;
  }
  .snippet-modal__body:focus {
    outline: none;
    border-color: var(--accent-snippet);
  }

  .snippet-modal__vars {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.6rem;
  }
  .snippet-modal__vars-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-faint);
  }
  .snippet-modal__var-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .snippet-modal__var-name {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: color-mix(in srgb, var(--accent-template) 80%, var(--text));
    min-width: 7rem;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .snippet-modal__var-value {
    flex: 1;
    min-width: 0;
    font-family: inherit;
    font-size: 0.78rem;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg);
    color: var(--text);
  }
  .snippet-modal__var-value::placeholder {
    color: var(--text-faint);
    font-style: italic;
  }
</style>
