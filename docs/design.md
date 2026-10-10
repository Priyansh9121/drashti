# Drashti design rules

These are the rules for Drashti's operator UI. Later sessions follow them, and change this file when a rule changes. The tokens are in `src/renderer/src/styles/app.css`, the shared components in `src/renderer/src/ui/`, and the **component gallery** shows each one in every state: **Diagnostics > Component Gallery** (start Drashti with `DRASHTI_DIAGNOSTICS=1`), or `/gallery.html` under `pnpm dev`. Any new shared component goes into the gallery too. `tests/e2e/design.spec.ts` runs the accessibility checks on the gallery.

Write our own code. Design ideas may come from outside the workspace (Priyansh's All Skills collection, read as data), but nothing is copied into `app/` from there, from 21st.dev or from anywhere else. Brand matters (colours, the mark, the voice) are decided in the skills review's identity work and Session 26.

## 1. What the UI is for

Volunteers run a sabha with it in a dim hall, often under pressure. So:

- **Dark by default.** The window is near-black and the panels a little lighter. Nothing bright is on screen unless it means something.
- **What is on the screens is never in doubt.** "Live" always looks the same (section 3).
- **Calm.** One accent colour, a few sizes, no decoration. Movement only where it explains something (a panel opening). Reduced motion turns it off.
- **Familiar to operators coming from ProPresenter.** The library, playlists and media are on the left, the slides in the middle, and what's live and what's next on the right, with the layer clears along the bottom. The name "ProPresenter" never appears in the UI.

## 2. Colour

Colours are named for their **job**, never their hue (`bg-panel`, `text-muted`, `border-live`), so a light theme can come later by redefining the tokens. Don't use Tailwind's own palette (`red-500`, `amber-900` and so on) in new code.

| Token                                               | Job                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| `ink`                                               | The window, behind and between panels                                      |
| `panel`, `panel-2`, `panel-3`                       | Panels; raised things (fields, cards, rows on hover); pressed and selected |
| `line`, `line-strong`                               | Dividers; dividers that must be seen                                       |
| `field`                                             | The edge of a control (text box, select, secondary button)                 |
| `fg`, `muted`, `faint`                              | Text; secondary text; the quietest text allowed                            |
| `accent`                                            | The focus ring, selection, links                                           |
| `accent-strong`                                     | The primary button (one per area at most)                                  |
| `live`                                              | On the screens now: always with a label                                    |
| `warning`, `warning-bg`, `warning-fg`               | Missing, can't play, needs a look                                          |
| `success`, `success-bg`, `success-fg`               | Connected, showing                                                         |
| `danger`, `danger-strong`, `danger-bg`, `danger-fg` | Removing and deleting; something failed                                    |
| `guide`                                             | The slide editor's snapping guides (never text)                            |

**Contrast** (WCAG 2.2 AA, measured by `src/main/contrast.test.ts` from `app.css` and `ui/Button.tsx`, which fails on any pair below its rule): `fg` 12.4 to 16.3:1 and `muted` 6.2 to 8.2:1 on the four surfaces, and `faint` at least 4.5:1 on every surface. White on `live` is 5.0:1, white on `accent-strong` 5.2:1. Edges of controls are at least 3:1 where controls sit (`ink`, `panel`, `panel-2`): `field` 3.2 to 3.7:1, so a secondary button's edge is solid `field` (it was `field` at 60%, 2.1:1, until Session 25) and a danger button's is `danger` at 70% (4.1:1); the focus ring 5.3 to 7:1. The same test reports, without failing yet, how far apart the primary, LIVE and ON AIR colours are (CIEDE2000, with usual and red-green colour vision): the primary and ON AIR are 0.5 apart for a deuteranope, and Session 26's colours set a floor. Text is never quieter than `faint`. Never put text on a surface with an opacity modifier (`text-fg/60`), because axe measures the mix. Run the accessibility checks after any colour change.

Group colours (Verse, Chorus…) come from the presentation, so they are shown as a swatch beside the group's name, never behind text.

## 3. "Live" is one colour plus a label

Anything on the screens now uses the `live` colour **and** says so in words: the `LiveBadge` ("LIVE"), "BLACK-OUT", "ON SCREENS", "Logo is on". Colour alone never carries the meaning (WCAG 1.4.1, and colour-blind volunteers):

- a live slide thumbnail has a `live` border **and** a LIVE label in its caption;
- a live row in a list (presentation, playlist item) has a `LiveBadge`;
- a layer clear is lit when its layer has something up: `live` edge and a dot, and the words "On screen" read out (`aria-label`);
- a button that is "on" (black-out, a prop shown) uses the `live` variant **and** changes its words ("Black-out is on", "Hide"). It says its state once: words that change, with no `aria-pressed` besides; or, where the words cannot change (the remote's half-width buttons), fixed words with `aria-pressed` and the state in words beside it (the preview's badge).

Nothing else uses `live`: errors use `danger` and warnings `warning`.

**Show controls change at once** (Session 25). Next, Back, Black-out, Logo, Clear all, Put it back, the layer clears, the Looks and masks buttons, the live thumbnail's border and caption, and Simple Mode's playlist rows take their new state in the same frame as the screens: no colour fade (`Button`'s `instant`), and the live slide is scrolled into view at once, never smoothly. Hover and focus on other controls may keep their short colour change. One name, **Black-out**, with its hyphen everywhere (a unit test checks), and one glyph, a filled screen (`BlackOut` in `ui/icons.ts`), in Pro Mode, Simple Mode and on the phones; Clear all is the eraser everywhere.

## 4. Type

- **The fonts are bundled Noto Sans, Noto Sans Gujarati and Noto Sans Devanagari** (`--font-sans`), so names in English, Gujarati and Hindi all look right offline. The weights are **400, 500 and 700**; use `font-normal`, `font-medium` and `font-bold`. `font-semibold` (600) is not bundled and renders as 700.
- Body text is 14 px (`text-sm`); small text 12 px (`text-xs`); the smallest is 11 px (`text-2xs`, for badges and panel titles only). Dialog titles are `text-lg`, page titles `text-2xl`. Simple Mode uses `text-xl` to `text-3xl`.
- Line height is at least 1.45 (the body default), even in one-line rows: Gujarati and Devanagari marks sit above and below the line, and a tight line cuts them off.
- Panel titles and section titles are 11 px bold capitals with wide tracking (`SectionTitle`, `Panel`). Nothing else is in capitals, and never a name someone typed (a playlist's header, a library's name): capitals do nothing to Gujarati or Hindi, and spaced letters break Devanagari's joining line, so typed names are shown as typed, 12 px bold at least (Session 25).
- Numbers that change (timers, counts) use `tabular-nums`.

## 5. Space, size and corners

- Spacing follows Tailwind's 4 px steps. Use 1, 1.5, 2, 3, 4, 5, 6 and 8 (4 to 32 px). Gaps inside a control are 1 to 2, between controls 2 to 3, and between sections 4 to 6.
- **Control heights:** `sm` 28 px (panels), `md` 32 px (the default), `lg` 40 px (dialogs, live controls), `xl` 64 px and `xxl` 96 px (Simple Mode). Nothing clickable is smaller than 24 × 24 px (WCAG 2.5.8), and nothing on a phone's page smaller than 44 × 44 (§8).
- **Corners:** `rounded-sm` (4 px) for badges and key hints, `rounded-md` (6 px) for controls and rows, `rounded-lg` (10 px) for cards and panels, `rounded-xl` (14 px) for dialogs and Simple Mode buttons.
- Overlays (menus, dialogs, tooltips) use `shadow-overlay`; nothing else has a shadow.

## 6. Components

Use these; don't restyle native elements in a panel. Each is in the gallery.

| Component                                                                         | Use it for                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                          | Any action. `variant`: primary (the one main action of an area), secondary (the default), ghost (toolbars, quiet actions), danger (remove, delete), live (something on the screens is on), warning. `size` sm to xxl. `icon`, `iconEnd`, `kbd`. |
| `IconButton`                                                                      | An action with only an icon. It must have a `label`, which is read out and shown as its tooltip (with `kbd`).                                                                                                                                   |
| `Toggle`, `Checkbox`                                                              | On/off settings (a switch with its label); a tick box in a form.                                                                                                                                                                                |
| `Tabs`, `TabPanel`                                                                | Switching views in one place. The arrow keys move between tabs.                                                                                                                                                                                 |
| `Panel`, `SectionTitle`                                                           | A panel with a header: title (which names the region), icon and actions. It can be collapsible (and remember it).                                                                                                                               |
| `ListRow`, `rowClass`                                                             | Rows in lists: selected (the one shown), marked (one of several), drop target, draggable. Put badges in `trailing`.                                                                                                                             |
| `Dialog`, `ConfirmDialog`                                                         | Anything modal. Centred, or a sheet on the right for settings. The keyboard stays inside, Esc closes, and focus goes back afterwards. A confirmation has Cancel focused.                                                                        |
| `KeepChangesDialog`                                                               | The one question before typed changes are lost (close, Esc or Cancel): Keep editing focused, Save changes beside it, Throw them away (danger) never the default. It says how much would be lost, and when saving changes the screens at once.   |
| `Menu`, `MenuButton`, `menuPlace`                                                 | Menus under a button, or at the pointer on right-click (and from the keyboard: the Menu key or Shift+F10).                                                                                                                                      |
| `Notice`                                                                          | A message in the page: info, success, warning (announced), danger (announced), with actions and Dismiss.                                                                                                                                        |
| `Field`, `TextInput`, `NumberInput`, `Select`, `ColorInput`, `Slider`, `Textarea` | Forms. `Field` gives the label, hint and error, tied to the control.                                                                                                                                                                            |
| `Tooltip`                                                                         | More about a control, on hover and focus; Esc hides it. Not for anything a volunteer must read to use the control.                                                                                                                              |
| `Kbd`                                                                             | A key hint ("F1", "⌘⇧S"). It takes the text colour around it.                                                                                                                                                                                   |
| `Badge`, `LiveBadge`, `MissingBadge`, `UnplayableBadge`                           | A state in words on a row or heading.                                                                                                                                                                                                           |
| `EmptyState`, `Loading`, `ErrorState`                                             | What a place is for when empty and how to fill it; waiting; what failed and a way on.                                                                                                                                                           |
| `Truncate`                                                                        | A name that may not fit: cut off with "…" and shown in full on hover.                                                                                                                                                                           |
| `Progress`                                                                        | A long task's progress.                                                                                                                                                                                                                         |
| `Splitter`                                                                        | The handle between panels: drag it, or use the arrow keys (Shift for bigger steps), Home and End, and Enter for the default.                                                                                                                    |

**Icons** are Lucide (ISC, `LICENSES/icons/`). Import them only from `ui/icons.ts`, and add a new one there (`BlackOut` is Lucide's rectangle, filled). Use 14 px in small controls, 16 px by default, and larger in Simple Mode. An icon is decoration (`aria-hidden`) unless it is the whole button, and then the button has a label.

**What sits over what** (z-index): the splitter 10, notices and the recovery banner 30, dialogs and the slide editor 40, menus 50, tooltips 60.

**Menus** show the focus ring on the choice that has the focus, give the focus back to what opened them when they close (unless a choice put it somewhere else, such as a name to type), and keep Esc to themselves: over a dialog or the slide editor, Esc closes only the menu. While one is open, the keyboard is in it (the menu itself when nothing in it can be chosen), and its keys (the arrows, Home, End, Page Up and Down, Space and Enter) never reach the show: Space chooses, as Enter does (Session 25).

## 7. Every place has its states

Every list, panel and dialog shows:

- **empty**: what goes here and how to add it (`EmptyState`);
- **loading**: when it waits for the main process (`Loading`), never a blank;
- **error**: what failed and what to do (`ErrorState` or a `Notice`), in plain words a volunteer understands, never a code, the system's own text or "Something went wrong" alone, and never "(s)" (`plural`). A file problem is said by `fileProblem` (`src/main/plain-errors.ts`: "The drive is full: free some space, or choose another drive."), and a phone is told "Drashti could not do that. Try again; if it happens again, tell the operator." The raw error goes to the log only; `src/main/messages.test.ts` scans the source for each of these (Session 25);
- **a window that fails as it draws** (Session 23): the operator's and a node's window show `ErrorState` with one primary button that reloads that window alone ("Reload the operator window"), and say the screens keep their picture (`WindowBoundary`). A screen (an output, the stream's picture) never shows words: it draws plain black (`SceneBoundary`) and tries again with the next change;
- **long names**: cut off neatly (`Truncate`) and shown in full on hover.

## 8. Keyboard and screen readers

- Everything works from the keyboard. The focus ring (`accent`, 2 px) is drawn by the base styles on every `:focus-visible` element; don't remove it. A component may add its own sign beside it (the Splitter's line thickens), never instead of it.
- **Dragging is never the only way** (Session 25). The chosen library row (a presentation, media file or Shastra passage) has **Add to playlist** on a line under it while a playlist is open, and every library row's menu has Add to "…": it goes after the playlist's chosen item, or at the end. The chosen playlist item has **Up** and **Down** on a line under it, and Alt+↑ ↓ on it; the keyboard stays on the moved item and the move is said ("Moved “…” up"). Each add and move, dragged or not, is one Undo step. The buttons go on their own line so the name keeps its room, and they hide while a drag is under way (a row that changes under the pointer as a drag starts makes Chromium cancel it).
- **"What is this?"** (Session 25): a small ? on each operator panel's heading (and on Playlists, the library, the slides and the live picture) opens two or three plain sentences under the heading, in the panel's own space, never over the show controls: what the panel is for and the one thing to do first, with Got it (Esc too) giving the keyboard back to the ?. The words are in `src/shared/panel-help.ts`, each following a passage of the operator's guide; `src/main/panel-help.test.ts` fails on a panel with no words or a passage the guide no longer has. Pro Mode only.
- **The keys sheet** (Session 25): Help › Keyboard Shortcuts…, or **?** when no field has the focus, in Pro Mode (Simple Mode keeps its key line). It is built from `KEYMAP`, grouped by what the operator is doing (`KEY_GROUPS`, every action once: a unit test checks), with each key as the computer writes it (`keyText`), and says the keys may change after the setup day. The menu item has no accelerator: ? is the page's key, so the guards for fields and dialogs hold.
- The show's keys (`src/shared/keymap.ts`) are ignored while a field has the focus or a dialog is open (`aria-modal`), and for any key a control has used itself (`defaultPrevented`): a control that handles a key calls `preventDefault()`, so the arrows between tabs, through a menu or on a splitter never also move the slide on the screens (Session 15).
- Lists you move through with the arrows use roving focus (Tabs, menus, radio groups through `ui/radio.ts`); long lists are virtual, so only the rows in view exist. A plain list of buttons (the playlists) is a list, not an ARIA tree: a tree takes the arrows, which belong to the show.
- A row with a right-click menu opens it from the keyboard too: Shift+F10 or the Menu key, handled by the row itself on every system (`isMenuKey` in `ui/Menu.tsx`; Chromium does it by itself only on Windows).
- **Landmarks.** The operator window is regions in the order it is laid out, and Tab goes through them in that order: the header, Playlists, Library, the slides, Live, Show controls (the layer bar) and the status bar. New panels go inside one of them. Only the splitters sit between regions.
- Every control has a name: its text, its `Field` label, or an `aria-label`. Icon buttons have their label as a tooltip too.
- Things that change on their own (what's live, import progress, notices) are in `aria-live` regions or have the status/alert role.
- **Larger text.** At 200% zoom (View, or the system's text size) every control can still be reached: below 960 × 540 CSS pixels the window scrolls rather than cutting columns off.
- **Reduced motion.** With the computer set to reduce motion, the interface's transitions and animations stop (`app.css`). The screens' own dissolves and the ticker are the show, not the interface, and keep moving.
- **Phones.** Every control on the phone and tablet pages is at least 44 × 44 CSS pixels, whatever its size class (a rule in `app.css` for `body.web`), and the pages never zoom on a double tap or reload on a pull (`touch-action`, `overscroll-behavior`, the stage display too). `tests/e2e/phone-targets.spec.ts` measures them at 390 × 844 in WebKit; a real iPhone and iPad are still owed. Elsewhere, 24 × 24 is the least (WCAG 2.5.8).
- `tests/e2e` runs axe-core (`tests/e2e/a11y.ts`) on the operator window, Simple Mode, each panel and the gallery, and fails on any serious or critical finding. `a11y-keyboard.spec.ts` runs a sabha by keyboard alone in both modes and checks the Tab order and focus ring; `a11y-display.spec.ts` checks 200% zoom, reduced motion, and the phone pages at 375 × 812.

## 9. Layout of the operator window

There are three columns between a header and a footer:

- **Left:** playlists above, and the library (presentations, media) below.
- **Middle:** the chosen presentation's slides as thumbnails in one grid, in play order, flowing on from one group to the next. Each thumbnail has its group's colour as a strip beside its number, and the first slide each time a group comes up carries the group's name. The thumbnail size (120 to 400 px, 170 at first) is remembered: at 170 three slides fit a row at 1280 × 720 and six at 1920 × 1080.
- **Right:** Live and Next, then the Looks, the stage screen, and the props, messages and timers panels.
- **Along the bottom:** the layer clears and black-out. Under them is the status bar: screens connected, the sound output, import progress and notices.

The columns are resized with `Splitter`s and the sizes are remembered on the computer (`ui/persist.ts`). Everything fits at 1280 × 720 with nothing cut off or overlapping. Simple Mode is one screen with big buttons, and fits at 1280 × 720 too.

## 10. Simple Mode

Simple Mode (`src/renderer/src/simple/`) is for a volunteer who has never used Drashti:

- **One screen, nothing to find.** The playlist sits on the left with its headers. In the middle are what's live and what's next. The big buttons run along the bottom: Back, Next (the biggest, `primary`), Black-out, Logo, and Clear all. After Clear all, that button turns into **Put it back** (`warning`).
- **Big targets.** The buttons are `xl` and `xxl` (64 and 96 px high), playlist rows are at least 56 px, and text is at least 16 px except the key hints.
- **States in words.** Black-out and Logo use the `live` variant when on, and their words change ("Black-out is on", "Logo is on"), read out once (no `aria-pressed` besides). The live playlist row has a LiveBadge.
- **Nothing that changes anything.** No editing, removing, importing, themes, screens, sound or backups. Don't add a control here that changes the library or the setup. The main process refuses those requests in Simple Mode anyway (`src/main/simple-mode.ts`).
- **Undo comes first.** Back undoes the last Next exactly, and Put it back undoes Clear all. Every new action in Simple Mode needs a way to undo it, in one press.
- **The way out is small, at the top, and asks first** (Session 20). **Switch to Pro Mode…** (`secondary`, `md`) sits at the right end of the header, far from the big buttons, and opens the same question as View > Switch to Pro Mode…: the word **pro**, or a PIN with roles on, so nobody leaves by accident. Windows hides the menu bar, so Simple Mode shows its own way out. Don't make it bigger or move it near the big buttons.
- **Which mode Drashti starts in** (Session 20, `startingMode` in `src/shared/mode.ts`): after an unexpected stop less than 3 hours before the start, the mode it was in; otherwise (a quit on purpose, or a stop 3 hours or more before, Session 21), Pro Mode, or Simple Mode with roles on. It is the same answer restart recovery uses (`recentStop` from `startupRecovery`): did the last run stop unexpectedly, within `RECOVERY_MAX_AGE_MS`?
- It fits 1280 × 720 with nothing scrolling, its way out at the top (`tests/e2e/simple-mode.spec.ts`).

## 11. The slide editor

The slide editor (`src/renderer/src/editor/`) covers the operator window, as Edit words does, so nothing behind it can be pressed by mistake. Along the top: its name, Undo and Redo, what can be added (Words, Shape, Picture or video), then Cancel and Save (the primary button; **Done** when nothing has changed). Below: the slides on the left, the slide in the middle, the inspector on the right.

- **The slide is drawn by the slide renderer**, scaled to fit, so what is seen is what the screens show. Selection is the `accent` colour: an outline round each selected element, square white handles to resize one and a round one above it to turn it, all a constant size on screen. Snapping guides are `guide` (a pink that shows on any slide), across the whole slide.
- **The keyboard.** The slide is one focus stop (`role="application"`, with its keys in its label): Tab chooses the next element and, after the last, moves on to the inspector, so keyboard users are never trapped. A polite live region says what is selected, where and how big. Esc steps back one stage at a time: typing, then the selection, then the editor (asking first when there are changes).
- **The inspector** groups its fields in titled sections (Selected, Place and size, Words, Shape, Picture/Video). Numbers change as they are typed; colours use the system picker. It says whether text styles go to the whole box or to the selected words.
- **Typing in place** shows a dashed `accent` outline round the box; the words keep their look while typed.
- **Several selected** keep their own outlines and get one dashed `accent` box round them all, with the same square handles and round handle, which act on them together (snapping as one); "2 elements selected" is read out. Copy, Cut and Paste are the Edit menu's (and their keys); "Copied 1 element." shows in the editor's note line.
- Questions use the usual alert dialogs: "Keep your changes to the slides of “…”?" (`KeepChangesDialog`: Keep editing has the focus; it says when the presentation is on the screens, because saving then changes them at once) and "Save over the other change?".
- It fits at 1280 × 720 with nothing cut off, and axe finds nothing serious, also while typing (`tests/e2e/editor.spec.ts`).

## 12. Kirtans and their languages

- **Missing is a state, not a blank.** In Edit words, By language, a slide with nothing in a language shows that field with a dashed `warning` border, a `warning` tint and a **Missing** badge by the language's name (the field's own label says "(missing)" for screen readers). An empty field is never shown as if it were a line with no words.
- **A kirtan's languages are named, never flagged by colour alone.** Track names are the words Gujarati, Hindi, English and Transliteration (`LANG_NAMES`); short tags (GU, HI, EN, TR) appear only as badges on library rows.
- **Choosing a screen's languages** (`screens/LanguagePicker.tsx`): two radio buttons, "All, in each slide's order" and "Only these, in this order"; then one row per language with a tick box and, when ticked, Up and Down arrows (icon buttons with those words as labels). The last language ticked cannot be unticked. The same picker goes in Screens and the setup wizard.
- **Previews say whose languages they show.** The live and next previews draw a kirtan's slide in the first audience group's languages, and under the live picture a line says so ("As “Hall” shows it: Gujarati, Transliteration"); thumbnails always show every language.
- Both the Kirtan dialog and Edit words, By language, fit at 1280 × 720, with each field at least 180 px wide when all four languages are side by side (`tests/e2e/kirtans.spec.ts`).

## 13. Templates and the setup wizard

- **Templates live apart.** The playlist column has two tabs, Playlists and Templates. A template opened shows an `info` notice saying it never goes on the screens, with **New playlist from this**; its items are never put in the slide grid.
- **Slots are dashed, quiet rows**: a dashed `line-strong` border, the slot's name, and "A slot · its category · choose what goes here". An import's placeholder keeps the dashed `warning` look: one is a place to fill, the other a problem. **Edit slot…** (its menu) is a small dialog with the name and "Search in", the same fields as Add a slot.
- **An item's timer cues say what they do, under its name**: a small clock and "starts “Pravachan”, shows “Sabha starts in”". They are set in **Timers when it goes up…** (its menu): one row per cue, two selects in words ("Start it from the beginning", the timer) and Remove; up to four.
- **The wizard is a dialog of steps**: the step names with numbers along the top (the current one bold, `aria-current="step"`), one step at a time, **Back** on the left, **Skip this step** and **Next** (primary) on the right, **Finish** on the last step after a summary in words. Anything it would change is said before Finish, and nothing changes until then.
- **Outputs are numbered the same everywhere**: the wizard's rows, and the big number Identify puts across each display. The display the controls are on carries a `warning` badge, and choosing an output there says Finish will ask first.
- Both fit at 1280 × 720 (`tests/e2e/templates.spec.ts`, `tests/e2e/setup.spec.ts`).

## 14. The stream

- **ON AIR and REC are not LIVE.** LIVE (`live`, red) means "on the hall's screens". The stream has its own marks in the header, beside the name, and in Simple Mode: **ON AIR** on `onair` (violet, white text 5.7:1), and **REC** as a `rec` dot beside the word on a panel. Both always say so in words, and while reconnecting ON AIR says "On air · reconnecting". The window's own title says it too ("Drashti — ON AIR · REC").
- **The Stream panel is a sheet on the right**, like Screens: the Program's preview (marked `data-a11y-picture`) with the sound level under it, then the layout as two large choices (`role="radio"`), the inputs with their state in words, and the controls. **Stream settings** is a centred dialog over it.
- **The level meter** reads -60 to 0 dB (`role="meter"`), green, then `warning` above -12 dB and `danger` above -3 dB, holding a peak and falling back at 20 dB a second like a mixer's; above 0 dB it says "Too loud" (the sound is clipped).
- **A key is never shown.** Once saved, the settings say "A key is saved for this profile" with **Replace key** and **Remove key**; the field is a password field and empties as soon as it is sent.
- Both fit at 1280 × 720 (`tests/e2e/stream-program.spec.ts`).

## 15. Converting media

- **Names come first.** The media list's column is narrow, so a row keeps its name whole and says everything else on its second line: "Video · can't play as it is" in `warning-fg` (what the file is in the tooltip) with a small **Convert** button (the `Wand2` icon) at the end; "Waiting to convert" (why, such as the stream being on air, in the tooltip); while converting, a thin bar and "Converting… 42%" (the words carry it for screen readers; the bar is only seen), with an **×** to cancel; after a failure, why, in `danger-fg`, and the button says **Try again**; once converted, "Converted to .mp4" (the tooltip names the copy everything now uses). Only a missing file keeps a badge.
- **One bar above the list** when there is something to convert: how many files Drashti cannot play, with **Convert all**; while converting, "Converting N files, one at a time" and, for more than one, **Cancel all**. The bar's text is `aria-live="polite"`, so a screen reader hears it change.
- **The import report** says the same in an `info` notice, with **Convert all**, and each file's row has its own **Convert**, then its progress, then "Converted: <copy>" in `success-fg` text.
- **The copy is an ordinary row of its own**, next to the original (the same name, another extension). Undo goes on the one Undo stack, "Converted <file>".
- It fits at 1280 × 720 (`tests/e2e/convert.spec.ts`), and the screenshots are `docs/screenshots/convert-*.png`.

## 16. Phones and tablets

- **The network says it is on, always.** While it is on, the header (and Simple Mode) carries "Network on · N devices" in a quiet badge of its own (an outlined accent, never the live red or the on-air violet), with a warning look when it is not listening.
- **The Phones panel is a sheet on the right**, like Screens and Stream: a large switch, the addresses in a monospace font a volunteer can read out, pairing, the devices, the poster. Pairing shows a QR code (black on white with a quiet border, so every camera reads it, in a dark room too) beside the six-digit code in large monospace type, grouped "123 456", and the time it has left.
- **Removing a device asks first**, and says it is cut off at once.
- **Pages on phones are phone-first**: the design system's dark look, 16 px or larger type, touch targets at least 44 px, everything in one column, and nothing that needs a hover. Two kinds of text are smaller until Priyansh decides (proposed in Session 25): a tab bar's word under its icon (12 px, `data-small-label`) and the state badges (11 px bold capitals, as everywhere).
- **The remote is one screen**: a header with the device's name and its connection chip (Connected in green, Connecting…, or Not connected with when it tries again, always in words), a middle that scrolls, and Back and Next below it (xl buttons, Next primary), so nothing ever scrolls under them. On a phone the middle is four tabs (Show, Playlist, Library, and More: the Looks when there are two or more, timers and messages) with a tab bar under Back and Next; from 768 px wide the playlist or the library (a two-way switch above them) sits beside the show and there are no tabs.
- **The presenter's remote** (Session 18): **Notes** sit under the live picture, the live slide's in body size (`text-lg`) and the next slide's below a rule in muted text, behind a small **Show notes / Hide notes** button (aria-expanded, remembered on the device, open the first time). The **Library** is a search field (`type="search"`) over the presentations by name, 100 at a time with **Show more**; each row is the name with its library, category and slide count (or, when searched, where it was found) in muted text, and the live one has the live border and badge. A presentation opened from it shows its slides with "Not on the screens. Tap a slide to put it up." and **On the screens** to go back to what is live; a slide a search found has the accent border and is scrolled into view. **Held sideways** (from 1000 px wide in landscape: an iPad, a laptop's browser) the page is two columns: the live picture, the notes, what comes next and the clears on the left (40%, at least 20rem); on the right a tab row (Slides, Playlist, Library, More) over its own scrolling panel; Back and Next stay along the bottom, full width.
- **On the remote, LIVE is the live red, as everywhere**: the live slide's thumbnail and the live playlist item have a live border and the LIVE badge; Black-out and Logo are pressed (aria-pressed) in the live colour while on; Put it back turns warning when it can.
- **Thumbnails on a phone** draw the slide with the outputs' renderer; pictures and video are previews, grey until they load.
- **The stage display is the stage screen**, on black, with nothing else but a quiet Full screen button (until it is full screen) and, while the connection is down, one small warning line in a corner over the last picture.
- **The announcements page is one short form**: the words (a large text box with how many characters are left), who it is from, how long to show it, and one large Send. Below it, "What you sent" lists the phone's own announcements with what became of each, in words and colour: Waiting for the operator (warning), On the screens until 5:12 pm (live), Shown or Not shown (neutral).
- **The Announcements queue is a sheet on the right**, like Phones, opened from a header button that appears while the network is on and turns warning with how many are waiting ("Announcements (2)"). Each waiting announcement is a card: its words large, who sent it, from which device, when and for how long, then the choice of how it goes up (In the ticker or As a message, and the template), Approve (primary), Edit and Reject (danger). On the screens, a card says On the screens (live) or Cleared from the screens (warning), when it comes off, and Take off. Earlier ones are one line each.
- **The ticker is a band along the bottom of the audience screens**: 7.5 % of the canvas high, near-black at 80 % with a thin light line along its top, white words at the messages' size and weight, moving from right to left at about 130 px a second on a 1080-line screen. Messages sit just above it while it shows. It is in the layer bar as "Ticker" (F8), lit while it is on.
- The panel fits at 1280 × 720, the pairing page at 375 × 812, and the remote passes the accessibility checks on a phone and on a tablet (`tests/e2e/network-pairing.spec.ts`, `tests/e2e/remote.spec.ts`). The announcements page passes them at 375 × 812, on a phone and on a tablet, and the queue fits at 1280 × 720 (`tests/e2e/announcements.spec.ts`).

## 17. Looks

- **Switching is a show action, so it sits with the live controls.** The Looks panel under Next is one button per Look, in the list's order. The live Look's button is `live` (red, white text) with a white dot and `aria-pressed="true"`; the others are plain. A Look is never switched by a key alone: it takes a click (or a phone's tap, or the API).
- **Changing a Look is setup, so it lives in Screens.** At the top of Screen groups, the Looks are tabs (`Tabs`, `sm`), the live one with a **Live** badge. Below the tabs: the chosen Look's name (a field, saved on Enter or leaving it), **Duplicate**, **Up** and **Down** (the first is the one Drashti starts with), and **Remove** (`danger`, asking first, and saying whether the screens will change). Each group card then shows "In the Look “…”" with that group's settings: layers as tick boxes, how slides are drawn, and the languages picker. Stage groups show only their languages; the stream group only its languages.
- **Simple Mode never shows either.** It keeps the live Look.

## 18. Stage layouts

- **Standard stays as it was.** It is built in, shown first in the editor's list as "Standard (built in)", drawn by the same StageView, and cannot be changed: an `info` notice says so and offers Duplicate.
- **The editor is a large dialog** (`size="full"`): the layouts on the left, the layout in the middle drawn by the same renderer as the stage screens (with what is live now), the chosen box's settings on the right. Boxes are dashed outlines; the chosen one is an `accent` outline with square white handles; snapping guides are `guide`, as in the slide editor (`boxes/BoxCanvas.tsx` serves both editors). The canvas is one focus stop: Tab chooses the next box and the arrows move it; place and size are also number fields, so nothing needs a mouse. Changes are kept until **Save**; leaving with changes asks first.
- **Boxes say what they show in words**, in the list of boxes and the canvas's spoken status ("Clock chosen, at 962, 186, 710 by 130").

## 19. Masks

- **Two kinds, said plainly.** In Screens a group's mask is "Mask (these screens' own shape)"; in the right column the **Masks** panel puts a mask up for a moment. The panel's buttons are like the Looks panel's: the mask that is up is `live` (red) with `aria-pressed="true"`, and pressing it again takes it down (as F7 does).
- **On the screens a mask is a cover**: its picture (black where it hides) laid over the layers it masks, never a CSS mask on them, so a video under it is not drawn through the mask on every frame (Session 15). The pixels are the same, a key output's too.
- **The mask editor is the stage layout editor's twin** (`size="full"`, the same `BoxCanvas`): the masks on the left, the mask in the middle over a blue test grid (what it lets through) on black (what it hides), the chosen shape's settings on the right, Save at the bottom. "Hide what is inside them" and "Show only what is inside them" are two radio buttons, in words.

## 20. Key and fill

- **A group role like the others**, "Key and fill (for a video switcher)", with a short line under it saying what the two displays are and how to set the switcher. Each screen in the group says what it sends ("The fill (the picture)", "The key (white where the fill has something)") in a select beside it.
- **The key is not a picture to look at**: it is only on its output. The operator's previews never show it.

## 21. Macros and MIDI

- **A macro is a coloured button.** In the Macros panel each macro is a two-column button with a strip of its colour and its name; a click runs it at once (it is a show action, like Next). Its colour is chosen from a few that read on the dark panels.
- **The macro editor lists actions as plain sentences in order**: the action's name, then its choices (a Look, a prop, a template and its fields…), with Up, Down and Remove as icon buttons with those words as their labels. Only actions a macro may do are offered.
- **MIDI says what it heard.** The MIDI dialog shows the device and whether it is connected (in words), every action with what it is mapped to ("Note 36, channel 1") and Learn, and a live line with the last note or controller the controller sent, so an operator can see the pad is reaching Drashti.

## 22. Shastra

- **A tab of the library, not a mode.** The Shastra tab sits beside Presentations and Media in the left column: the reference box first (with **Show**), then search, then the texts to browse, and **Texts…** at the foot. A reference that names nothing says why in a `warning-fg` line under the box (`role="status"`), never a dialog; the box keeps what was typed, to fix.
- **A passage is shown like a presentation.** It fills the slide grid with a group per item, named by its reference ("Placeholder Granth 14"), and a line in the header says it is a Shastra passage. Edit words, Kirtan and Edit slides are not offered: its slides are made from the text. Rows in the Shastra tab, search results and browsed items alike, can be dragged onto a playlist.
- **Texts… is setup** (Pro Mode): a table of the loaded texts with their abbreviation ("Type “PG” and a number", or "Type “PV”, a section and a number"), items, languages as badges, a theme select, and **Remove** (`ghost`, asking first in an `alertdialog`). The subtitle says that only authorised texts are loaded.
- **Sanskrit's two scripts are named in full** everywhere a language is chosen: "Sanskrit (Devanagari)" and "Sanskrit (Gujarati script)"; badges are `SA` and `SA·GU`.

## 23. The arti at its time

- **A strip, not a dialog.** The arti prompt is a `warning-bg` strip across the operator window under the header, never modal: the show goes on under it, and Next keeps working. It names the arti, counts down to it (tabular figures), and offers **Put up Arti now** (`primary`, the only primary there) and **Not now**. When a schedule goes up by itself, it says so in words ("goes up by itself in ten seconds") with **Cancel** beside the count.
- **Screen readers hear it once per step.** The sentence (coming up; it is time; going up by itself) is a `role="status"` that changes only when the step does; the ticking count beside it is hidden from them, so nothing is read out every second.
- **Simple Mode: one big button.** The same strip sits above the big buttons with an `xxl` **Put up Arti now** and an `xl` **Not now**; there is nothing to set there.
- **Times are set in the live column.** The Arti panel lists each time as its name, "Every day 19:00" or "Sun, Wed 19:00", when it next prompts, and its presentation; a switch turns one off; **By itself** is a `warning` badge. A removed presentation says so in `warning-fg` on its row.

## 24. Samvat and tithi

- **Today's line is information, not a control.** Along the bottom of the operator window (and Simple Mode), with a calendar icon, in muted text; the festival after a dot in `warning-fg` bold, so a festival day is seen. In Pro Mode it opens the Calendar dialog; in Simple Mode it does nothing.
- **Nothing for a date the calendars do not give.** No placeholder text, no "unknown": the line, the stage box and the message field are simply empty. The Calendar dialog says it in words ("No loaded calendar gives today's date").
- **Two languages, each written its own way.** Gujarati with Gujarati digits for the year ("સંવત ૨૦૮૨"), English with Latin digits ("Samvat 2082"); a stage box or message field chooses one. The names are the calendar's own, never translated by Drashti.
- **The Calendar dialog is setup** (Pro Mode, from the Timers panel): today in both languages at the top, then the loaded calendars as a table (name, dates, days, **Remove** asking first), and **Load a calendar…** in its header. Its subtitle says only authorised calendars are loaded.

## 25. The idle rotation

- **Start is the panel's one primary button**, and turns into **Stop** (`live`, with the words) while it runs, with a line saying it stops by itself when a slide or picture goes up. Where it shows is said in words from the live Look ("Hall (once started), Lobby (always)"), or how to make it show.
- **The pictures are shown whole** on black (never cropped: a darshan picture is not trimmed), and dissolve into the next over a second and a half. A quote is centred, each language in its own font, the attribution under it in muted grey after a dash.
- **Set up is setup** (Pro Mode): the chosen pictures in order with Up and Down as labelled icon buttons, the library's pictures as ticks with thumbnails, the seconds, the quote of the day, and the quotes (each with its languages as badges, Edit and Remove asking first). Its subtitle says only authorised pictures and quotes are used.

## 26. Output nodes and the screens dashboard

- **The dashboard is about the screens as they are, so it opens from the status bar.** The screens line at the bottom left ("3 screens showing") opens it in both modes; Screens (the header button, Pro Mode) stays the place to set screens up, and the dashboard's **Set up screens…** goes there. It is a sheet on the right (`size="xl"`), like Screens.
- **One card per display, grouped by computer**: "This computer (Main)" first, then each node in a bordered section with its facts. A card is the picture of what the display really shows (16:9, on black, `object-fit: contain`, with the display's number in a corner), then the screen's name, its state as a badge in words (Showing in `success`, Node offline and Display not connected in `warning`, Off neutral), the display's size and refresh, and late frames in a muted line ("No late frames in the last minute"). A display with no screen says "Not used" in place of a picture.
- **A node's facts are a definition list**, in words with their units: Online since 19:02, Latency "1.2 ms round trip", Clock "4000 ms off Main’s, corrected", Media "14 of 14 ready (220 MB of 220 MB)", Version, Address. Online and Offline are badges (`success`, `warning`); a node refused for its version says so in a `danger` notice.
- **What needs a look is said twice**: a `warning` notice at the top of the dashboard listing each problem in a sentence, and the status bar's warning chip (`warning-bg`, with the first problem and "and N more"), which opens the dashboard. The chip shows in Simple Mode too: a volunteer must notice a dark screen.
- **Actions are small and labelled**: Identify on every card and "Identify all" per computer (both modes); Pro Mode adds Reload, Remove (`danger`, asking first) and renaming in place (a borderless field that shows its border on hover and focus), and the "Get everything ready" tick per node. Simple Mode shows no button it would refuse.
- **Pairing a node shows the address and the code together**, both in monospace, the code large and grouped "482 913", with the time it has left and Cancel: a person reads both out to whoever is at the node. Screens lists each node as a card with its displays (the same rows as this computer's, with Use this display).
- **The node's window is one calm column** (`max-w-3xl`): what it is ("Drashti Node", the computer's name and version), the Main it follows with the link as a badge (Online `success`, Connecting… neutral, Offline `warning`, Refused `danger`) and, when it is not online, why in a notice in plain words; the certificate's fingerprint in monospace groups of four; its displays as rows with what each shows; its media as a progress bar and a sentence. Unpair (`danger`) and Use this computer as Main ask first. Before pairing, the same column holds the two fields (Main's address, Code) and one primary button.
- The dashboard and the node's window pass the accessibility checks at 1280 × 720 (`tests/e2e/nodes-dashboard.spec.ts`).
- **What the node did** (Session 17): a notice under the node window's opening line for 20 seconds, as Main's live controls say it: "Diagnostics saved on the Desktop: …" as `success`, a failure as `warning` (role `status` or `alert` from the tone).

## 27. Roles and PINs

- **Who is at the controls shows in the header**, only once roles are on: **Operator** (`ghost`, a lock icon) opens the admin PIN prompt; **Admin 9:41** (`warning`, an open lock, the time left counting down) locks at once when pressed. Nothing else changes in the window: an admin control stays where it is and asks for the PIN when used, so operators learn one layout.
- **A PIN field is a password field for digits**: `inputMode="numeric"`, never autofilled, monospace and wide-spaced, cleared after every try, right or wrong. Wrong PINs say so in words under the field; the wait after too many counts down there too ("Try again in 0:45"), and the button that would try waits with it.
- **The admin PIN prompt says what it is for** ("To back up the library, type the admin PIN") and how long admin then stays unlocked. Cancel leaves everything as it was.
- **Roles and PINs** (File menu) is one dialog in two states: off, two new PINs, each typed twice, with what each role does; on, a change for each PIN and Turn roles off (`danger`, asking first). The setup wizard's PINs step is the same fields.
- The dialogs pass the accessibility checks at 1280 × 720 (`tests/e2e/roles.spec.ts`).

## 28. Scheduled backups

- **One dialog from the File menu** (`size="md"`): the switch, the folder (a read-only field with **Choose…**, since only a folder dialog can pick a drive), the days, the time, how many to keep and the media tick, then how they stand: running with a progress bar, waiting with why in an `info` notice, the last one (muted when it went well, `warning-fg` with the triangle when it was skipped or stopped) and the next. **Back up now** sits on the left of the footer, as an action, not a setting.
- **A skipped or stopped backup shows in the status bar** in both modes (`warning-bg`, the triangle, the reason in words, and **OK** to put it away), because a volunteer may be the one who can plug the drive back in. It goes by itself after the next backup that works.
- **An import with problems shows in `warning-fg` with the triangle** (Session 16): "1 problem" in the ordinary text colour was missed when a deck was refused. **Report** is beside it as before.
- **Files dropped anywhere on the operator window are imported** in Pro Mode (Session 16), as on the presentation list, which keeps its own drop overlay. An operator drags a deck onto Drashti wherever it lands; before, a file dropped outside the list did nothing at all. Simple Mode still ignores dropped files.
- The dialog passes the accessibility checks at 1280 × 720 (`tests/e2e/scheduled-backups.spec.ts`).

## 29. Macros at set times

- **A macro's times live in its editor**, under **Runs by itself**: one row per time (every week or one date, the days or the date, the time, an on switch, remove), and **Add a time**. The Macros panel marks a macro that runs by itself with a small clock and its time, never colour alone.
- **The countdown is a strip, like the arti's prompt**: under the header in Pro Mode, above the big buttons in Simple Mode (`big`, as large as the arti's there), in `panel-3` with an accent border so it reads apart from the arti's yellow. It names the macro, says it runs by itself in ten seconds, counts down in large digits and offers **Cancel** (`secondary`). The sentence is a status line, read once; the digits are hidden from screen readers.
- Both pass the accessibility checks at 1280 × 720 (`tests/e2e/scheduled-macros.spec.ts`).

## 30. Updates

- **One dialog from the Help menu** (Pro Mode only): which version this is, **Check now** on the left of the footer, and for a newer release a card with its version, size and notes, then one next step at a time: **Download** (`primary`), a progress bar with what it is doing (or why it waits) and **Stop**, then **Install it when Drashti quits** as a switch, saying that Drashti does not start again by itself. On an unsigned Mac the switch is an `info` notice saying how to install by hand, with **Show the file**. **Look once a day** is a switch whose label says it never downloads or installs by itself.
- **The status bar says it in a word, in Pro Mode only** (`accent`, a download icon): "Drashti 1.0.1 is available", "… is downloaded", "… installs when Drashti quits"; a click opens the dialog. Simple Mode shows nothing about updates.
- **A node's window offers to match Main** under its Main section, in the same calm column: what Main runs and what it runs, then **Update to Drashti x.y.z**, **Download**, **Quit and install**, one at a time.
- The dialog and the node's offer pass the accessibility checks at 1280 × 720 (`tests/e2e/updates.spec.ts`).

## 31. Music (audio playlists)

- **A panel in the live column**, like the arti's: which list (a select, with rename and remove beside it), then the transport in one row (previous, **Play** or **Pause** as the one `primary` button, next), then loop and shuffle as small toggles whose state is `aria-pressed` and an accent colour with words in their labels, never colour alone. What plays is a status line above, with its time left ("Paused: …" while paused).
- **Tracks are compact rows**: the number (or a play mark in `live` for the one playing), the name, its length, and Up, Down and take-out buttons. A track that cannot play says so in words and cannot be clicked. **Add sounds…** opens a dialog of the library's sounds to tick.
- **Simple Mode gets one strip**, between the previews and the key hints: the list's name and what plays, and one large button, **Play music** or **Pause music**. Nothing else about music shows there, and it still fits 1280 × 720 with nothing scrolling.
- The panel, the add dialog and Simple Mode's strip pass the accessibility checks at 1280 × 720 (`tests/e2e/music.spec.ts`).

## 32. Playback markers

- **A dialog from the media list's bookmark button**, titled with the file's name: a silent preview with its own controls at the top, then **Start** and **End** as time fields ("1:02.5") each with a small **Here** button, then the markers as compact rows (the name as a button that shows it in the preview, its time in tabular figures, and a remove button), then a name field and **Add at the time shown**. One problem line in `danger`, in words, above **Save** and **Cancel**.
- **Jumps sit under the live picture**, one row per layer ("Background:", "Sound:"), small buttons with a bookmark icon and the marker's name; nothing shows when what plays has no markers. The remote's More tab has them as large buttons under **Jump to a marker**.
- The dialog passes the accessibility checks at 1280 × 720 (`tests/e2e/markers.spec.ts`).

## 33. The logo and the app icon

- **The logo is the lamp's flame** (Session 19): a diya's flame with its bright core, over the lamp, on a deep plum tile (`build/icon.svg`). Drashti means sight: the flame is the light we see by, and the arti's light. Its colours (plum `#5e1b52` to `#2a0b27`, flame `#ff7a2f` to `#ffc23d`, core `#fff3c4`, lamp `#ffd36b` to `#ef9b33`) are the logo's own: they are not UI tokens, and the operator UI does not use them.
- **One source, drawn on Apple's grid:** a 1024 px canvas with the tile (`id="tile"`) at 100 to 924 and 185 px corners. The Mac's icons keep that margin; Windows' icons are filled 94% by the tile; the Home Screen icon for an iPhone or iPad is the tile edge to edge with square corners, because iOS rounds them itself. `pnpm icons` draws every size from the one source, with no separate drawing for small sizes, so the shapes must stay apart at 16 px: one flame, one core, one lamp, and a gap in the tile's colour between the flame and the lamp.
- **It reads at 16 px on a dark and a light Dock or taskbar.** Look at any change at 16, 32 and 128 px on both before committing it.
- **Never** the BAPS logo, a murti or a real picture, and nothing like ProPresenter's icon. Where it came from: `LICENSES/logo/`.

## 34. Import from a Link

- **One dialog, one question at a time, top to bottom** (Session 25b): which kind of link (two cards in a radio group, as the stream's layout is chosen), then the link box, then what it holds, then **Save in**, with **Download** (`primary`) at the right of the footer. Nothing below a step shows until the step above is done: the link box appears once a kind is chosen; what it holds and **Save in** once the link has been looked at.
- **A kind not offered yet is shown, not hidden**: its card has a dashed edge, a **Not yet** badge and a muted title, cannot be chosen (it is skipped by Tab and the arrows), and its own words say why and what to do instead. The same rule will show qualities above the mandir's limit.
- **The link is checked as it is typed**, and said only once the typing or the paste stops (about half a second): a refusal in the field's error line, in words with what to do ("In Dropbox, use Share, then Copy link…"); a link that passes is looked at by itself, with "Looking at the link…" meanwhile. No **Check** button.
- **Where files are saved is a path, cut off to one line** (its tooltip has all of it), with **Choose…** and the promise under it: "Drashti never moves or deletes what it saves there."
- **While it goes**: a thin bar when the size is known, the words (bytes of bytes; or why it waits, in full, and that it goes on by itself), **Stop**, and a line saying the dialog can be closed. Closing never stops it; the status bar's word for it (`accent`, the download icon; `warning-fg` once one failed) opens the dialog again, in Pro Mode only.
- **When it is done**: "Saved N files in **folder**", the full path cut off below, the files as a short list, then **Made 1080p** and **Not taken** (each file with its reason) when there are any, then **Show in Finder** (**Show in Explorer** on Windows) and **See the import report**; **Another link** at the left of the footer. The import report of a link's files opens with an `info` notice saying where they were saved, with the same button.
- It passes the accessibility checks at 1280 × 720 (`tests/e2e/import-link.spec.ts`), and the screenshots are `docs/screenshots/import-link-*.png`.
