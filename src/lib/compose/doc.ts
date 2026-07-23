/**
 * The compose-box document model: a flat list of nodes, each either free-typed
 * `text` or `tint` — the body of an inserted snippet, marked with a tint that
 * signals template provenance. Pure data + pure transforms — no DOM, no Svelte.
 * The Doc is the single source of truth; the contenteditable is only an input
 * device.
 *
 * ── Why tinted text, and not chips ───────────────────────────────────────────
 *
 * Until phase 3 an inserted snippet was a `chip`: a `contenteditable="false"`
 * atom that RENDERED as its name + variables but CONTRIBUTED its whole body to
 * the copied prompt. That rendered≠contributed split was the source of a defect
 * class — the chip carried a link back to a library file, and keeping composed
 * text in sync with that file (the old `linked-modified` provenance) produced
 * silent divergence bugs.
 *
 * The founder's decision deletes the split at the root: an inserted snippet is
 * now its WHOLE body text, dropped into the box as ordinary editable text and
 * tinted to show it came from a template. **There is no link back to the library
 * file.** Once inserted, the text is just text with a tint — editing it touches
 * nothing on disk, so the divergence class cannot return. The library is written
 * only through an explicit Save-as-snippet action, never as a side effect of
 * editing composed text.
 *
 * Rendered == contributed again, which is why the entire chip apparatus is gone:
 * no `cid` instance identity, no body-carried-on-the-node, no ZWSP caret
 * scaffolding, no popup edit surface, no `dirty` state, no clip-and-demote
 * algebra. A `tint` node is just a `text` node wearing a highlight; both carry
 * editable text, and `flatten` returns exactly what the box shows.
 */

/** Free-typed text. */
export interface TextNode {
  kind: 'text';
  text: string;
}

/**
 * An inserted snippet's body — ordinary editable text, tinted to signal it came
 * from a template. Carries no snippet identity and no library link: the tint is a
 * pure visual flag, so a `tint` node and a `text` node differ only in how the box
 * paints them. Editing a tinted run writes nothing to the library.
 */
export interface TintNode {
  kind: 'tint';
  text: string;
}

export type Node = TextNode | TintNode;

export interface Doc {
  nodes: Node[];
}

export function emptyDoc(): Doc {
  return { nodes: [] };
}

/** A doc that is all free-typed text. */
export function docFromText(text: string): Doc {
  return normalize({ nodes: text ? [{ kind: 'text', text }] : [] });
}

/**
 * Canonical form: no empty nodes, no two adjacent nodes of the same kind.
 *
 * Merging adjacent same-kind runs keeps the model minimal — two snippets inserted
 * back to back collapse into one tinted run, which is fine because the tint is
 * only a flag, not an identity. Adjacent nodes of DIFFERENT kind stay separate:
 * that boundary is where the paint changes.
 */
export function normalize(doc: Doc): Doc {
  const nodes: Node[] = [];
  for (const n of doc.nodes) {
    if (!n.text) continue; // drop empties
    const prev = nodes[nodes.length - 1];
    if (prev && prev.kind === n.kind) prev.text += n.text;
    else nodes.push({ ...n });
  }
  return { nodes };
}

/** The composed prompt's raw text: every node's text, in order. Rendered ==
 *  contributed now, so this is simply what the box shows. Everything downstream
 *  (the variable fill list, Copy Prompt) reads this. */
export function flatten(doc: Doc): string {
  return doc.nodes.map((n) => n.text).join('');
}

/**
 * Where a caret sits. `node` indexes `doc.nodes`; `offset` is the character
 * offset within that node's text. Every node carries text now (a `tint` run is
 * editable), so a caret is always a position inside some node's text — there is
 * no atom to sit beside.
 */
export interface Caret {
  node: number;
  offset: number;
}

/** The `{node, offset}` for a character offset into `flatten(doc)`. At an exact
 *  node boundary it prefers the START of the next node over the END of the
 *  current one, so a caret placed just past an inserted snippet lands in the
 *  following free text rather than at the trailing edge of the tint (where typing
 *  would otherwise inherit the tint). */
export function caretAtGlobalOffset(doc: Doc, globalOffset: number): Caret {
  let remaining = Math.max(0, globalOffset);
  for (let i = 0; i < doc.nodes.length; i++) {
    const len = doc.nodes[i].text.length;
    const isLast = i === doc.nodes.length - 1;
    if (remaining < len || (remaining === len && isLast)) {
      return { node: i, offset: remaining };
    }
    remaining -= len;
  }
  // Past the end (or empty doc): clamp to the last node's end.
  const last = doc.nodes.length - 1;
  return last >= 0 ? { node: last, offset: doc.nodes[last].text.length } : { node: 0, offset: 0 };
}

/**
 * Insert a snippet as a tinted run, replacing the query line the user typed to
 * find it (from the start of the caret's line up to the caret).
 *
 * The query was scaffolding — the user typed "senior review" only to summon the
 * snippet, so leaving it in front of the inserted text is litter. This is the
 * single insert path behind both triggers: clicking a match, and ↓-into-panel
 * then Enter.
 *
 * Returns the new doc AND the caret position just past the inserted text, so the
 * next keystroke continues the sentence. The leading/trailing remnants keep the
 * kind of the node the caret was in — splitting a tinted run leaves both halves
 * tinted; splitting free text leaves both halves free.
 */
export function insertSnippet(
  doc: Doc,
  caret: Caret,
  text: string
): { doc: Doc; caret: Caret } {
  const at = Math.max(0, Math.min(caret.node, doc.nodes.length));
  const node = doc.nodes[at];
  const tintNode: TintNode = { kind: 'tint', text };

  // The caret is past the end of the model: just append.
  if (!node) {
    const result = normalize({ nodes: [...doc.nodes, tintNode] });
    return { doc: result, caret: caretAtGlobalOffset(result, flatten(result).length) };
  }

  const offset = Math.max(0, Math.min(caret.offset, node.text.length));
  const lineStart = node.text.lastIndexOf('\n', offset - 1) + 1;

  const result = normalize({
    nodes: [
      ...doc.nodes.slice(0, at),
      { kind: node.kind, text: node.text.slice(0, lineStart) },
      tintNode,
      { kind: node.kind, text: node.text.slice(offset) },
      ...doc.nodes.slice(at + 1),
    ],
  });

  const prefixLen = flatten({ nodes: doc.nodes.slice(0, at) }).length + lineStart;
  return { doc: result, caret: caretAtGlobalOffset(result, prefixLen + text.length) };
}

/**
 * Insert plain text at the caret — a sibling of `insertSnippet` for dictated
 * text. Two differences from a snippet insert: the new run is untinted
 * (dictated text carries no template provenance), and there is no query line
 * to consume — the caret sits at an ordinary typing position, not at the end
 * of a search query, so both sides of it are kept intact and the text simply
 * lands between them.
 *
 * Returns the new doc AND the caret position just past the inserted text, so
 * the next utterance continues where this one left off.
 */
export function insertText(doc: Doc, caret: Caret, text: string): { doc: Doc; caret: Caret } {
  const at = Math.max(0, Math.min(caret.node, doc.nodes.length));
  const node = doc.nodes[at];
  const textNode: TextNode = { kind: 'text', text };

  // The caret is past the end of the model: just append.
  if (!node) {
    const result = normalize({ nodes: [...doc.nodes, textNode] });
    return { doc: result, caret: caretAtGlobalOffset(result, flatten(result).length) };
  }

  const offset = Math.max(0, Math.min(caret.offset, node.text.length));

  const result = normalize({
    nodes: [
      ...doc.nodes.slice(0, at),
      { kind: node.kind, text: node.text.slice(0, offset) },
      textNode,
      { kind: node.kind, text: node.text.slice(offset) },
      ...doc.nodes.slice(at + 1),
    ],
  });

  const prefixLen = flatten({ nodes: doc.nodes.slice(0, at) }).length + offset;
  return { doc: result, caret: caretAtGlobalOffset(result, prefixLen + text.length) };
}

// ── the contenteditable seam ─────────────────────────────────────────────────
// The box renders these nodes and reads them back. Keeping both directions as
// pure functions over plain data — rather than letting the component walk the DOM
// straight into state — is what makes the round-trip testable:
//
//     doc → (render) → DOM → readRawNodes → fromRawNodes → doc
//
// must be the identity. If it is not, a user's prompt silently corrupts into
// something that still LOOKS plausible in the box and copies out wrong.

/** One child of the contenteditable, read back off the DOM: a run of text, and
 *  whether it sat inside a tint span (`tint: true`). */
export interface RawNode {
  tint: boolean;
  text: string;
}

/**
 * Rebuild the Doc from what the DOM now holds.
 *
 * Reading the DOM back wholesale — rather than intercepting each edit and
 * patching the model — is what makes this robust. Typing, paste, cut, drag, undo
 * and IME composition all arrive as "the box now contains this", with no
 * per-inputType transition table to get wrong. A run's `tint` flag comes straight
 * from whether the browser kept it inside a `.tint` span, so provenance follows
 * the text through every edit for free; the text itself is always preserved,
 * which is the invariant that matters (a mis-tinted run is a cosmetic drift, a
 * lost run is data loss).
 */
export function fromRawNodes(raw: RawNode[]): Doc {
  return normalize({
    nodes: raw.map((r): Node => ({ kind: r.tint ? 'tint' : 'text', text: r.text })),
  });
}

/**
 * The live-match query for a caret: what you are typing right now — the current
 * line of the caret's text, up to the caret. Tail-capped so one very long line
 * cannot swamp the matcher.
 */
export function caretQuery(text: string, offset: number, cap = 120): string {
  const upto = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lineStart = upto.lastIndexOf('\n') + 1;
  const line = upto.slice(lineStart).trim();
  return line.length > cap ? line.slice(line.length - cap) : line;
}
