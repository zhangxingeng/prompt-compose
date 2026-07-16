/**
 * Smoke test for the Prompt Library's pure logic (issue #31, v0.13):
 *   - the variable grammar + copy output (compose/variables.ts)
 *   - the compose-box node model and the contenteditable round-trip (compose/doc.ts)
 *
 * Run with: npx tsx tests/prompts_smoke.mjs   (from repo root)
 *
 * The grammar vectors below are the ONLY copy. `src-tauri/src/prompts/grammar.rs`
 * is deleted — nothing in the backend parses variables any more — so there is no
 * second implementation to keep in sync, and no cross-language table. It also
 * means nothing else will catch a grammar mistake: these vectors are the whole
 * safety net.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const {
  emptyDoc,
  docFromText,
  normalize,
  flatten,
  caretAtGlobalOffset,
  insertSnippet,
  fromRawNodes,
  caretQuery,
} = await import(join(root, 'src/lib/compose/doc.ts'));
const { parseVariables, copyText, UNSET_VALUE } = await import(
  join(root, 'src/lib/compose/variables.ts')
);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, `${msg}\n    expected ${e}\n    got      ${a}`);
}

const names = (text) => parseVariables(text).map((v) => v.name);
const kinds = (doc) => doc.nodes.map((n) => n.kind);
const text = (t) => ({ kind: 'text', text: t });
const tint = (t) => ({ kind: 'tint', text: t });

// ── the grammar: `{name}` and nothing else ───────────────────────────────────
console.log('variable grammar');
{
  eq(names('{task}'), ['task'], '{task} — a variable');
  eq(names('{x-1_Y}'), ['x-1_Y'], '{x-1_Y} — hyphen / underscore / digit / case are name chars');

  // The removed default form degrades to PROSE, not to a variable that silently
  // swallows its default. Loud beats silent: the user sees the stray text.
  eq(names('{task:write tests}'), [], '{task:write tests} — the removed default form is prose');
  eq(
    copyText('do {task:write tests}!', {}),
    'do {task:write tests}!',
    '{task:write tests} copies out verbatim — nothing swallowed'
  );

  eq(names('{my var}'), [], '{my var} — a space is not a name char');
  eq(names('{:x}'), [], '{:x} — empty name is prose');
  eq(names('{a.b}'), [], '{a.b} — a dot is not a name char');
  eq(names('{"a": 1}'), [], '{"a": 1} — JSON in a prompt body is prose');
  eq(names('{}'), [], '{} — empty braces are prose');

  // Escapes.
  eq(names('{{task}}'), [], '{{task}} — escaped, no variable');
  eq(copyText('{{task}}', {}), '{task}', '{{task}} copies out as literal {task}');
  eq(names('{{{task}}}'), ['task'], '{{{task}}} — literal { + variable + literal }');
  eq(
    copyText('{{{task}}}', { task: 'X' }),
    '{<prompt_var name="task"/>}\n\n<prompt_vars>\n<prompt_var name="task">X</prompt_var>\n</prompt_vars>',
    '{{{task}}} hoists the inner variable, braces stay literal around the reference'
  );

  // Rule 4: one name = one variable, first-appearance order, deduped.
  eq(names('{b} {a} {b}'), ['b', 'a'], 'dedupe, first-appearance order');
}

// ── the grammar is UNIFORM: there is no Markdown awareness ───────────────────
// It does not know what a fence or a backtick is. An earlier draft excluded code
// from parsing; that was cut. "Variables work everywhere except inside backticks
// and except inside fences" is a rule you must be TOLD — unguessable-without-the-
// contract is the disease this round exists to cure. "It's a Python format
// string" is a rule the user already knows. We do not invent protocols.
console.log('no markdown awareness');
{
  // Backticks are ordinary characters.
  eq(names('`{x}`'), ['x'], 'a backtick is just a character — `{x}` IS a variable');
  eq(names('{a}`{b}`{c}'), ['a', 'b', 'c'], 'backticks do not fence anything off');
  eq(
    copyText('`{x}`', { x: 'V' }),
    '`<prompt_var name="x"/>`\n\n<prompt_vars>\n<prompt_var name="x">V</prompt_var>\n</prompt_vars>',
    'a variable in an inline code span is hoisted like any other'
  );

  // So are fences.
  const fenced = 'before {a}\n```rust\nlet x = {b};\n```\nafter {c}';
  eq(names(fenced), ['a', 'b', 'c'], 'a {name} inside a fence IS a variable');
  eq(
    copyText(fenced, { a: '1', b: '2', c: '3' }),
    'before <prompt_var name="a"/>\n```rust\nlet x = <prompt_var name="b"/>;\n```\nafter <prompt_var name="c"/>\n\n' +
      '<prompt_vars>\n<prompt_var name="a">1</prompt_var>\n<prompt_var name="b">2</prompt_var>\n' +
      '<prompt_var name="c">3</prompt_var>\n</prompt_vars>',
    'a fenced variable is hoisted like any other'
  );

  // The cost, accepted knowingly — and LOUD, not silent: the chip renders the
  // variable names it contains and the fill list lists them, so a stray `name`
  // from a code sample is visible, and the user escapes it as {{name}} exactly as
  // they would in Python. The UI surfacing parsed variables is what makes this
  // safe.
  eq(names('```\n{{name}}\n```'), [], 'a fenced {{name}} is an ESCAPE, not a variable');
  eq(
    copyText('```\n{{name}}\n```', {}),
    '```\n{name}\n```',
    'a fenced {{name}} UNESCAPES to {name} — Python semantics, everywhere'
  );

  // ⚠ The one genuinely silent case, asserted rather than prevented (see the
  // module header): a Rust format! escape in a code sample unescapes on copy,
  // because under Python semantics `{{` MEANS a literal brace. To keep a literal
  // `{{`, write `{{{{` — same as Python.
  eq(
    copyText('```rust\nformat!("{{}}", x)\n```', {}),
    '```rust\nformat!("{}", x)\n```',
    'a Rust format! escape unescapes on copy — correct under Python semantics'
  );
  eq(
    copyText('```rust\nformat!("{{{{}}}}", x)\n```', {}),
    '```rust\nformat!("{{}}", x)\n```',
    'to KEEP a literal {{, write {{{{ — exactly as in Python'
  );

  // Rule 3 from the other side: everything Python could not read as a plain field
  // stays literal on its own, with no carve-out doing the work.
  for (const t of ['{a: 1}', '{ return x }', '{a.b}', '{my var}', '{:x}', '{"json": 1}', '{}']) {
    eq(names(t), [], `not a Python field, so literal: ${t}`);
    eq(copyText(t, {}), t, `…and it copies out untouched: ${t}`);
  }

  // Variable-free documents reconstruct exactly — the scanner never loses a byte.
  for (const t of ['', 'plain', '```\n```', '`', 'a`b', 'trailing\n']) {
    eq(copyText(t, {}), t, `byte-preserving: ${JSON.stringify(t)}`);
  }
}

// ── copy output: always hoisted, and the unfilled sentinel ───────────────────
// Round 2 cut the per-variable as-variable toggle. There is exactly one mode
// now: every occurrence becomes a reference, and one appended block carries
// each distinct name's value.
console.log('copy output');
{
  eq(
    copyText('Review {ticket} please.', { ticket: 'ABC-1' }),
    'Review <prompt_var name="ticket"/> please.\n\n' +
      '<prompt_vars>\n<prompt_var name="ticket">ABC-1</prompt_var>\n</prompt_vars>',
    'occurrence becomes a reference, value hoisted into the block'
  );
  eq(
    copyText('{x} and {x}', { x: 'A' }),
    '<prompt_var name="x"/> and <prompt_var name="x"/>\n\n' +
      '<prompt_vars>\n<prompt_var name="x">A</prompt_var>\n</prompt_vars>',
    'repeated occurrences, one block entry'
  );

  // Rule 5 — the sentinel. A forgotten variable still produces a working
  // prompt: the model asks, rather than silently receiving a blank.
  eq(
    copyText('do {task}', {}),
    `do <prompt_var name="task"/>\n\n<prompt_vars>\n<prompt_var name="task">${UNSET_VALUE}</prompt_var>\n</prompt_vars>`,
    'unfilled → the sentinel is the block value'
  );
  eq(
    copyText('do {task}', { task: '' }),
    `do <prompt_var name="task"/>\n\n<prompt_vars>\n<prompt_var name="task">${UNSET_VALUE}</prompt_var>\n</prompt_vars>`,
    'an empty fill reads as untouched → the sentinel'
  );

  // The block is XML-escaped so a value cannot inject phantom variables.
  eq(
    copyText('need {x}', { x: '</prompt_var><prompt_var name="evil">pwned' }),
    'need <prompt_var name="x"/>\n\n<prompt_vars>\n' +
      '<prompt_var name="x">&lt;/prompt_var&gt;&lt;prompt_var name="evil"&gt;pwned</prompt_var>\n' +
      '</prompt_vars>',
    'an injection-shaped value is escaped — no phantom variable'
  );

  // Multiple distinct variables: each is referenced in place, and the block
  // lists every one of them, first-appearance order.
  eq(
    copyText('Deploy {ticket} to {env}.', { ticket: 'ABC-1', env: 'prod' }),
    'Deploy <prompt_var name="ticket"/> to <prompt_var name="env"/>.\n\n' +
      '<prompt_vars>\n<prompt_var name="ticket">ABC-1</prompt_var>\n<prompt_var name="env">prod</prompt_var>\n</prompt_vars>',
    'multiple variables: each referenced in place, both hoisted in order'
  );
  eq(copyText('', {}), '', 'empty document copies empty');
}

// ── the node model ───────────────────────────────────────────────────────────
console.log('node model');
{
  // A tinted run is ordinary text — rendered == contributed. flatten emits every
  // node's text, and the variable grammar reads that flattened text uniformly,
  // tinted runs and free text alike.
  const d = normalize({
    nodes: [text('intro '), tint('Review {lang} code.'), text(' outro')],
  });
  eq(flatten(d), 'intro Review {lang} code. outro', 'flatten emits every run, in order');
  eq(names(flatten(d)), ['lang'], "a tinted run's variables reach the whole-prompt fill list");

  // normalize: drop empties, merge adjacent SAME-kind runs, keep kind boundaries.
  const messy = normalize({
    nodes: [text(''), text('a'), text('b'), tint('S'), tint('T'), text(''), text('u')],
  });
  eq(kinds(messy), ['text', 'tint', 'text'], 'drops empties, merges same-kind, keeps kind boundaries');
  eq(flatten(messy), 'abSTu', 'adjacent text merged, adjacent tint merged');

  // insertSnippet replaces the query line the user typed to summon the snippet,
  // and returns the caret just past the inserted text.
  const q = insertSnippet(docFromText('intro\nsenior review'), { node: 0, offset: 'intro\nsenior review'.length }, 'BODY');
  eq(kinds(q.doc), ['text', 'tint'], 'the query line is consumed; the snippet lands tinted');
  eq(flatten(q.doc), 'intro\nBODY', 'query text replaced, not left in front of the run');
  eq(q.caret, { node: 1, offset: 4 }, 'caret lands at the end of the inserted tint (nothing after it)');

  // A leading line before the query is kept; the query line becomes the tint.
  const withPrefix = insertSnippet(docFromText('line1\nquery'), { node: 0, offset: 'line1\nquery'.length }, 'B');
  eq(flatten(withPrefix.doc), 'line1\nB', 'the prefix line survives, only the query line is replaced');

  // Inserting INSIDE a tinted run: the split halves stay tinted and merge with the
  // insert into one tinted run — no library link, so no instance to keep apart.
  const inTint = insertSnippet(normalize({ nodes: [tint('keep\nquery')] }), { node: 0, offset: 'keep\nquery'.length }, 'NEW');
  eq(kinds(inTint.doc), ['tint'], 'splitting a tint leaves both halves tinted, merged with the insert');
  eq(flatten(inTint.doc), 'keep\nNEW', 'the tinted prefix stays, the query line is replaced');

  // Insert into an empty doc, and past the end.
  const e = insertSnippet(emptyDoc(), { node: 0, offset: 0 }, 'S');
  eq(kinds(e.doc), ['tint'], 'insert into an empty doc lands a tinted run');
  eq(flatten(e.doc), 'S', 'body inserted');
  const past = insertSnippet(docFromText('tail'), { node: 9, offset: 0 }, '!');
  eq([kinds(past.doc), flatten(past.doc)], [['text', 'tint'], 'tail!'], 'a caret past the end appends a tinted run');

  // caretAtGlobalOffset maps a flat character offset to {node, offset}, preferring
  // the next node's start at an exact boundary (so the post-insert caret lands in
  // trailing free text, not on the tint's edge).
  const cad = normalize({ nodes: [text('ab'), tint('cd'), text('ef')] });
  eq(caretAtGlobalOffset(cad, 0), { node: 0, offset: 0 }, 'start of doc');
  eq(caretAtGlobalOffset(cad, 2), { node: 1, offset: 0 }, 'a boundary prefers the next node start');
  eq(caretAtGlobalOffset(cad, 3), { node: 1, offset: 1 }, 'inside the tint');
  eq(caretAtGlobalOffset(cad, 99), { node: 2, offset: 2 }, 'past the end clamps to the last node end');

  // Pure transform: the input is never mutated.
  const before = normalize({ nodes: [text('a'), tint('b')] });
  const snap = JSON.stringify(before);
  insertSnippet(before, { node: 0, offset: 1 }, 'X');
  eq(JSON.stringify(before), snap, 'insertSnippet does not mutate its input');
}

// ── the contenteditable round-trip ───────────────────────────────────────────
// doc → (render) → DOM → readRawNodes → fromRawNodes → doc must be the IDENTITY.
// If it is not, a prompt silently corrupts into something that still looks
// plausible in the box and copies out wrong — the failure mode a code read
// rationalizes past.
console.log('contenteditable round-trip');
{
  /** Simulate the DOM: one raw run per model node — a `tint` node reads back as a
   *  `.tint` span (tint: true), a `text` node as a bare text node (tint: false). */
  const throughDom = (doc) =>
    fromRawNodes(doc.nodes.map((n) => ({ tint: n.kind === 'tint', text: n.text })));

  const roundTrips = (doc, msg) => eq(throughDom(doc).nodes, doc.nodes, `round-trip: ${msg}`);

  roundTrips(emptyDoc(), 'empty doc');
  roundTrips(docFromText('just text'), 'text only');
  roundTrips(docFromText('trailing newline\n'), 'trailing newline survives');
  roundTrips(normalize({ nodes: [tint('BODY')] }), 'a tinted run alone');
  roundTrips(normalize({ nodes: [tint('B'), text(' tail')] }), 'tint at position 0');
  roundTrips(normalize({ nodes: [text('head '), tint('B')] }), 'tint at the very end');
  roundTrips(normalize({ nodes: [text('a '), tint('mid'), text(' z')] }), 'text, tint, text');
  roundTrips(
    normalize({
      nodes: [text('a\n\nb '), tint('Review {lang}\n\n```\nlet x = {size};\n```'), text(' z')],
    }),
    'a tinted body carrying newlines and a fenced block'
  );

  // The browser can split one tint span into two adjacent .tint spans (both keep
  // the class); read back, they merge into one tinted run — provenance and text
  // both preserved.
  const split = fromRawNodes([{ tint: true, text: 'AA' }, { tint: true, text: 'BB' }]);
  eq([kinds(split), flatten(split)], [['tint'], 'AABB'], 'two adjacent tint runs read back as one');

  // Typing right after a tinted run starts a fresh untinted text node (the caret
  // is placed at box level after the span), so the new words are NOT tinted.
  const afterTint = fromRawNodes([{ tint: true, text: 'X' }, { tint: false, text: 'y' }]);
  eq([kinds(afterTint), flatten(afterTint)], [['tint', 'text'], 'Xy'], 'text typed after a tint reads back as free text');

  // A tinted run edited down to nothing simply vanishes (normalize drops empties);
  // the surrounding text is untouched — text is never lost, only the tint flag.
  const emptied = fromRawNodes([{ tint: false, text: 'keep' }, { tint: true, text: '' }]);
  eq([kinds(emptied), flatten(emptied)], [['text'], 'keep'], 'an emptied tint run is dropped');
}

// ── caretQuery ───────────────────────────────────────────────────────────────
console.log('caretQuery');
{
  eq(caretQuery('hello\nreview this', 17), 'review this', 'the current line, up to the caret');
  eq(caretQuery('hello\nreview this', 5), 'hello', 'first line');
  eq(caretQuery('abc', 0), '', 'caret at the start → empty');
  eq(caretQuery(`${'x'.repeat(200)}`, 200).length, 120, 'a very long line is tail-capped');
}

if (failures > 0) {
  console.error(`\nprompts_smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nprompts_smoke: all assertions passed');
