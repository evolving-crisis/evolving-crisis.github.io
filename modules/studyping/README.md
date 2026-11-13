# Studyping App

A small, hackable typing-practice tool. Pure static HTML/CSS/JS — no build step,
no server, no dependencies to install. Clone it, push it, it's live.

This is an Evolving Crisis module. It stays self-contained and is displayed by
the blog's [Studyping tab](../../studyping.markdown) without coupling its
browser state or lesson content to Jekyll.

```
modules/studyping/
├── index.html
├── favicon.svg
├── styles.css
├── app.js
└── lessons/
  index.json              <- generated manifest of lesson files
  evolving-crisis-code-fr.json
  guia-estudio-devops-unal.txt
```

## Use within Evolving Crisis

The module is served at:

```text
https://evolving-crisis.github.io/modules/studyping/
```

The blog's GitHub Actions workflow publishes it alongside the Jekyll-generated
pages. The blog page at `/studyping/` displays this module in an iframe.
Keep the module's asset and lesson URLs relative so it remains portable under
this path.

The module uses the same Solarized light and dark palette as the Evolving
Crisis theme: `#fdf6e3` / `#002b36` for the main surfaces, with Solarized
accent colors for controls, marks, and feedback. The theme button cycles
through light, dark, and grayscale palettes; grayscale uses contrast and
opaque gray levels to distinguish controls, marks, and typing feedback. On
displays that report a slow update rate, per-keystroke motion becomes a crisp,
stationary stamp on the latest character instead of an animated glyph.

## Standalone hosting

The module can still be copied to any static host. Serve this directory as the
site root; no build step or server-side dependencies are required.

Two gotchas are worth preserving:

- **Jekyll.** The main site uses Jekyll, but the app itself is plain static
  HTML/CSS/JavaScript and is copied to the generated site without a separate
  application build.
- **Base path.** The module is served under a subpath, at
  `https://username.github.io/repo-name/` — not at the domain root. Every path
  in this module is relative (`./styles.css`, `./lessons/index.json`, …), so it
  works under the blog's `/modules/studyping/` path. Don't
  introduce an absolute path like `/app.js` or it'll break under a subpath.

## Testing locally before you push

Opening `index.html` by double-clicking it (a `file://` URL) will mostly work,
but `fetch()` calls are blocked under `file://` in most browsers, so the
static lesson files in `lessons/` won't load (the built-in lessons still will
— see below). To see the real thing, serve the folder over HTTP:

```
python3 -m http.server 8000      # run from modules/studyping/
# or
npx serve .
```

## Global stats in the top bar

The centered top-bar widget summarizes the results saved in `localStorage`
under `studyping.stats.v1`:

- **avg wpm** — mean of each practiced lesson's best WPM,
- **avg acc** — mean of each practiced lesson's best accuracy,
- **runs** — total completed attempts across those lessons.

Only values that actually exist are included. A lesson with no saved speed,
accuracy, or timestamp is skipped rather than counted as zero, and the widget
shows `—` when there is nothing to average. It refreshes when a run is saved,
when stats are imported through `Studyping.importData()`, and when another
tab changes the stats key. `Studyping.getGlobalStats()` returns the same
aggregate as a plain object for custom UI or gamification.

The live stats row compares typing time with reading time. A reading interval
starts when `n` or `b` successfully moves to another word; it ends on the next
non-navigation command, when Command mode ends, or when typing resumes. Idle
Command mode before a navigation and inline editing are excluded. The estimate of typing time left uses the current run's WPM after at least ten
seconds and ten keystrokes, or the saved global average WPM before then.

The global summary and current-session dashboard share the top bar. Session
metrics and lesson progress follow the global stats before the sound, theme,
restart, and type controls; at narrower widths, the dashboard wraps below the
controls. The on-screen keyboard starts collapsed unless a saved preference
says otherwise.

## Where lessons come from (three tiers)

**1. Built into `app.js` (`DEFAULT_COURSES`).** Always available, zero network
dependency — this is what renders even under `file://` or if `lessons/` isn't
deployed. Edit the array directly in `app.js` to change these.

Which lesson opens by default is set separately, by `DEFAULT_LESSON_ID` near
the top of `app.js` — currently `'evolving-crisis-code-intro'`, the first
lesson in the French course below. This folder lesson takes precedence over a
remembered lesson, so existing browser storage cannot select an old built-in
lesson instead. If the pack can't be reached it falls back to the remembered
lesson and then the first built-in lesson.

The current default is `evolving-crisis-code-intro`, the first lesson of the
French `Comprendre Evolving Crisis` course. It explains the module's HTML, CSS,
JavaScript, static lesson packs, persistence, and design trade-offs, with short
code excerpts mixed into the typing practice.

**2. Static lessons under `lessons/` — the ones *you* curate.** On load,
`app.js` fetches `lessons/index.json` (an array of filenames) before the
initial lesson and sidebar are rendered, then fetches each file and merges it
in as a course. JSON lesson packs and Markdown lesson files are supported.
Because Jekyll converts `.md` files into HTML, store raw Markdown lesson
content in a `.txt` file so the app can fetch it unchanged. This is the "static
lesson paths" tier: git-managed, versioned, and reviewable in a PR. To add a
file, place it in `lessons/`. Jekyll generates `index.json` from all `.json`
and `.txt` files in this directory, including `.txt` files with front matter,
so every visitor sees it on their next page load.

Markdown lessons may start with YAML-style front matter to set their course and
sorting metadata:

```yaml
---
id: devops-platform-engineering-unal
title: "Platform Engineering and DevOps"
course: "Programmer's Practice"
courseOrder: 2
order: 1
targetWPM: 30
targetAccuracy: 95
---
```

`courseOrder` sorts the course relative to the others; `order` sorts lessons
within that course. The title can also be taken from the first level-one
heading. The Markdown body is converted to readable practice text: headings,
lists, blockquotes, table separators, and code fences are handled, while inline
formatting is preserved for the typing view. The DevOps guide in this folder
demonstrates the format.

Browsers cannot list a static directory, so Jekyll generates the manifest at
build time. Other static hosts need to provide an equivalent generated
`index.json`.

Static lesson directories may also include a marks JSON file. Any manifest
entry whose object contains a `marks` array is loaded as default marks during
startup, after the selected lesson is loaded. Existing browser marks win when
an id is duplicated, so updating the site cannot overwrite a visitor's marks.

### Ordering lessons and courses

Pack files may define an explicit numeric `order` for the course and for each
lesson:

```json
{
  "course": "JavaScript Basics",
  "order": 10,
  "lessons": [
    { "id": "variables", "title": "Variables", "order": 10, "text": "..." },
    { "id": "functions", "title": "Functions", "order": 20, "text": "..." }
  ]
}
```

The sidebar and **Next lesson** action sort by these values, so a pack can
define a sequential course. Lower values come first; omitted values retain the
existing manifest/file order. The same lesson-level `order` field is supported
by custom lessons and exports. A legacy `courseOrder` value can still define
the initial order supplied by a pack or JavaScript API.

Drag course headings to set their order in this browser. That order is saved
as a sequence of course names and takes precedence over legacy numeric
`courseOrder` values, so a course can be dropped between any two others
without changing numbers manually. The course summary shows completed lessons
out of the total, plus average per-lesson best speed and accuracy. The lesson
menu's **Set lesson order** action continues to set an individual lesson order.
Courses and lessons can also be reordered directly by dragging them in the
drawer. Dropping a lesson changes its order within its current course; dropping
a course changes the saved course sequence. Lesson drags continue to write
stable lesson order values automatically.

**3. `localStorage` — lessons a *visitor* adds themselves**, via the
"+ New custom lesson" button or the + beside a course title (which opens the
same form with that course pre-filled). These are private to that one browser profile on
that one device. They:

- are **not** visible to you (the site owner) or to any other visitor,
- are **not** synced across the visitor's own devices or browsers,
- persist until the visitor clears site data for your domain.

Every lesson in the drawer can be deleted from its three-dot menu, including
built-in and curated lesson-pack entries. Deletions are stored in
`localStorage`, so they remain hidden on later visits and are included in
`Studyping.exportData()`.

This is a direct consequence of GitHub Pages being a static host: there's
no server to write a shared lesson to, so "saving" can only ever mean "saving
in this browser." `getAllCourses()` in `app.js` merges all three tiers by
course title for display, so from the visitor's point of view it's seamless —
but only tier 3 is ever specific to them.

`getAllCourses()` also treats lesson **id** as the identity of a lesson. If the
same id appears more than once — two overlapping pack files (say, an export
dropped into `lessons/` beside the pack it came from), or a repeated import
already sitting in `localStorage` — the drawer renders it exactly once. The
visitor's own custom copy wins over a static pack, a static pack wins over a
built-in lesson, and within the same tier the later source wins (so a newly
appended pack supersedes an older one). This is what keeps the side panel from
showing the same lesson twice after moving exports around.

**Editing a lesson in place (`Esc`, then `i`).** The lesson text becomes
editable *where it is* — no panel, no focus change. Same font, same line breaks,
same green/red; the typing caret simply turns into the editing caret at the
character you were on, and the hidden typing field keeps focus the whole time. The
clock pauses (no veil). When editing is opened from Typing mode, leaving the
editor returns to Typing mode and resumes the clock; when it is opened from
Command mode, it returns to paused Command mode. Everything you'd expect works:
arrows, word jumps, Home/End and Up/Down by *visible* line, select, undo/redo, clipboard
(pasted line breaks
become spaces), click / shift-click / drag / double-click. `Esc` commits the edit and returns to the mode that was active before editing. Typing then resumes on the same character — or, if you changed
something inside what you'd already typed, on the first changed character (and if
you cut everything after the caret, the lesson completes). Marks follow the text,
and open mark/mask spans are cancelled when you start editing.

Where the edit is stored depends on the tier:

- a **tier 3** (custom) lesson is updated in place — same id, so scores stay attached;
- a **tier 1 or 2** (built-in or static-pack) lesson is never modified — those are
  code/git-managed. Your edit is stored as an *override* keyed by lesson id

  (`studyping.overrides.v1`): same id, so your best scores and marks stay
  attached, and a "Restore original" action appears in the lesson's three-dot
  menu.
  (If you edit it back to the original text the override disappears by itself.) Overrides travel with
  `Studyping.exportData()`; they are not part of the drawer's selected-lesson export.

Lesson text supports inline Markdown for strong (`**bold**` or `__bold__`),
emphasis (`*italic*` or `_italic_`), inline code (`` `code` ``), and strike
(`~~deleted~~`). The typing view shows the formatted text without its delimiters,
so `**bold**` is typed as `bold`. In-place edit mode shows the Markdown source,
including its delimiters.

## Getting a visitor's custom lesson back from them

Since there's no backend, there's no automatic way for a visitor's custom
lesson to reach you. Two drawer buttons give them (and you) a deliberate
way to move lessons:

- **Export selected** — downloads the checked lessons as a plain
  `studyping-lessons-N.json` file (client-side `Blob` + a temporary
  `<a download>`, no server involved).
- **Import lessons** — reads a `.json` file back in (via `FileReader`) and adds
  its lessons through the conflict check below.

Importing never silently creates a second row with the same id:

- **Same id, same content** — the incoming lesson is skipped. Re-importing the
  same export is safe.
- **Same id, different content** — a dialog shows the char counts (before →
  after and the delta), which fields changed (text, title, course, targets), and
  a short removed/added excerpt around the first changed character. Choose
  **Update existing** (same id, so stats and marks stay attached), **Keep both
  (new id)** (a second version with a fresh custom id), or **Skip**. Tick
  **Use this choice for the remaining conflicts** to apply it to the rest of
  the file. `Esc` or clicking the scrim skips.
- Built-in and static-pack ids are updated through the same override store as
  an in-place edit, so the original stays restorable from the three-dot menu.

The programmatic path has the same check but no dialog:
`Studyping.importData(json, { conflicts: 'skip' | 'update' | 'new' })`.
The default is `'skip'`; identical lessons are always skipped. Lesson packs in
`lessons/` are static and do not go through this dialog — overlapping ids there
are deduplicated at render time as described above.

Marked passages are moved separately, through **Marks & masks** in the drawer:

- **Export marks** — downloads all marks and masks as
  `studyping-marks-N.json`, with a distinct `"format": "studyping-marks.v1"`
  payload.
- **Import marks** — reads that file back and merges its marks and masks into
  the local store. It does not import lessons.

Lesson exports no longer bundle marks. Lesson imports still accept older
`{ lessons, marks }` files, but they only add the lessons and tell you to use
**Import marks** for the marks in that same file.

A visitor who wants to contribute a lesson can export it and send it to you
however's easiest — email, paste into a GitHub issue, or open a PR
themselves adding it as a new file under `lessons/`. You decide if/when to fold
it into a static pack. This keeps the whole thing zero-infrastructure.

### If you ever want automatic capture instead

That requires something beyond what GitHub Pages themselves can do,
since they can't run server code or write back to your repo on their own.
Options, roughly in order of effort:

- **A form-backend service** (Formspree, Netlify Forms–style, Google Forms) —
  point a plain HTML form at their endpoint; no server code of your own.
- **A small serverless function** (Cloudflare Worker, a Supabase/Firebase
  project) that your page `fetch()`s with `POST`. The function holds any
  secret/token server-side and does whatever you want with the submission
  (store it, open a GitHub issue via the GitHub API, email it to you). The
  function must allow CORS from your Pages origin.
- **Never put a GitHub access token in client-side code.** Anything in
  `app.js` is public, by definition, the moment it's deployed. If you want
  "visitor submission → GitHub issue" automatically, the token has to live in
  that serverless function, not in this repo.

All of these are genuinely separate services sitting *in front of* or *beside*
your Pages site — Pages itself stays exactly what it is, a static file host.

## Typing, pause, and auto-pause

The practice area is a small state machine (`App.state` in `app.js`):

```
idle  --type / any key-->  ready  --first keystroke-->  running  <-->  paused
                                                           |
                                                       finished
```

- **idle** — the text is veiled on the first visit to each lesson in a browser
  session. Press Type (or any key) to reveal it; that first key is swallowed,
  not typed into text you can't see yet.
- **ready** — text revealed, "Start typing" pill showing, clock *not* running.
  The timer starts on your first real keystroke. "Try again", "Next lesson" and
  saving an edit skip the veil and land here directly.
- **paused** — the clock is stopped and the veil returns (outside the scrolling
  text box, so it's visible however far down a long lesson you are). When the
  pause belongs to Command mode, the paused state is kept but the lesson stays
  visible for navigation and editing.
  The lesson visit record is kept in `sessionStorage`, so revisiting a lesson
  during the same browser session does not show the first-visit veil again.

**What pauses it automatically**, with the reason shown on the veil and sent in
the `paused` event (`Studyping.on('paused', e => e.detail.reason)`):

| reason   | trigger |
|----------|---------|
| `hidden` | tab switched / minimized (`visibilitychange`, `pagehide`) |
| `window` | the window lost focus: alt-tab, another app, devtools, or the page hosting an embed |
| `blur`   | the typing field lost focus (clicked elsewhere on the page) |
| `idle`   | no keystroke for `IDLE_PAUSE_MS` (default 30 s; `0` disables) |

Two details worth knowing. Time away is **excluded from the clock** (and from
checkpoint speeds); the idle pause is back-dated to your last keystroke so the
30 s of silence never counts against your WPM. And **resuming is always
explicit** — a click on the veil, the Type button, or any key — so returning to
the tab never restarts the clock under your hands. The key that wakes it is
swallowed rather than typed.

An unfinished lesson keeps its cursor position in the browser's local storage.
Leaving the page, switching lessons, or closing the tab therefore lets you
return to the same character later. Completing a lesson or choosing
**Try again** clears its saved position and starts it from the beginning.

## Marking passages (your digest)

While you type, keep what's worth keeping without breaking flow:

| keys | does |
|------|------|
| Command mode `mw` | mark or unmark the current word |
| Command mode `m`, then `t`, then `Esc` and `m` | start and finish a marked passage |
| Command mode `M` | mask or unmask the current word |

A mark is drawn as a rounded orchid underline with a faint wash. It sits *on top
of* the green/red feedback instead of replacing it, and it comes back whenever
you open that lesson — even after you've edited the text, since marks are
relocated by content. A mark still open when you finish the last character
closes there.

"Marks & masks" in the drawer is the digest: copy one or all of them, remove
any, or **Practice these** (marks only) to turn them into a lesson ("My marked passages",
updated in place each time rather than duplicated). **Export marks** and
**Import marks** move the whole digest through its own JSON file, separately
from lessons. Marks live under `studyping.marks.v1`, also travel with
`Studyping.exportData()`, and fire `markAdded` / `markRemoved`
(`Studyping.marks()` returns them). Plain `Enter` and `Tab` are available as
lesson characters, so they are no longer marking shortcuts.

## Figures attached to marked passages (floating deck)

A mark can carry one or more figures, so a passage like "en la figura se
muestra la anatomía de un platelminto en un corte transversal" can show its
plate while you type it.

1. Mark the passage in Command mode (`m … m`) and open **Marks & masks**.
2. Use **Add figure** on that mark.
3. Paste an image URL (absolute, or relative to the module such as
   `figures/plate-01.png`) or choose an image file. Captions and alt text are
   optional. Uploads become `data:image/…` URLs in this browser (1.5 MB limit).
4. Add more figures to the same mark to make a little deck.

While typing, a sufficiently detailed figure **interchanges places with the
typing stage** for as long as the caret is inside the marked range. The figure
(with previous/next buttons, counter and caption) fills the main view; the live
typing stage moves into a picture-in-picture card in the bottom-right corner.
Small images stay in that floating card because enlarging them would not add
detail. The main-stage swap is deliberately slow and smooth so the change is
easy to follow. Leaving the marked range smoothly swaps everything back.
**Figure deck: on/off** in the drawer turns the whole feature off without
deleting anything; the choice is remembered.

Figures are stored on the mark itself, as a `media` array:

```json
{
  "src": "figures/plate-01.png",
  "alt": "Transverse section of a flatworm",
  "caption": "Corte transversal"
}
```

That means they travel with **Export marks** / **Import marks** and with
`Studyping.exportData()`, follow the mark when the lesson text is edited, and
are returned by `Studyping.marks()`. Masks do not show figures (that would
leak the text you are trying to recall); only `kind: "mark"` entries are used.
The deck is hidden while the lesson is idle, during inline editing, and after a
lesson is completed.

A mark with at least one figure is a **figure anchor**, not a digest mark: it is
not drawn with the orchid underline and it is excluded from **Practice these**.
It still appears in **Marks & masks** with a `figure` chip so you can edit,
remove, or add more figures. Removing every figure turns it back into a normal
highlighted/digest mark. Marks without figures keep their underline and are the
ones used for the reinforcement-learning digest.

## Masks: type it from memory (and using both shortcuts together)

Marks keep a passage; **masks hide it**, so next time you have to produce it
from memory. The two are separate command families and can be open **at the same time** and
closed in either order:

| keys | does |
|------|------|
| Command mode `mw` | **mark or unmark** the current word |
| Command mode `M` | **mask or unmask** the current word |

A mask made while you type is already typed, so it shows as a dotted underline
and takes effect **from the next run** (Try again, or next time you open the
lesson). From then on it's covered by tape: the glyphs are hidden but the tape
keeps their width, so you still know how long the word is.

- Type a letter right and it's revealed in green. Type it wrong and the tape
  flashes red **without** revealing the answer (and the falling-letter animation
  and the on-screen keyboard hint are both suppressed on masked letters, so
  neither leaks it).
- Miss the same letter twice and a faint hint shows through the tape.
- On completion you get a recall line — "From memory: 2 of 3 masked passages
  without a slip" — and each mask keeps its record (`attempts`, `clean`) for
  whatever gamification you build on top; `lessonComplete` carries
  `detail.recall = { total, clean }`.
- The mask icon can un-mask a masked passage once you know it. "Hide masked
  passages" in the drawer turns masking off without deleting anything.

Marks and masks live in the same store (`studyping.marks.v1`, each with a
`kind`; older marks with no `kind` count as marks) and travel together through
**Export marks** / **Import marks**. `Studyping.marks()` returns both.

Lesson text preserves internal newlines and tabs. While typing, plain `Enter`
inserts a newline and plain `Tab` inserts a tab. Inline editing accepts both as
well; only whitespace around the outside of a lesson is trimmed. In the
practice display, each space has a small cornered underline and each tab has
the same boundary plus its arrow marker, making consecutive spaces and tabs
easy to count before typing.

Every lesson has the same drawer controls: select it for export and open the
three-dot menu to rename it, assign it to another course, restore an overridden
copy, or delete it. The three-dot control has a larger click target for easier
use. Lesson names wrap onto multiple lines instead of being
elided, so long titles stay distinguishable. The **Shortcuts** section can be
collapsed from its chevron (the choice is remembered), which hands the whole
drawer height to the course list.
The course chevron sits before the title, and clicking a course heading
collapses or expands it. Use the course menu to add a lesson with that course
pre-filled, rename or delete the course and all its lessons, or
select/unselect the course's lessons for export. The
**Select all** drawer control becomes **Unselect all** when every lesson is
selected. Collapsed courses are
remembered in this browser. Courses start collapsed by default, while the
course containing the resumed lesson opens automatically.
Lesson content remains editable in the typing area. Changes to built-in and
static-pack lesson names/courses are saved as local metadata overrides; their
source content remains unchanged. Select any lessons with their checkboxes and
choose **Export selected** to download only those lessons, including the latest
saved local edits (and any inline edit currently in progress). Hiding the
on-screen keyboard smoothly collapses it to give the typing area more room.
Marks and masks use their own **Export marks** / **Import marks** controls in
"Marks & masks".

## Typing and command modes

The header keeps Sound, Theme, Restart, and Type/Pause controls available in all
modes. Editing, marking, and masking are intentionally Command-mode-only; use
`Esc`, then `i`, `mw`, `m`, or `M`. `Esc` automatically pauses when entering
Command mode; the Type/Pause button has the same behavior as `Esc` while
typing and `t` while in Command mode. Restart resets the lesson normally.

The header includes an **Esc commands** switch, enabled by default. When it is
on, `Esc` enters Command mode and handles the app's Escape actions. Turn it off
to leave `Esc` to the browser and assistive technology; the switch itself is
keyboard-operable and exposes its state as an accessible `switch` control.
When enabled, Escape is intercepted during key capture, including when the
switch itself has focus, so browser-native focus behavior cannot prevent the
app from handling it. Other interactive controls retain their normal Escape
behavior.

The app has two user-facing modes:

- **Typing mode** — type the lesson. `Enter` and `Tab` are lesson characters.
- **Command mode** — navigate and change the lesson without browser shortcuts.

Press `Esc` while typing, with focus in the practice area or on the Esc
commands switch, to enter Command mode. It pauses the clock without hiding the
lesson. The Type button has the same return behavior as `t`: it focuses Typing
mode, or leaves Command mode and resumes the clock. Escape first dismisses an
open dialog, completion card, or lesson drawer, and does not enter Command mode
when focus is on another interactive control. Press `t` to return to Typing
mode, or `i` to enter inline editing.

| keys | does |
|------|------|
| `n` | move to the beginning of the next word |
| `b` | move to the beginning of the previous word |
| `N` / `B` | skip the next/previous word and queue it for deletion, shown in red |
| `dw` | immediately delete the current word from the lesson template |
| `D` | delete all queued ranges from the lesson template |
| `Esc` | same as `t`: return to Typing mode without changing queued ranges |
| `q` | clear queued deletion ranges without deleting them |
| `:1234` + `Enter` | jump to zero-based character position 1234 |
| `cw` | change the current word: immediately delete it, then edit in its place |
| `x` | delete the character at the caret |
| `Backspace` | delete the previous word from the lesson template |
| `u` | undo the last lesson-template edit or confirmed deletion |
| `r` | redo a lesson-template edit or confirmed deletion |
| `restart` | reset the current typing session to the beginning |
| `:mute` / `:unmute` | turn typing sounds off / on |
| `:radio off` / `:radio on` | stop / start Radio Chaito in the site header |
| `mw` | mark or unmark the current word |
| `m` | start or finish a marked passage |
| `M` | mask or unmask the current word |
| `i` | enter full template editing |
| `t` | return to Typing mode |

Queued deletion ranges stay visibly marked while you return to Typing mode with
`t` and continue elsewhere in the lesson. Re-enter Command mode to queue more
words, press `D` to remove every marked range as one undoable edit, or press
`q` to clear the queue. `Esc` behaves like `t`: it returns to Typing mode while
keeping the queued ranges unchanged. Undoing a `D` commit restores both the text
and its queued deletion marks.
Other edits keep queued marks on unchanged text and drop only the portions
directly changed by the edit. An open marked or masked passage remains active while
using lesson-template editing commands such as `x`, `dw`, `cw`, or `Backspace`; the
capture boundary follows the updated text. Press `i` to edit the lesson without cancelling an open passage:
the passage is hidden while editing, then typing can continue and `m` can close
it when you return to Command mode.

`Enter` and `Tab` remain literal lesson characters in Typing mode. Template
edits are stored as custom lesson changes or per-lesson overrides, and `u`
restores the previous template and cursor position. Template history keeps the
most recent 20 entries and at most 500,000 characters, so repeated edits to a
large lesson cannot grow memory without bound. New edits clear the redo history.
The `r` redo command waits briefly to determine whether it is the beginning of
the `restart` reset command.
Enter a colon command in Command mode and press `Enter` to run it. Radio
commands are available when Studyping is embedded on the Evolving Crisis site.

## Accents and dead keys

Typing `mamá` on a layout with a dead acute (`´` then `a`) used to flash the `á`
red and then turn it green. The typing field now treats a lone pending accent
inside an open composition as *undecided*: the letter gets a neutral brass
"pending" mark and the on-screen keyboard moves its hint from the dead key to
the vowel; the verdict comes once the vowel (or a non-matching key) arrives.
Everything is normalized to NFC (lesson text and typed input), so a pasted
decomposed `a` + combining acute counts as one `á`. Mobile keyboards that
compose whole words still get live per-character feedback — only bare accents
are held back.

## One `localStorage` subtlety worth knowing

`localStorage` is scoped by **origin** (scheme + host + port) — not by path.
If you host several projects under the same GitHub username
(`username.github.io/project-a/`, `username.github.io/project-b/`), they all
share the *same* origin (`https://username.github.io`) and therefore the same
`localStorage` bucket. Two unrelated projects under the same username could in
principle read each other's keys if they used overlapping key names. This
project already namespaces everything (`studyping.customLessons.v1`, etc.),
which avoids collisions in practice — just worth knowing if you fork this
into a second project under the same username.

(A repo literally named `username.github.io` — a user/org *root* page — doesn't
have this issue, since there's only one such site per account.)

## None of the Claude-artifact sandbox limits apply here

If you've been iterating on this inside a Claude.ai artifact preview, that
preview runs under a content-security policy that blocks most outbound
`fetch()` calls and swaps `localStorage` for a different storage API. Once
this is deployed on GitHub Pages it's a completely ordinary website —
none of that applies. `fetch()`, `localStorage`, `AudioContext`, the Web
Animations API all behave exactly as documented, with no extra restrictions
beyond what any static site has (no server-side code, described above).
