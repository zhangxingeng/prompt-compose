# Prompt Compose — Interaction Contract

What the user *does*, and what happens back — scenario by scenario. The sibling to the
[engineering contract](prompts-design.md), which says what the system *is* (storage, command
surface, grammar, match engine, the compose model). Behavior questions belong here; seam shapes
belong there.

**Amend this doc first when an interaction changes.** A behavior that lives only in the code is a
behavior nobody agreed to.

The bar this product is held to: **the founder can open the app after two weeks away and still know
how everything works, without reading anything.** An earlier design failed that test — nine UI
surfaces and ~15 affordances, several of them unguessable without having read a contract. Every rule
below is chosen so a user can *infer* what a key does in a situation this doc never enumerated. When
you add an affordance, that is the test it has to pass.

---

## Conventions — the rules every scenario inherits

- **Enter accepts. Escape cancels the innermost open thing.** In the popup, Escape closes and
  returns you to the box; in the project manager, Escape closes.
- **The compose box is the one deliberate exception: Enter is a newline**, because you are writing
  prose and a multi-line prompt is the primary use. The match panel earns Enter only *after* you
  have explicitly stepped into it — see [S3](#s3-search-by-typing-arrow-in-enter-inserts).
- **The box is the only place you type a prompt. The popup is the only place you edit a snippet.**
  Those two sentences are the whole interaction model.
- **Toasts are transient — 5 seconds, or click to dismiss.** Nothing durable hides in one, so losing
  one costs nothing.
- **Exactly one notice waits for you, and it is not a toast:** the update banner
  ([S11](#s11-an-update-is-available--told-once-reachable-forever)). Anything the user must act on
  *later* needs a surface that survives being missed, which is the one thing a toast is built not to
  be — so it gets its own component and its own permanent channel in the footer.
- **Nothing the app does deletes a file you did not ask it to delete.** Removing a project forgets a
  path and never touches files; the app has no in-app snippet-delete at all — a snippet is a `.md`
  file you delete yourself, in your file manager.

---

## The surface at rest

Top to bottom: the **project tab row** (one tab per folder, plus a `⋯` manager), then two columns —
the **library panel** on the left (collapsible with `⟨`; a `⟩ Library` peek button brings it back)
and the **compose box** on the right. The library panel's `+` button creates a snippet. Under the
box, the **variable fill list** appears whenever the composed prompt contains variables. Two
situational buttons sit inside the box, only when it has content (top-right): `Clear prompt`, which
empties the box in one click — no confirm — and `Copy prompt`.

**There is no Global tab, and its absence is the point.** A snippet lives in the folder it sits in,
so a scope belonging to no folder cannot exist. There is no settings gear and no pinned/promoted tab
either — every project is simply a tab. A project carries a name, a folder, and an optional color
(right-click a tab), and nothing else.

---

## S1. First launch — there is no library until you point at a folder

- **What you see.** No tabs. The library panel says: *No prompt folder yet. Add one with `⋯` above —
  pick any directory and every `.md` file in it becomes a snippet.*
- **What you do.** `⋯` → `+ Add a folder…` → the OS directory picker. The folder's own basename
  becomes the project name (you already named it once when you made it); rename it later in the
  manager if you like. **Right-clicking `+` opens a type-a-path input instead** — the escape hatch
  for hidden folders (a repo-local `.prompt_snippets/`, say), which OS pickers refuse to show, so
  the picker alone would make such a library impossible to add. Enter adds, Esc cancels.
- **Result.** The folder is registered and becomes the active tab — you added it to work in it, so
  the manager closes and gets out of the way. Every `*.md` under it, recursively, is now a snippet.

Trying to save a snippet with no folder configured toasts *"Add a prompt folder first — ⋯ above the
compose box."* rather than failing quietly.

## S2. Type a prompt, copy it

- **Keys.** Type in the box. `Copy prompt`, or `Ctrl/Cmd+C` with nothing selected.
- **Result.** The composed prompt — exactly the text in the box, tinted runs and free text alike —
  goes through the copy pipeline (escapes resolved, every variable hoisted into an appended
  `<prompt_vars>` block) and onto the clipboard. A toast confirms.

## S3. Search by typing, arrow in, Enter inserts

Each line you type is a live query. The library panel **filters down**: at rest it already lists
every snippet in the project, most-recently-used first, and typing narrows it. You never have to
type to make your own library appear.

- **Keys, in order.**
  1. Type a line — `senior review`. The panel narrows to matches, ranked.
  2. `↓` **steps focus into the panel**, highlighting the first hit.
  3. `↑`/`↓` move the highlight. `Enter` inserts. `Esc` (or `↑` past the first hit) returns focus to
     the box, leaving your typed line intact.
- **Result of insert.** The snippet's whole body lands as **editable tinted text** that *replaces the
  query line* — the text from the line start to the caret. The tint marks it as coming from the
  library; it is otherwise ordinary text you edit freely. The caret sits just after the inserted
  text; focus is back in the box; the snippet's variables merge into the fill list. The insert is
  also what records "recently used", which is what makes the panel open on the things you actually
  reach for.

**Two rules that are really one decision — change either and you must change both.**

`↓` steps into the panel **only when the caret sits at the very end of the text** (and the panel has
a hit to land on). That is the one position where `↓` is natively inert in a text box; anywhere else
it moves the caret, as a user editing line 3 of a 10-line prompt rightly expects. And `Enter` inserts
**only after** that explicit step — the first hit is never pre-armed while the caret is still in the
box.

Why they are one decision: the query is the *whole current line*, so an insert that replaces the
query line also deletes whatever prose shares that line. That is safe only because the user opted in
by stepping into the panel. Pre-arm the first hit and a stray `Enter` at the end of an ordinary
sentence swallows the sentence. If the pre-arm rule is ever overruled, insert must go back to
appending at the caret rather than replacing.

Mid-document insert stays a mouse click — a known and accepted gap, because composing happens at the
end.

## S4. Insert with the mouse

Click a hit. Identical result to [S3](#s3-search-by-typing-arrow-in-enter-inserts): the query line is
replaced by the inserted tinted text, the caret lands after it, focus returns to the box. **One
insert path, two triggers.**

Panel rows show the snippet's **name and nothing else**. The name is a path (`rust/code_review`), so
it already carries the folder grouping that replaced tags — and since the panel lists the *whole*
library at rest, a body preview per row would make it unscannable rather than informative.

## S5. An inserted snippet is editable tinted text

An inserted snippet is its **whole body**, dropped into the box as ordinary editable text and
**tinted** to show it came from the library. That is the entire model — there is no chip, no atom, no
popup, and no hidden link back to the library file.

- **It is just text.** Edit it, delete part of it, type into the middle of it — exactly as you would
  any other text in the box. The tint is a highlight, not a control.
- **Editing it changes nothing on disk.** Once inserted, the text has no link back to the file it
  came from, so tweaking it for this one prompt cannot touch your library. That is the point: the
  chip model kept composed text linked to a library file and the two could silently diverge; with no
  link, there is nothing to diverge.
- **The library is written only by Save-as-snippet** ([S6](#s6-save-as-snippet--the-one-library-writer)),
  never as a side effect of editing composed text.

This replaced a **chip** model (a small non-editable button you clicked to open a popup), which had
itself replaced an even earlier span model. The reasoning behind each step is in the engineering
contract's [compose model](prompts-design.md#the-compose-model--inserted-snippets-are-tinted-text) —
read it before you consider re-linking composed text to library files.

## S6. Save as snippet — the one library writer

The library panel's **`+`** button opens the snippet popup — the one explicit action that writes to
the library, and the only in-app way a snippet is created.

Fields: **Name**, **Content**, and fill inputs for the variables that content uses. Focus lands in
the name — naming the snippet is the first thing to do.

| Action | Effect |
|---|---|
| **Save** | Writes `<name>.md` to the active project folder. **Same name → overwrites. New name → a new snippet.** The filename *is* the identity, which is the whole of "Save vs Save as new" — one button, disambiguated by the name field. |
| **Cancel** / `Esc` | Nothing changes. |

A `/` in the name makes a folder, and that is the entire organization system — no tags, no UI.

**Editing or deleting an existing snippet is not an in-app action.** A snippet is a `.md` file whose
filename is its name, so you edit it in your editor and delete it in your file manager — the same
place you would `mkdir` a folder to group prompts. The app deliberately does only two things with the
library: *create* one here, and *insert* one into a prompt. (This is a consequence of dropping the
chip's click-to-edit popup; if living without an in-app editor turns out to hurt, a library-row edit
affordance is the thing to add — that is the founder's call.)

The popup's variable fills are the **same global cells** as the list under the box — it just shows
the subset this body uses. That is not a second place to edit: a variable is one value by name, and
showing one cell in two views is convenience.

## S7. Fill variables

A body like `Review {ticket} for {task}` exposes a row per distinct variable under the box — one row
per name across the **whole** composed prompt (typed text and every tinted run), in first-appearance
order.

- **A row is:** the name and a fill input.
- **One name is one value, everywhere.** Two occurrences of `{language}` share a single cell. The
  model cannot tell two identically-named variables apart, so pretending they differ would be a
  fiction the UI maintains and the output discards.
- **Leave one unfilled and the prompt still works.** The input's placeholder is the literal text it
  will copy out as — `variable not set, ask user for it` — so the model asks instead of silently
  receiving a blank or a stray `{placeholder}`. There is no way to fill a variable with the empty
  string: to say nothing, delete the `{name}`.
- **Every variable is hoisted on copy.** Each occurrence copies as `<prompt_var name="x"/>` and the
  value lands once in an appended `<prompt_vars>` block — state a long value once, reference it
  inline. (Round 1 had a per-variable `as var` toggle; it was cut — a control nobody flipped.)

**Variables are a Python format string** — `{name}` everywhere, `{{`/`}}` to escape, no carve-out for
code fences or backticks. A `{name}` inside a fenced code block *is* a variable, and you will see it:
the fill list lists it, so you escape it `{{name}}` exactly as you would in Python. The reasoning
behind refusing the carve-out is in the
[engineering contract](prompts-design.md#there-is-no-markdown-awareness-do-not-add-any) — read it
before "fixing" this.

## S8. Copy — the button and the hotkey

- `Copy prompt`, or `Ctrl/Cmd+C`.
- **`Ctrl/Cmd+C` is selection-aware, and this is the load-bearing edge.** If *anything* is selected
  where focus actually is — text in the box, text in a fill input, anywhere — the native
  copy-selection wins and we do not touch it. Hijacking the most reflexive shortcut on the keyboard
  is user-hostile. With nothing selected anywhere, `Ctrl/Cmd+C` copies the full composed prompt: that
  is dead key-space natively (there is nothing to copy), so we fill it without a fight.

## S9. Switch projects

Click a tab. The library panel and the match pool switch to that folder's snippets; your draft in the
box is untouched.

**There is no scope to choose.** A snippet lives in the folder it sits in, so "which project does
this save to?" has exactly one answer: the active one. Cross-project reference still works —
inserted snippets are plain text in your draft, so switching tabs cannot reach into it.

Tabs are plain `Tab`-stop buttons, deliberately **not** a roving-tabindex tablist. The roving version
was one of the affordances nobody could guess without having read the contract, and a handful of tabs
does not need its own navigation model.

## S10. Manage folders

`⋯` opens the manager: every project as a row with its **path always visible** (a name alone cannot
tell two folders apart, and "which folder is this?" must never need a hover).

- **Add** — `+ Add a folder…`, OS directory picker; right-click `+` to type a path instead
  (hidden folders never appear in the picker).
- **Rename** — type in the row's name field. The path is the identity, so a rename is just that; it
  does not switch you to that project.
- **Remove** — two-step, and the confirm label states the consequence *before* the click rather than
  leaving it to be discovered after: `Remove` → **`Forget it? (files stay)`**. It drops the path from
  the roster. **It never deletes files.** Re-adding the folder restores the project intact. Removing
  the active project falls back to another, because a roster with no selection is a state the UI has
  no way to leave.

`Esc` or click-away closes. Focus is trapped inside while it is open — a product you can drive from
the keyboard is not actually operable if `Tab` walks focus behind an open dialog.

## S11. An update is available — told once, reachable forever

The app checks GitHub for a newer signed build on launch, silently. (It is one of only two things
the app ever fetches, and it never sends — the [engineering contract](prompts-design.md#the-updater--and-the-whole-network-surface)
states the network surface exactly.)

- **What you see.** A small banner in the **bottom-right** — *Update available — v0.2.0* — with
  `Update & restart` and an `×`. It never steals focus, never covers the compose box, and never
  waits for an answer. It sits clear of the toast stack (bottom-center) on purpose: two notices that
  share coordinates stack on top of each other.
- **What you do.** Ignore it, `×` it, or take it. All three are fine, and **all three have the same
  consequence for this version: you are never auto-shown it again.**
- **Result of `Update & restart`.** The download replaces the banner with a progress bar, then the
  app relaunches into the new build. **This discards the draft in your compose box**, which is why
  the restart is never a side effect of a single click — the button says what it does before you
  press it, the same way the project manager's `Remove` → `Forget it? (files stay)` does.

**The banner tells you once; the footer always knows.** A given version raises the banner **at most
once per install, ever**, and the version is recorded the moment the banner *renders* — not when you
click something. That is the whole of "it never nags", and the reasoning is the load-bearing part:
**ignoring a notice is a decision, and it is the most common one.** Remember only explicit
dismissals and you re-nag, on every single launch, exactly the user who already told you — by not
clicking — that they were not interested.

Recording on render would strand a user who blinked, so the **footer is the permanent quiet
channel**. It never moves, blinks, or asks:

| Footer reads | When |
|---|---|
| `Check for updates` | nothing pending — a manual check, which this app otherwise has no way to ask for |
| `Update to v0.2.0` | an update is pending, whether the banner was seen, missed, or `×`'d |

Clicking `Update to v0.2.0` **brings the banner back** rather than installing — see the draft above.

| Trigger | Seen before? | Result |
|---|---|---|
| Launch (silent) | no | banner appears; recorded as seen immediately |
| Launch (silent) | yes | nothing at all; the footer reads `Update to vX` |
| Footer click (manual) | either | banner appears: `Checking…` → available / up to date / the error |
| `×` | — | closes now; already recorded, so it will not be back on its own |

**A manual check always surfaces the banner, even for a version you have already seen.** You asked;
an explicit action must never be silently swallowed. Only the launch check is allowed to stay quiet.

**There is no "check for updates on launch" toggle, and it would protect against nothing.** The
launch check is silent unless it has something to say, and a version it has said once it never says
again — so the toggle's only real job would be suppressing a nag that cannot happen. Quiet unless
actionable is this app's tone throughout: the embedding model downloads the same way, with no toggle
and no progress UI. The `checking` / `up to date` / error notices auto-hide after 4 seconds because
they answer a question you just asked; `Update available` never auto-hides, because it is the one
thing here you might actually want to act on, and the `×` is right there.

---

## Popovers, focus trap, and Escape

Two surfaces open over the view: the **snippet popup** (centered, modal) and the **project manager**
(under the tab row, with a click-away backdrop). Both behave the same way, and `src/lib/attachments/focusTrap.ts`
is the one implementation.

- **Focus moves in on open**, to the field you came for: the snippet popup's name field, or the
  manager's first control.
- **`Tab`/`Shift+Tab` cycle within** and never escape to the page behind.
- **`Esc` or click-away closes**, and **focus returns to whatever held it before** — the `⋯` button,
  the `+` button, the caret in the box. You should never lose two contexts to one keypress.
- **The view's hotkeys disarm** while either is open, so a keystroke meant for a text field can never
  fire a command.

The trap is a **requirement, not polish**: a product you can drive from the keyboard is not actually
operable if `Tab` silently walks focus behind an open dialog.

---

## Hotkey map — one command, fixed

Armed on the Prompts view, disarmed while the popup or the manager owns the keyboard. `Mod` is `Ctrl`
on Windows/Linux, `Cmd` on macOS.

| Action | Key | Note |
|---|---|---|
| Copy the composed prompt | `Mod+C` | Selection-aware — native copy wins whenever anything is selected ([S8](#s8-copy--the-button-and-the-hotkey)). |
| Step into the match panel | `↓` at the very end of the text | Spatial key, not a command. |
| Insert the highlighted snippet | `Enter` (in the panel) | Context key, not a command. |
| Close the innermost thing | `Esc` | Universal. |

**Rebinding was cut, and should stay cut.** Nobody ever rebound anything; the capture/conflict UI
cost ~410 lines to defend a capability with no users. The one chord, carrying `Mod` by construction,
needs no configuration surface — and the spatial keys (`↓`/`Enter`/`Esc`) were never rebindable
anyway, because rebinding them would break the conventions the rest of the design lets you infer.
(`Ctrl/Cmd+S`, the old save-as-snippet chord, was cut along with the compose-box save button —
creating a snippet is the library's `+`, and `S` reverts to the browser's own binding.)

---

## What was removed, and why it stays removed

An earlier design was cut down to this one by **subtraction**. Each of these was built, shipped, and
cut — so the next agent does not helpfully rebuild one:

| Cut | Why |
|---|---|
| **The Global tab / snippet `scope`** | The folder is the project. A scope belonging to no folder cannot exist; keeping it would be the old design wearing new labels. |
| **The chip and its click-to-edit popup** (and the `linked-modified` state) | The chip existed to make an inserted snippet non-editable, to stop composed text and a library file from silently diverging. Phase 3 found the real culprit was the *link*, not the editing: an inserted snippet is now plain tinted text you edit freely, with no link back to any file, so there is nothing to diverge. Save-as-snippet (`+`) is the only library writer. |
| **`Original` preview, `Update` vs `Save as new`** | The name field already decides update-vs-create: same name overwrites, a new name creates. A second button could only add ambiguity. |
| **Version history / `versions[]`** | If you want to keep the old one, save under a new name — more obvious, and a user's choice. And if the folder is a git repo, git already does this incomparably better. |
| **`keywords` / `tags` / `category`, and the browse-by-tag panel** | Never used, never surfaced. Search matches name + content; **subfolders replaced them**. |
| **The embeddings UI** — enable toggle, progress bars, `Download & index` | The engine stays and now runs silently in the background. Lexical match works immediately and unconditionally, so a failed download degrades to lexical with nothing for the user to see or decide. |
| **Hotkey rebinding, the Shortcuts section** | See above. |
| **Notices, the auto-repair notice, the config gear popover** | All of it existed to defend a JSON schema that no longer exists. A `.md` file cannot fail to parse. The update banner (S11) is not a reversal of this: those notices narrated the app's own repair work — something the user neither caused nor could act on — whereas an update is real, actionable, and raised once and never again. If you are adding a notice, that is the test it has to pass. |
| **Pin/unpin, the promoted tab** | A handful of tabs needs no hierarchy; every project is simply a tab. |
| **Roving-tabindex project tabs** | Unguessable without the contract; a handful of tabs needs no navigation model. |

If you are about to add one back, the question to answer first is not "would this be useful?" but
"can a user who has read nothing guess it exists?"

**One came back, and it is not on the list above: project colors.** Round 1 cut them as "nothing to
decorate"; round 2 restored them (right-click a tab) once several projects were on screen at once and
color turned out to be how you tell which library you are in at a glance — a signal, not decoration.
Recorded here so the cut is not re-applied out of loyalty to a table: the test above is the whole
rule, and colors pass it now for a reason they did not pass it then.
