# Study Typing App

A small, hackable typing-practice tool. Pure static HTML/CSS/JS — no build step,
no server, no dependencies to install. Clone it, push it, it's live.

This is an Evolving Crisis module. It stays self-contained and is displayed by
the blog's [Study Typing tab](../../study-typing.markdown) without coupling its
browser state or lesson content to Jekyll.

```
modules/study-typing-app/
├── index.html
├── styles.css
├── app.js
└── lessons/
  index.json              <- manifest: which pack files to load
  punctuation-symbols.json
  programmers-practice.json
```

## Use within Evolving Crisis

The module is served at:

```text
https://evolving-crisis.github.io/modules/study-typing-app/
```

The blog's GitHub Actions workflow publishes it alongside the Jekyll-generated
pages. The blog page at `/study-typing/` displays this module in an iframe.
Keep the module's asset and lesson URLs relative so it remains portable under
this path.

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
  works under the blog's `/modules/study-typing-app/` path. Don't
  introduce an absolute path like `/app.js` or it'll break under a subpath.

## Testing locally before you push

Opening `index.html` by double-clicking it (a `file://` URL) will mostly work,
but `fetch()` calls are blocked under `file://` in most browsers, so the
`lessons/*.json` static packs won't load (the built-in lessons still will — see
below). To see the real thing, serve the folder over HTTP:

```
python3 -m http.server 8000      # run from modules/study-typing-app/
# or
npx serve .
```

## Where lessons come from (three tiers)

**1. Built into `app.js` (`DEFAULT_COURSES`).** Always available, zero network
dependency — this is what renders even under `file://` or if `lessons/` isn't
deployed. Edit the array directly in `app.js` to change these.

Which lesson opens by default is set separately, by `DEFAULT_LESSON_ID` near
the top of `app.js` — currently `'prog-js-basics'`, the first lesson in the
Programmer's Practice pack below. This folder lesson takes precedence over a
remembered lesson, so existing browser storage cannot select an old built-in
lesson instead. If the pack can't be reached it falls back to the remembered
lesson and then the first built-in lesson.

**2. Static packs under `lessons/*.json` — the ones *you* curate.** On load,
`app.js` fetches `lessons/index.json` (an array of filenames) before the
initial lesson and sidebar are rendered, then fetches each file and merges it
in as a course. This is the "static lesson paths"
tier: pure JSON, no code, git-managed, versioned, reviewable in a PR. To add a
pack: drop a new `your-pack.json` (same shape as the two examples) into
`lessons/`, add its filename to `index.json`, commit, push. Every visitor sees
it on their next page load.

Static hosting can't list a folder's contents for you (there's no directory
index), which is why the manifest (`index.json`) exists — it's the only way
the client-side code can know what pack files are there to fetch.

**3. `localStorage` — lessons a *visitor* adds themselves**, via the
"+ New custom lesson" button. These are private to that one browser profile on
that one device. They:

- are **not** visible to you (the site owner) or to any other visitor,
- are **not** synced across the visitor's own devices or browsers,
- persist until the visitor clears site data for your domain.

Every lesson in the drawer can be deleted with its `×` control, including
built-in and curated lesson-pack entries. Deletions are stored in
`localStorage`, so they remain hidden on later visits and are included in
lesson exports.

This is a direct consequence of GitHub Pages being a static host: there's
no server to write a shared lesson to, so "saving" can only ever mean "saving
in this browser." `getAllCourses()` in `app.js` merges all three tiers by
course title for display, so from the visitor's point of view it's seamless —
but only tier 3 is ever specific to them.

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
  (`typingStudio.overrides.v1`): same id, so your best scores and marks stay
  attached, and a ↺ appears beside the lesson in the drawer to restore the original.
  (If you edit it back to the original text the override disappears by itself.) Overrides travel with
  `TypingStudio.exportData()` and the drawer's Export / Import, like marks.

## Getting a visitor's custom lesson back from them

Since there's no backend, there's no automatic way for a visitor's custom
lesson to reach you. Two buttons in the drawer give them (and you) a deliberate
way to move it:

- **Export my lessons** — downloads their `localStorage` lessons as a plain
  `type-studio-lessons.json` file (client-side `Blob` + a temporary
  `<a download>`, no server involved).
- **Import lessons** — reads a `.json` file back in (via `FileReader`) and adds
  its lessons to `localStorage`.

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
the `paused` event (`TypingStudio.on('paused', e => e.detail.reason)`):

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
updated in place each time rather than duplicated). Marks live under
`typingStudio.marks.v1`, travel with `TypingStudio.exportData()` and the
drawer's Export/Import, and fire `markAdded` / `markRemoved`
(`TypingStudio.marks()` returns them). Plain `Enter` and `Tab` are available as
lesson characters, so they are no longer marking shortcuts.

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

Marks and masks live in the same store (`typingStudio.marks.v1`, each with a
`kind`; older marks with no `kind` count as marks) and travel together through
export/import. `TypingStudio.marks()` returns both.

Lesson text preserves internal newlines and tabs. While typing, plain `Enter`
inserts a newline and plain `Tab` inserts a tab. Inline editing accepts both as
well; only whitespace around the outside of a lesson is trimmed.

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

The app has two user-facing modes:

- **Typing mode** — type the lesson. `Enter` and `Tab` are lesson characters.
- **Command mode** — navigate and change the lesson without browser shortcuts.

Press `Esc` while typing, with focus in the practice area, to enter Command
mode. It pauses the clock without hiding the lesson. The Type button has the
same return behavior as `t`: it focuses Typing mode, or leaves Command mode
and resumes the clock. Escape first dismisses an
open dialog, completion card, or lesson drawer, and does not enter Command mode
when focus is on another interactive control. Press `t` to return to Typing
mode, or `i` to enter inline editing.

| keys | does |
|------|------|
| `n` | move to the beginning of the next word |
| `b` | move to the beginning of the previous word |
| `:1234` + `Enter` | jump to zero-based character position 1234 |
| `dw` | delete the current word from the lesson template |
| `Backspace` | delete the previous word from the lesson template |
| `u` | undo the last lesson-template edit, `dw`, or Backspace deletion |
| `r` | redo a lesson-template edit, `dw`, or Backspace deletion |
| `restart` | reset the current typing session to the beginning |
| `mw` | mark or unmark the current word |
| `m` | start or finish a marked passage |
| `M` | mask or unmask the current word |
| `i` | enter full template editing |
| `t` | return to Typing mode |

An open marked or masked passage remains active while using lesson-template
editing commands such as `dw` or `Backspace`; the capture boundary follows the
updated text. Press `i` to edit the lesson without cancelling an open passage:
the passage is hidden while editing, then typing can continue and `m` can close
it when you return to Command mode.

`Enter` and `Tab` remain literal lesson characters in Typing mode. Template
edits are stored as custom lesson changes or per-lesson overrides, and `u`
restores the previous template and cursor position. Template history keeps the
most recent 20 entries and at most 500,000 characters, so repeated edits to a
large lesson cannot grow memory without bound. New edits clear the redo history.
The `r` redo command waits briefly to determine whether it is the beginning of
the `restart` reset command.

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
project already namespaces everything (`typingStudio.customLessons.v1`, etc.),
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
