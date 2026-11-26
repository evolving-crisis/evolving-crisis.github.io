# Pomoudying

Pomoudying is a static typing-practice app: HTML, CSS, JavaScript, and lesson
files, with no application build or server-side code. It lives in the Evolving
Crisis repository as a self-contained module and is shown by the site's
[Pomoudying page](../../pomoudying.markdown).

The app has grown beyond a typing field: it now includes saved progress,
lesson editing and import/export, command-mode navigation, marks and masks,
figures, and session statistics. This guide describes how those parts fit
together and how to add content without coupling it to the app internals.

## Run and publish

Serve this directory over HTTP while developing:

```sh
cd modules/pomoudying
python3 -m http.server 8000
```

Then open `http://localhost:8000/`. Opening `index.html` as a `file://` URL is
not a reliable test: browsers generally block the `fetch()` requests needed to
load the lesson manifest and packs.

The Evolving Crisis site publishes the module at
`/modules/pomoudying/` and embeds it on `/pomoudying/`. Keep asset and lesson
paths relative (`./styles.css`, `lessons/index.json`, and so on) so the app
works beneath that subpath. Jekyll publishes the static files; it does not
build the app itself. To host the module elsewhere, serve this directory as
the site root and provide a `lessons/index.json` manifest in the format
described below.

The app uses the site's Solarized light and dark palette, plus a grayscale
theme. It also honors reduced-motion preferences and adapts per-keystroke
animation for displays reporting a slow update rate.

## How startup and lesson content work

On startup, `app.js` reads browser preferences, fetches `lessons/index.json`,
loads the listed lesson files, then selects and renders a lesson. A remembered
lesson is restored first; if none is available, `DEFAULT_LESSON_ID` chooses
the first-visit lesson, followed by the first available lesson.

At present, `DEFAULT_COURSES` in `app.js` is empty. The French Evolving Crisis
course is a static JSON pack, not a built-in fallback. If the manifest or pack
cannot be fetched, no lesson from that pack can load. Use an HTTP server for
local testing and ensure the manifest and its files are published together.

Lessons can come from three sources:

1. **Static packs** in `lessons/` are shared, versioned content. Add or edit a
   JSON pack or a raw-text lesson file, and every visitor receives it on the
   next load.
2. **Custom lessons** are created or imported by a visitor. They are saved in
   that browser's `localStorage` and are not shared with the site owner or
   synced to another device.
3. **Built-in lessons** can be defined in `DEFAULT_COURSES` in `app.js`.
   There are none in the current checkout.

When duplicate lesson IDs are loaded, the app keeps one row: a visitor's
custom lesson takes precedence over a static lesson, which takes precedence
over a built-in lesson. Within a source tier, a later entry replaces an earlier
one. IDs therefore act as stable identities for scores, marks, and saved
positions.

### Add and order static lessons

The Jekyll-generated `lessons/index.json` lists JSON packs and `.txt` files
with lesson front matter. Static hosts without Jekyll need to provide an
equivalent manifest. Although the loader can parse Markdown text, store raw
Markdown lesson bodies as `.txt`: Jekyll would otherwise render `.md` files as
HTML before the app can fetch them.

For a JSON pack, a manifest entry can be its filename:

```json
["evolving-crisis-code-fr.json"]
```

Jekyll adds metadata for front-mattered `.txt` lessons as manifest objects;
the object includes the filename and may override lesson metadata such as
`id`, `title`, `course`, and targets.

A text lesson can start with YAML-style front matter:

```yaml
---
id: platform-engineering
title: "Platform Engineering"
course: "Programmer's Practice"
courseId: programmer-practice
courseOrder: 2
order: 1
targetWPM: 30
targetAccuracy: 95
---
Lesson body goes here.
```

The title may instead come from the first level-one heading. The body is
converted to readable practice text: headings, lists, blockquotes, table
separators, and code fences are handled; inline formatting is retained for
typing. Inline lesson text supports `**bold**`, `*italic*`, `` `code` ``, and
`~~strike~~`; the typing view omits their delimiters, while inline editing
shows the Markdown source.

JSON packs can group ordered lessons into a course:

```json
{
  "course": "JavaScript Basics",
  "courseId": "javascript-basics",
  "order": 10,
  "lessons": [
    { "id": "variables", "title": "Variables", "order": 10, "text": "..." },
    { "id": "functions", "title": "Functions", "order": 20, "text": "..." }
  ]
}
```

Lower course and lesson `order` values come first; omitted values retain
source order. `courseOrder` remains supported for older content. A course ID
may be set on the pack or on an individual lesson. In the drawer, visitors can
also drag lessons and courses to reorder them; that order is local to their
browser. Editing a static lesson's title, course, ID, or text in the app does
not change the source file. To publish an edit for everyone, update the pack
or front matter and deploy it.

Course and lesson IDs in the drawer can be copied or edited; the menus can
also generate an ID from a title. A local change to a static lesson ID is
saved as an alias and migrates that lesson's ID-keyed browser data. Selected
lesson exports use the edited ID, and full browser-data exports include the
aliases. To change the shared ID, update the source pack or front matter.

A JSON file can also provide a `marks` array instead of lessons. Those marks
are loaded at startup; where a visitor already has a mark with the same ID,
the visitor's saved version takes precedence.

### Visitor data, editing, and exchange

Scores, preferences, custom lessons, marks, masks, and other browser changes
are stored locally under namespaced `pomoudying.*` keys. Visitor data is not
sent to a server. This keeps the module infrastructure-free, but browser data
does not follow a visitor to another device. `localStorage` is scoped to an
origin, not a path, so projects hosted under the same `username.github.io`
origin share the browser's storage area; the Pomoudying key prefix helps avoid
collisions.

The Courses drawer has an **Export my stats** button. It downloads a
`pomoudying-user-stats.v1` JSON file containing lesson aggregates, completed
run-by-run results, checkpoint speeds, pause intervals, course/lesson IDs,
and session summaries. The local user ID is derived from coarse browser-family,
platform, language, and timezone signals combined with a one-time random value.
Only the opaque ID is exported: neither the raw signals nor the random value is
included. The ID is stored locally, not sent anywhere, and is not an account or
a reliable cross-device identifier; clearing site storage creates a new one.
The current ID appears in the header before global stats: click it to copy, or
use the refresh button to generate a new ID from the current browser context.
Changing it relabels saved local runs to the new ID; if relinking cannot be
saved, Pomoudying retries it on the next visit.
A session ID is generated per browser tab session. The export does not include
lesson text, individual typed characters, or browser/device details. Run history
begins when this feature is deployed; older activity is represented only by
existing lesson aggregates.

**Import other stats** accepts one stats export and stores it in a separate
`pomoudying.otherUserStats.v1` collection. Imported stats never affect this
browser's own scores, averages, lessons, or run history. The user ID is the
deduplication key: re-importing the same user's file updates matching records
and retains previously imported sections that are absent from the new file.
Course IDs are treated as data, not checked against the current course list,
so deleted, renamed, and not-yet-loaded courses remain available for later
comparison. Malformed optional sections are skipped with a notice; invalid
files and storage/quota errors are reported without replacing saved peer data.
Imports do not include or retain top-level browser/device metadata.

The Courses drawer's **Open stats arcade** shows imported snapshots separately
from local practice. Stats exports in `lessons/` are discovered through the
generated lesson manifest and loaded automatically on refresh; they are not
treated as lesson packs. These archive files are public static assets, so only
add exports you intend to publish. The dashboard combines archive and
browser-imported records with the same pseudonymous ID into one row, and keeps
reported course IDs even if their lessons have since disappeared or changed
names. Counts and histories are self-reported snapshots, not a live user
database: overlapping exports, retired IDs, and inconsistent totals are
expected archive artifacts.

Visitors can:

- Search course and lesson titles from the Courses drawer.
- Create, rename, edit, reorder, or delete lessons in the drawer.
- Duplicate an existing lesson from its actions menu to create a customizable
  local copy.
- Edit text in place with `i` in Command mode. Edits to static or built-in
  lessons are saved as local overrides; the original can be restored.
- Custom lessons also accept Markdown headings, lists, blockquotes, tables,
  fenced code, and inline formatting. The editor keeps the Markdown source;
  block syntax is omitted from the typing passage just as it is for `.txt`
  lessons in the lesson folder.
- **Export session changes** downloads the latest versions of lessons created
  or edited in the current browser-tab session, including local overrides of
  static lessons. The changed lesson IDs persist across reloads in that tab and
  reset when its browser session ends.
- Export selected or session-changed lessons as JSON or as a Markdown bundle.
  Markdown bundles use `.txt` so Jekyll does not render their source as HTML;
  use **Import lessons** to import either bundle format or a single `.md`/`.txt`
  lesson.
- Export selected lessons to JSON and import them in another browser. Repeated
  imports of identical content are skipped. Conflicts can be updated, skipped,
  or kept as a second lesson with a new ID.
- Export and import marks and masks separately. Older lesson exports that
  bundle marks remain readable, but marks are imported through the dedicated
  **Import marks** control.
- Export detailed local practice statistics and pseudonymous IDs as JSON; this
  does not include raw browser/device details.
- Import another user's stats JSON into a separate local collection for future
  comparisons. It is not merged into the current user's own stats.
- Browse the stats arcade for imported users, reported practice, and course
  records retained from the static archive.
- Export their browser data with `Pomoudying.exportData()` and restore it with
  `Pomoudying.importData()`.

The header separates **Global stats** (averages, completed runs, and overall
lesson-results coverage), **Session stats** (live speed, accuracy, elapsed
time, errors, and typing/reading split for the active run), and **Current
lesson stats**. The current-lesson card combines position and estimated time
left in the selected lesson with its saved best speed, accuracy, and completed
runs. The **Lessons with results** bar counts currently
available canonical lessons with recognizable saved activity, out of all
available canonical lessons across custom, static, and built-in sources. Hidden
lessons and orphaned stats are excluded. The **Lesson position** bar tracks the
cursor's location through the active lesson. Its percentage is not the
percentage of text typed, nor a measure of saved results or completed lessons.
The stats arcade is a separate, playful roll-up of imported snapshots; its
course archive intentionally includes records for lessons that are no longer
available.

Deleting a shared or built-in lesson only hides it in that browser. Browser
edits, aliases, and deletions do not modify repository content. There is no
automatic contribution path: a visitor can send you an exported lesson, and
you can review it and add it to a static pack. If you later add an online
submission service, keep any credentials on the server side; client-side code
is public.

## Practice flow

The app separates typing state from display and input handling. `TypingEngine`
tracks the text, cursor, timing, and per-character results; `TextView`,
`KeyboardView`, and `StatsView` render those results; the main `App` object
coordinates lessons, modes, storage, and browser events. The engine and app
publish events so the interface and integrations can react without duplicating
the typing logic.

Each lesson moves through these states:

```text
idle -> ready -> running <-> paused -> finished
```

- On a lesson's first visit in a browser session, `idle` veils the text. Type,
  press a key, or use the Type button to reveal it; the waking key is not typed.
- In `ready`, the timer waits for the first real character.
- `running` begins on that keystroke. A lesson can pause and resume without
  losing its cursor.
- `finished` shows the result, objectives, retry, and next-lesson actions.

The first-visit record is kept in `sessionStorage`; an unfinished cursor
position and other preferences persist in `localStorage`. Leaving the page or
switching lessons saves the position; completing or restarting a lesson
clears it.

The app auto-pauses when the page is hidden, the window loses focus, the
typing field blurs, or the user is idle for 30 seconds. Away and idle time
does not count toward typing speed. Resuming is explicit, and the key used to
resume is swallowed. Pause events include a reason (`hidden`, `window`,
`blur`, or `idle`).

The top bar combines global and current-run information. Global averages use
each practiced lesson's best speed and accuracy, and runs count completed
attempts. The live dashboard shows session speed, accuracy, elapsed time,
errors, cursor progress, typing-versus-reading time, and estimated typing time
remaining. Reading time counts successful `n`/`b` word-navigation intervals;
idle command time and inline editing are excluded.
Previous/Next controls beside the keyboard toggle navigate through lessons in
the drawer's course and lesson order, wrapping at either end.

### Typing and Command modes

Typing mode accepts lesson characters, including `Enter` and `Tab`. Press
`Esc` to pause and enter Command mode; press `t` or use the Type button to
return to typing. An **Esc commands** switch can disable Pomoudying's Escape
handling. Escape dismisses an open dialog, completion card, or drawer before
changing modes, and is not captured from unrelated interactive controls.

Command mode supports navigation, template edits, and marks. Editing commands
are undoable; the most recent 20 edits are retained, up to 500,000 characters
of history. Uppercase commands are case-sensitive.

| Keys | Action |
|---|---|
| `n` / `b` | Move to the next / previous word |
| `N` / `B` | Queue the next / previous word for deletion; reversing direction adjusts the same selection |
| `D` / `q` | Delete queued ranges / clear the queue |
| `dw` / `d3w` | Delete the current word or the next 3 words (`d<number>w` accepts any positive count) |
| `x`, `Backspace` | Delete the character or previous word |
| `cw` | Delete the current word and begin editing in its place |
| `u` / `r` | Undo / redo a template edit |
| `:1234` then `Enter` | Jump to character position 1234 (zero-based) |
| `i` | Edit the lesson text in place |
| `mw`, `m`, `M` | Mark or unmark a word; start or finish a passage; mask or unmask a word |
| `t` | Return to Typing mode |
| `:mute` / `:unmute` | Disable / enable typing sounds |
| `:radio off` / `:radio on` | Control Radio Chaito when embedded on the Evolving Crisis site |

`N` and `B` visibly queue ranges without immediately changing the lesson.
`D` commits the queued ranges as one undoable edit; `q` clears them. Queued
ranges can remain while typing elsewhere in the lesson.

Inline editing keeps the typing field focused, supports selection, clipboard,
undo/redo, and movement by visible lines, and pauses the clock. Leaving the
editor returns to the mode that was active before editing. The cursor resumes
at the same character, or at the first changed character if the edit altered
already-typed text. Marks follow edited text where possible. Ordinary
same-length edits update their visible characters in place; edits that change
whitespace, length, or Markdown formatting rebuild the display so word and
source-position mappings remain accurate. This avoids replacing thousands of
character elements for each keystroke in long plain-text lessons.

The grayscale theme uses a small set of high-contrast ink and paper tones, with
shape/underline cues as well as color-independent correctness feedback. Devices
that report a slow display update use a static stroke cue instead of per-key
motion, and disable transitions and backdrop blur.

### Marks, masks, and figures

Marks save useful passages; masks hide passages so they can be recalled on a
later run. Both are edited in Command mode and shown in the **Marks & masks**
drawer.

- `mw` toggles a mark on the current word; `m` starts and finishes a marked
  passage.
- `M` toggles a mask on the current word. A mask created during a run takes
  effect from the next run. The tape keeps the hidden text's width; correct
  letters are revealed, while incorrect ones do not leak the answer through
  animation or keyboard hints. Repeated misses provide a faint hint.
- Completion reports how many masked passages were recalled cleanly.
- **Practice these** turns ordinary marks into a reusable lesson. Marks and
  masks can be exported/imported independently of lessons.

A mark may also carry a figure deck. Add images by URL or upload (uploads are
stored as data URLs in that browser, with a 1.5 MB limit). Figures travel with
the mark and appear while its passage is active; a sufficiently detailed
figure can take the main stage while the typing view moves to picture-in-
picture. Masks never display figures, so hidden text stays hidden. The deck can
be disabled without deleting its media.

Lesson text preserves internal line breaks and tabs, and normalizes typed
input and lesson text to NFC so composed accents match. Spaces and tabs are
visually marked to make repeated whitespace countable. Dead-key composition
holds the verdict until the composed character is known.

## Integration API

The browser API is available as `window.Pomoudying`:

```js
Pomoudying.addLesson({
  title: "My Drill",
  course: "My Lessons",
  text: "A short practice passage.",
  targetWPM: 40,
  targetAccuracy: 96
});

Pomoudying.on("lessonComplete", event => {
  console.log(event.detail.stats);
});
```

The API also exposes `loadLesson`, `courses`, `marks`, `getState`,
`getGlobalStats`, `exportStats`, `setSoundEnabled`, `setTheme`, `exportData`,
and `importData`. `importOtherUserStats(json)` stores a stats export separately
from local results; `getOtherUserStats()` returns those imported snapshots.
Events include `start`, `keystroke`, `error`, `wordComplete`, `checkpoint`,
`lessonLoaded`, `lessonComplete`, `lessonAdded`, `lessonEdited`, `ready`,
`paused`, `resumed`, `markAdded`, and `markRemoved`. Use `off(event, handler)`
to remove a listener. `TypingStudio` remains an alias for older integrations.

## Troubleshooting

- **The page opens without lessons:** verify that `lessons/index.json` and
  every listed file are deployed, and that the app is served over HTTP(S).
- **A lesson does not open first:** a saved `lastLessonId` takes precedence
  over `DEFAULT_LESSON_ID`. Clear the module's site data or use the drawer to
  choose another lesson while testing.
- **A change is visible only in one browser:** app edits are local overrides;
  update the source pack to publish a change to everyone.
- **A path breaks after deployment:** use relative URLs so assets continue to
  resolve under `/modules/pomoudying/`.
