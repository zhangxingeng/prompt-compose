<script lang="ts">
  /**
   * The compose surface. A contenteditable box holding ordinary editable text.
   * Some of that text is TINTED — it was inserted from the library as a snippet
   * body — but a tinted run is not special: it is the same editable text with a
   * highlight marking its template provenance. There is no atom, no chip, no
   * popup, and no link back to the library file. Once inserted, the text is just
   * text; editing it writes nothing to disk.
   *
   * ── Why the DOM is read back wholesale ──────────────────────────────────────
   * Every user edit lands in `syncFromDom`: we read what the box now contains and
   * rebuild the Doc from it, carrying each run's tint flag across by whether the
   * browser kept it inside a `.tint` span. Typing, paste, cut, drag, undo and IME
   * composition all arrive the same way, so there is no per-inputType transition
   * table to get wrong. The reverse direction (`render`) runs ONLY for changes
   * made from outside the box — an insert — because repainting under the user's
   * own keystrokes would destroy their caret.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { prompts, composeSetDoc, composeSetCaret, clearPendingCaret } from '$lib/prompts.svelte';
  import { type Caret, type RawNode } from '$lib/compose/doc';
  import { dictate, startPushToTalk, stopPushToTalk, refreshModelStatus } from '$lib/dictate.svelte';
  import DictatePopover from './DictatePopover.svelte';

  interface Props {
    /** Copy Prompt — the parent owns the clipboard call + toast. */
    onCopy: () => void;
    /** Clear — empty the box in one click. The parent resets the store (doc,
     *  caret, fills) so the reset flows back through render, never by poking the
     *  DOM. */
    onClear: () => void;
    /** ↓ at the very end steps into the match panel; returns whether the panel had
     *  a hit to land on, so ↓ stays a caret move when the panel is empty. */
    onStepIntoPanel: () => boolean;
  }

  let { onCopy, onClear, onStepIntoPanel }: Props = $props();

  let boxEl: HTMLDivElement | undefined = $state(undefined);
  let dictatePopoverOpen = $state(false);

  const hasContent = $derived(prompts.doc.nodes.length > 0);

  /** Esc out of the match panel puts the caret back in the box. */
  export function focus(): void {
    boxEl?.focus();
  }

  // ── render: model → DOM (external changes only) ─────────────────────────────

  /** One tinted run. Built programmatically because Svelte must not own the
   *  children of a contenteditable — it would repaint them under the caret. The
   *  span carries no scoping class of Svelte's, so the styles below reach it with
   *  :global from the scoped box. The run stays editable (contenteditable is
   *  inherited true), so the caret moves through it like any other text. */
  function tintElement(text: string): HTMLElement {
    const el = document.createElement('span');
    el.className = 'tint';
    el.textContent = text;
    return el;
  }

  /** Paint the box from the Doc. One DOM child per model node, in order, so a
   *  model node index equals its DOM child index right after a render — which is
   *  what makes `placeCaret` below a straight index lookup. */
  function render(): void {
    if (!boxEl) return;
    const children: globalThis.Node[] = prompts.doc.nodes.map((n) =>
      n.kind === 'text' ? document.createTextNode(n.text) : tintElement(n.text)
    );
    boxEl.replaceChildren(...children); // empty → :empty shows the placeholder
  }

  /** Repaint only when the doc changed from OUTSIDE the box (an insert).
   *  `renderNonce` is bumped by exactly that path — reacting to `doc` itself would
   *  repaint on every keystroke and take the caret with it.
   *
   *  `render()` reads `prompts.doc`, and a Svelte 5 `$effect` tracks every
   *  reactive read that happens synchronously during its run — so without
   *  `untrack`, this effect would ALSO rerun on every `prompts.doc` write (every
   *  keystroke via `syncFromDom`), repainting the box and yanking the caret. */
  $effect(() => {
    void prompts.renderNonce;
    untrack(render);
    void tick().then(placeCaretAfterInsert);
  });

  /** After an external insert the caret belongs just past the inserted text, so
   *  the user's next keystroke continues the sentence. The store hands us a model
   *  Caret; because render just painted the box 1:1 from the model, the caret's
   *  node index is a direct DOM child index. */
  function placeCaretAfterInsert(): void {
    const caret = prompts.pendingCaret;
    if (!caret || !boxEl) return;
    placeCaret(caret);
    clearPendingCaret();
  }

  function placeCaret(caret: Caret): void {
    if (!boxEl) return;
    const child = boxEl.childNodes[caret.node];
    if (!child) {
      setCaretAtBoxIndex(boxEl.childNodes.length);
      return;
    }
    if (child.nodeType === globalThis.Node.TEXT_NODE) {
      const len = (child.nodeValue ?? '').length;
      setCaret(child, Math.min(caret.offset, len));
      return;
    }
    // A tint span. Land the caret INSIDE it, unless we're at its trailing edge —
    // there, drop the caret at box level just AFTER the span, so the next
    // keystroke starts a fresh (untinted) text node instead of extending the
    // tint. This is what keeps a snippet's tint from bleeding onto the words the
    // user types after it.
    const textChild = child.firstChild;
    const len = textChild ? (textChild.nodeValue ?? '').length : 0;
    if (textChild && caret.offset < len) {
      setCaret(textChild, caret.offset);
    } else {
      setCaretAtBoxIndex(caret.node + 1);
    }
  }

  function setCaret(node: globalThis.Node, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    boxEl?.focus();
  }

  /** A collapsed caret at box level, before the child at `index` (or at the end
   *  when `index` is the child count). */
  function setCaretAtBoxIndex(index: number): void {
    if (!boxEl) return;
    const range = document.createRange();
    range.setStart(boxEl, Math.min(index, boxEl.childNodes.length));
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    boxEl.focus();
  }

  // ── read back: DOM → model (every user edit) ────────────────────────────────

  /** Flatten the box's children into raw runs. A run's `tint` flag is whether it
   *  sat inside a `.tint` span; the browser keeps that class through edits and
   *  splits, so provenance follows the text for free. */
  function readRawNodes(): RawNode[] {
    const raw: RawNode[] = [];
    if (!boxEl) return raw;

    const collect = (node: ChildNode, isLastChild: boolean, tinted: boolean): void => {
      if (node.nodeType === globalThis.Node.TEXT_NODE) {
        raw.push({ tint: tinted, text: node.nodeValue ?? '' });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'BR') {
        // Browsers append a filler <br> to keep the last line clickable. It is not
        // a newline the user typed, and counting it would grow the prompt by a
        // blank line on every render.
        if (!isLastChild) raw.push({ tint: tinted, text: '\n' });
        return;
      }
      // A `.tint` span tints everything inside it; any other wrapper (a div from
      // Enter, a formatting span the browser split off) inherits the tint context
      // it sits in. Recurse rather than take textContent so nested structure is
      // preserved run by run.
      const isTint = tinted || node.classList.contains('tint');
      const kids = Array.from(node.childNodes);
      kids.forEach((k, i) => collect(k, i === kids.length - 1, isTint));
    };

    const children = Array.from(boxEl.childNodes);
    children.forEach((c, i) => collect(c, i === children.length - 1, false));
    return raw;
  }

  /**
   * Where the caret is in MODEL terms, plus the text of the node it sits in (the
   * live-match query reads that). The box is a flat run of text nodes and tint
   * spans, so the caret's model node index is the count of runs before it.
   */
  function caretFromDom(): { caret: Caret; text: string } | null {
    const sel = window.getSelection();
    if (!sel?.isCollapsed || !boxEl || !sel.anchorNode) return null;
    if (!boxEl.contains(sel.anchorNode)) return null;

    const anchor = sel.anchorNode;

    // The caret resolved onto the box itself, with offset = a child index.
    if (anchor === boxEl) {
      const before = Array.from(boxEl.childNodes)
        .slice(0, sel.anchorOffset)
        .filter(isModelNode).length;
      return { caret: { node: before, offset: 0 }, text: '' };
    }

    // Walk the flat children, counting model runs, to find the anchor.
    let index = 0;
    for (const child of Array.from(boxEl.childNodes)) {
      if (child.nodeType === globalThis.Node.TEXT_NODE) {
        if (child === anchor) {
          return { caret: { node: index, offset: sel.anchorOffset }, text: child.nodeValue ?? '' };
        }
        if ((child.nodeValue ?? '') !== '') index++;
        continue;
      }
      if (child instanceof HTMLElement && child.classList.contains('tint')) {
        const textChild = child.firstChild;
        if (child === anchor) {
          // Anchor on the span element itself — offset is a child index; treat
          // the whole span's text as the caret's text node.
          const text = textChild?.nodeValue ?? '';
          return { caret: { node: index, offset: sel.anchorOffset ? text.length : 0 }, text };
        }
        if (textChild === anchor) {
          return { caret: { node: index, offset: sel.anchorOffset }, text: textChild.nodeValue ?? '' };
        }
        index++;
      }
    }
    return null;
  }

  function isModelNode(node: ChildNode): boolean {
    if (node.nodeType === globalThis.Node.TEXT_NODE) return (node.nodeValue ?? '') !== '';
    return node instanceof HTMLElement && node.classList.contains('tint');
  }

  /** One user edit: rebuild the model from the box, then re-read the caret. This
   *  never repaints — the DOM is already what the user sees, and repainting it
   *  would take their caret with it. */
  function syncFromDom(): void {
    composeSetDoc(readRawNodes());
    syncCaret();
  }

  function syncCaret(): void {
    const at = caretFromDom();
    composeSetCaret(at?.caret ?? null, at?.text ?? '');
  }

  // ── input handling ──────────────────────────────────────────────────────────

  /** How long Space must be held before it's treated as push-to-talk rather
   *  than a normal keystroke. Below this, releasing early just types a space
   *  like any other key. */
  const SPACE_HOLD_MS = 500;

  /** Set only between a non-repeat Space keydown and either its matching
   *  keyup (a quick tap) or the hold timer firing (a hold). Doubles as the
   *  "was this a hold or a tap" flag for keyup/blur. */
  let spaceHoldTimer: ReturnType<typeof setTimeout> | undefined;

  /** Space types a normal space on a quick tap, and is push-to-talk on a
   *  hold — distinguished by a short debounce rather than by keydown itself,
   *  since starting dictation immediately on keydown made every ordinary
   *  space-bar press (typing a sentence) either swallowed or misread as a
   *  dictation attempt. The keydown types the space right away so a fast tap
   *  reads as an ordinary keystroke with no lag; if the key is still down
   *  once `SPACE_HOLD_MS` elapses, that provisional space is the only
   *  character that could have been typed during the hold (repeats are
   *  ignored below), so removing exactly one character undoes it cleanly
   *  before dictation starts. `e.repeat` guards the OS auto-repeat keydowns
   *  that fire for as long as the physical key stays down. */
  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      document.execCommand('insertText', false, ' ');
      spaceHoldTimer = setTimeout(() => {
        spaceHoldTimer = undefined;
        document.execCommand('delete', false); // undo the provisional space
        void startPushToTalk();
      }, SPACE_HOLD_MS);
      return;
    }
    if (e.key === 'Enter') {
      // Own the newline. Left to itself the browser splits the box into <div>s (or
      // drops in a <br>), and the model would have to reverse-engineer block
      // structure back into text. A literal \n keeps the box one flat run.
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
      return;
    }
    if (e.key === 'ArrowDown' && atEnd() && onStepIntoPanel()) {
      // ↓ is natively inert only at the very end of the text — the one position
      // where repurposing it to step into the match panel cannot steal a caret
      // move. onStepIntoPanel returns false when the panel is empty, so ↓ then
      // falls through to its default no-op.
      e.preventDefault();
    }
  }

  function handleKeyup(e: KeyboardEvent): void {
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (spaceHoldTimer !== undefined) {
        // Released before the hold threshold — a normal tap. The space typed
        // on keydown already stands as ordinary text; nothing to undo.
        clearTimeout(spaceHoldTimer);
        spaceHoldTimer = undefined;
        return;
      }
      void stopPushToTalk();
    }
  }

  /** Losing focus mid-hold (Alt-Tab, a click elsewhere) must not leave the mic
   *  open forever — the keyup would never arrive at this element again. If
   *  focus is lost before the hold threshold, treat it like a released tap
   *  rather than a cancelled dictation attempt (dictation never started). */
  function handleBlur(): void {
    if (spaceHoldTimer !== undefined) {
      clearTimeout(spaceHoldTimer);
      spaceHoldTimer = undefined;
      return;
    }
    void stopPushToTalk();
  }

  /** True when the caret sits at the very end of the box's content. */
  function atEnd(): boolean {
    const sel = window.getSelection();
    if (!sel?.isCollapsed || !boxEl || !sel.anchorNode) return false;
    const range = document.createRange();
    range.selectNodeContents(boxEl);
    range.setStart(sel.anchorNode, sel.anchorOffset);
    return range.toString() === '';
  }

  function handlePaste(e: ClipboardEvent): void {
    // Plain text only. Pasted markup would arrive as elements we did not create;
    // flattening it to text keeps the box a single editable run. execCommand keeps
    // the browser's own undo stack intact.
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) document.execCommand('insertText', false, text);
  }

  onMount(() => {
    // So the very first Space press already knows whether the model is on
    // disk, instead of waiting on a round trip before it can even decide.
    void refreshModelStatus();
  });

  onMount(() => {
    // selectionchange is the only reliable way to track caret moves (arrows,
    // clicks, shift-selects) inside a contenteditable.
    function onSelectionChange(): void {
      const anchor = document.getSelection()?.anchorNode ?? null;
      if (!boxEl || !anchor || !boxEl.contains(anchor)) return;
      syncCaret();
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  });
</script>

<div class="compose">
  <div class="compose__stack">
    <div
      bind:this={boxEl}
      class="compose__box"
      contenteditable="true"
      role="textbox"
      tabindex="0"
      aria-multiline="true"
      aria-label="Prompt compose box"
      data-placeholder="Compose your prompt…"
      spellcheck="false"
      oninput={syncFromDom}
      onkeydown={handleKeydown}
      onkeyup={handleKeyup}
      onblur={handleBlur}
      onpaste={handlePaste}
    ></div>

    <!-- Top-right icons, semi-transparent — the affordance every code block on
         the web already has. Clear/Copy present only when the box has content,
         so a no-op is never offered; the mic is always available since you may
         well be dictating into an empty box. -->
    <div class="compose__actions">
      {#if hasContent}
        <button
          type="button"
          class="compose__iconbtn"
          onclick={onClear}
          title="Clear prompt"
          aria-label="Clear prompt"
        >
          ✕
        </button>
        <button
          type="button"
          class="compose__iconbtn"
          onclick={onCopy}
          title="Copy prompt"
          aria-label="Copy prompt"
        >
          ⧉
        </button>
      {/if}
      <!-- A status indicator, not a button: dictation starts/stops by holding
           Space in the box (see handleKeydown/handleKeyup) — a click-to-toggle
           mic was tried and dropped as an extra step that added nothing. This
           just shows what's currently happening: idle, opening the mic,
           recording (with a small equalizer animation standing in for a
           waveform, kept intentionally simple), or transcribing the one
           decode that runs after Space is released — no live partial text,
           see `dictate.svelte.ts` for why. -->
      <div
        class="compose__mic"
        class:compose__mic--active={dictate.dictating}
        title={dictate.dictating
          ? 'Recording — release Space to stop'
          : dictate.transcribing
            ? 'Transcribing…'
            : 'Hold Space in the box to dictate'}
        aria-label={dictate.dictating ? 'Recording' : dictate.transcribing ? 'Transcribing' : 'Not recording'}
        role="status"
      >
        {#if dictate.preparingModel || dictate.transcribing}
          <span class="compose__mic-icon">…</span>
        {:else if dictate.dictating}
          <span class="compose__mic-bars" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </span>
        {:else}
          <span class="compose__mic-icon">🎤</span>
        {/if}
      </div>
      <button
        type="button"
        class="compose__iconbtn"
        onclick={() => (dictatePopoverOpen = !dictatePopoverOpen)}
        title="Dictation settings"
        aria-label="Dictation settings"
      >
        ⋯
      </button>
      {#if dictatePopoverOpen}
        <DictatePopover onClose={() => (dictatePopoverOpen = false)} />
      {/if}
    </div>
  </div>
</div>

<style>
  .compose {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
    min-width: 0;
  }

  .compose__stack {
    position: relative;
    flex: 1;
    min-height: 16rem;
    display: flex;
  }

  .compose__box {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    padding: 0.8rem 0.9rem 3rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-card);
    color: var(--text);
    box-sizing: border-box;
    overflow-y: auto;
  }
  .compose__box:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--accent-snippet) 55%, var(--border));
  }
  .compose__box:empty::before {
    content: attr(data-placeholder);
    color: var(--text-faint);
    pointer-events: none;
  }
  /* The text inside the box is not Svelte-owned (tint spans are built by hand), so
     the selection style has to be reached globally — scoped to the box. */
  .compose__box :global(::selection) {
    background: var(--highlight);
    color: var(--highlight-foreground);
  }

  /* An inserted snippet's body: ordinary editable text under a highlight that
     marks its template provenance. Built programmatically (Svelte must not own the
     children of a contenteditable), so it carries no scoping class and is reached
     with :global from the scoped box. `box-decoration-break: clone` keeps the
     highlight intact when a tinted run wraps across lines. */
  .compose__box :global(.tint) {
    background: color-mix(in srgb, var(--accent-snippet) 15%, transparent);
    border-radius: 0.15rem;
    padding: 0.05rem 0;
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  /* Semi-transparent icons, top-right — the affordance every code block on the
     web already has. Clear then Copy, so Copy keeps its established corner. */
  .compose__actions {
    position: absolute;
    top: 0.6rem;
    right: 0.6rem;
    display: flex;
    gap: 0.4rem;
  }
  .compose__iconbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1;
    opacity: 0.55;
    cursor: pointer;
  }
  .compose__iconbtn:hover,
  .compose__iconbtn:focus-visible {
    opacity: 1;
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent-snippet) 55%, var(--border));
    outline: none;
  }
  /* The mic status indicator — same footprint as the icon buttons next to it,
     but not interactive (no hover/focus states, no cursor: pointer): it only
     ever reports what Space is doing. */
  .compose__mic {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1;
    opacity: 0.55;
  }
  .compose__mic--active {
    opacity: 1;
    color: var(--accent-result-err);
    border-color: color-mix(in srgb, var(--accent-result-err) 55%, var(--border));
  }
  .compose__mic-icon {
    display: block;
  }
  /* Four bars bouncing out of phase — a plain stand-in for a waveform, just
     enough motion to read as "actively listening" without a real analyser. */
  .compose__mic-bars {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    height: 0.9rem;
  }
  .compose__mic-bars span {
    width: 0.15rem;
    height: 100%;
    border-radius: 0.1rem;
    background: currentColor;
    animation: compose-mic-bar 0.9s ease-in-out infinite;
    transform-origin: center;
  }
  .compose__mic-bars span:nth-child(1) { animation-delay: 0s; }
  .compose__mic-bars span:nth-child(2) { animation-delay: 0.15s; }
  .compose__mic-bars span:nth-child(3) { animation-delay: 0.3s; }
  .compose__mic-bars span:nth-child(4) { animation-delay: 0.45s; }

  @keyframes compose-mic-bar {
    0%, 100% { transform: scaleY(0.3); }
    50% { transform: scaleY(1); }
  }
</style>
