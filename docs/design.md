# Drashti design rules

These are the rules for Drashti's operator UI. Later sessions follow them, and change this file when a rule changes. The tokens are in `src/renderer/src/styles/app.css`, the shared components in `src/renderer/src/ui/`, and the **component gallery** shows each one in every state: **Diagnostics > Component Gallery** (start Drashti with `DRASHTI_DIAGNOSTICS=1`), or `/gallery.html` under `pnpm dev`. Any new shared component goes into the gallery too. `tests/e2e/design.spec.ts` runs the accessibility checks on the gallery.

Write our own code. The design skills in the workspace (`ui-ux-pro-max-skill/`, `bencium-*`, `skills/`) are for ideas only; nothing is copied into `app/` from them, from 21st.dev or from anywhere else.

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

**Contrast** (WCAG 2.2 AA, measured): `fg` 15:1 and `muted` 7:1 on panels, and `faint` at least 4.5:1 on every surface. White on `live` is 5.0:1, white on `accent-strong` 5.2:1, `field` edges 3.2 to 3.5:1, and the focus ring 5.3 to 7:1. Text is never quieter than `faint`. Never put text on a surface with an opacity modifier (`text-fg/60`), because axe measures the mix. Run the accessibility checks after any colour change.

Group colours (Verse, Chorus…) come from the presentation, so they are shown as a swatch beside the group's name, never behind text.

## 3. "Live" is one colour plus a label

Anything on the screens now uses the `live` colour **and** says so in words: the `LiveBadge` ("LIVE"), "BLACK-OUT", "ON SCREENS", "Logo is on". Colour alone never carries the meaning (WCAG 1.4.1, and colour-blind volunteers):

- a live slide thumbnail has a `live` border **and** a LIVE label in its caption;
- a live row in a list (presentation, playlist item) has a `LiveBadge`;
- a layer clear is lit when its layer has something up: `live` edge and a dot, and the words "On screen" read out (`aria-label`);
- a button that is "on" (black-out, a prop shown) uses the `live` variant **and** changes its words ("Black-out is on", "Hide").

Nothing else uses `live`: errors use `danger` and warnings `warning`.

## 4. Type

- **The fonts are bundled Noto Sans, Noto Sans Gujarati and Noto Sans Devanagari** (`--font-sans`), so names in English, Gujarati and Hindi all look right offline. The weights are **400, 500 and 700**; use `font-normal`, `font-medium` and `font-bold`. `font-semibold` (600) is not bundled and renders as 700.
- Body text is 14 px (`text-sm`); small text 12 px (`text-xs`); the smallest is 11 px (`text-2xs`, for badges and panel titles only). Dialog titles are `text-lg`, page titles `text-2xl`. Simple Mode uses `text-xl` to `text-3xl`.
- Line height is at least 1.45 (the body default), even in one-line rows: Gujarati and Devanagari marks sit above and below the line, and a tight line cuts them off.
- Panel titles and section titles are 11 px bold capitals with wide tracking (`SectionTitle`, `Panel`). Nothing else is in capitals.
- Numbers that change (timers, counts) use `tabular-nums`.

## 5. Space, size and corners

- Spacing follows Tailwind's 4 px steps. Use 1, 1.5, 2, 3, 4, 5, 6 and 8 (4 to 32 px). Gaps inside a control are 1 to 2, between controls 2 to 3, and between sections 4 to 6.
- **Control heights:** `sm` 28 px (panels), `md` 32 px (the default), `lg` 40 px (dialogs, live controls), `xl` 64 px and `xxl` 96 px (Simple Mode). Nothing clickable is smaller than 24 × 24 px (WCAG 2.5.8).
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

**Icons** are Lucide (ISC, `LICENSES/icons/`). Import them only from `ui/icons.ts`, and add a new one there. Use 14 px in small controls, 16 px by default, and larger in Simple Mode. An icon is decoration (`aria-hidden`) unless it is the whole button, and then the button has a label.

## 7. Every place has its states

Every list, panel and dialog shows:

- **empty**: what goes here and how to add it (`EmptyState`);
- **loading**: when it waits for the main process (`Loading`), never a blank;
- **error**: what failed and what to do (`ErrorState` or a `Notice`), in plain words a volunteer understands, never a code;
- **long names**: cut off neatly (`Truncate`) and shown in full on hover.

## 8. Keyboard and screen readers

- Everything works from the keyboard. The focus ring (`accent`, 2 px) is drawn by the base styles on every `:focus-visible` element; don't remove it, and if a component draws its own (the Splitter), it must be as visible.
- The show's keys (`src/shared/keymap.ts`) are ignored while a field has the focus or a dialog is open (`aria-modal`).
- Lists you move through with the arrows use roving focus (Tabs, menus); long lists are virtual, so only the rows in view exist.
- Every control has a name: its text, its `Field` label, or an `aria-label`. Icon buttons have their label as a tooltip too.
- Things that change on their own (what's live, import progress, notices) are in `aria-live` regions or have the status/alert role.
- `tests/e2e` runs axe-core (`tests/e2e/a11y.ts`) on the operator window, Simple Mode, each panel and the gallery, and fails on any serious or critical finding.

## 9. Layout of the operator window

There are three columns between a header and a footer:

- **Left:** playlists above, and the library (presentations, media) below.
- **Middle:** the chosen presentation's slides as thumbnails in one grid, in play order, flowing on from one group to the next. Each thumbnail has its group's colour as a strip beside its number, and the first slide each time a group comes up carries the group's name. The thumbnail size (120 to 400 px, 170 at first) is remembered: at 170 three slides fit a row at 1280 × 720 and six at 1920 × 1080.
- **Right:** Live and Next, then the Looks, the stage screen, and the props, messages and timers panels.
- **Along the bottom:** the layer clears and black-out. Under them is the status bar: screens connected, the sound output, import progress and notices.

The columns are resized with `Splitter`s and the sizes are remembered on the computer (`ui/persist.ts`). Everything fits at 1280 × 720 with nothing cut off or overlapping. Simple Mode is one screen with big buttons, and fits at 1280 × 720 too.

## 10. Simple Mode

Simple Mode (`src/renderer/src/simple/`) is for a volunteer who has never used Drashti:

- **One screen, nothing to find.** The playlist sits on the left with its headers. In the middle are what's live and what's next. The big buttons run along the bottom: Back, Next (the biggest, `primary`), Black out, Logo, and Clear all. After Clear all, that button turns into **Put it back** (`warning`).
- **Big targets.** The buttons are `xl` and `xxl` (64 and 96 px high), playlist rows are at least 56 px, and text is at least 16 px except the key hints.
- **States in words.** Black out and Logo use the `live` variant when on, and their words change ("Black out is on", "Logo is on"). The live playlist row has a LiveBadge.
- **Nothing that changes anything.** No editing, removing, importing, themes, screens, sound or backups. Don't add a control here that changes the library or the setup. The main process refuses those requests in Simple Mode anyway (`src/main/simple-mode.ts`).
- **Undo comes first.** Back undoes the last Next exactly, and Put it back undoes Clear all. Every new action in Simple Mode needs a way to undo it, in one press.
- It fits 1280 × 720 with nothing scrolling (`tests/e2e/simple-mode.spec.ts`).

## 11. The slide editor

The slide editor (`src/renderer/src/editor/`) covers the operator window, as Edit words does, so nothing behind it can be pressed by mistake. Along the top: its name, Undo and Redo, what can be added (Words, Shape, Picture or video), then Cancel and Save (the primary button; **Done** when nothing has changed). Below: the slides on the left, the slide in the middle, the inspector on the right.

- **The slide is drawn by the slide renderer**, scaled to fit, so what is seen is what the screens show. Selection is the `accent` colour: an outline round each selected element, square white handles to resize one and a round one above it to turn it, all a constant size on screen. Snapping guides are `guide` (a pink that shows on any slide), across the whole slide.
- **The keyboard.** The slide is one focus stop (`role="application"`, with its keys in its label): Tab chooses the next element and, after the last, moves on to the inspector, so keyboard users are never trapped. A polite live region says what is selected, where and how big. Esc steps back one stage at a time: typing, then the selection, then the editor (asking first when there are changes).
- **The inspector** groups its fields in titled sections (Selected, Place and size, Words, Shape, Picture/Video). Numbers change as they are typed; colours use the system picker. It says whether text styles go to the whole box or to the selected words.
- **Typing in place** shows a dashed `accent` outline round the box; the words keep their look while typed.
- **Several selected** keep their own outlines and get one dashed `accent` box round them all, with the same square handles and round handle, which act on them together (snapping as one); "2 elements selected" is read out. Copy, Cut and Paste are the Edit menu's (and their keys); "Copied 1 element." shows in the editor's note line.
- Questions use the usual alert dialogs: "Throw away the changes?" (Keep editing has the focus) and "Save over the other change?".
- It fits at 1280 × 720 with nothing cut off, and axe finds nothing serious, also while typing (`tests/e2e/editor.spec.ts`).

## 12. Kirtans and their languages

- **Missing is a state, not a blank.** In Edit words, By language, a slide with nothing in a language shows that field with a dashed `warning` border, a `warning` tint and a **Missing** badge by the language's name (the field's own label says "(missing)" for screen readers). An empty field is never shown as if it were a line with no words.
- **A kirtan's languages are named, never flagged by colour alone.** Track names are the words Gujarati, Hindi, English and Transliteration (`LANG_NAMES`); short tags (GU, HI, EN, TR) appear only as badges on library rows.
- **Choosing a screen's languages** (`screens/LanguagePicker.tsx`): two radio buttons, "All, in each slide's order" and "Only these, in this order"; then one row per language with a tick box and, when ticked, Earlier and Later arrows (icon buttons with those words as labels). The last language ticked cannot be unticked. The same picker goes in Screens and the setup wizard.
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
- **Pages on phones are phone-first**: the design system's dark look, 16 px or larger type, touch targets at least 44 px, everything in one column, and nothing that needs a hover.
- **The remote is one screen**: a header with the device's name and its connection chip (Connected in green, Connecting…, or Not connected with when it tries again, always in words), a middle that scrolls, and Back and Next below it (xl buttons, Next primary), so nothing ever scrolls under them. On a phone the middle is three tabs (Show, Playlist, and More: the Looks when there are two or more, timers and messages) with a tab bar under Back and Next; from 768 px wide the playlist sits beside the show and there are no tabs.
- **On the remote, LIVE is the live red, as everywhere**: the live slide's thumbnail and the live playlist item have a live border and the LIVE badge; Black-out and Logo are pressed (aria-pressed) in the live colour while on; Put it back turns warning when it can.
- **Thumbnails on a phone** draw the slide with the outputs' renderer; pictures and video are previews, grey until they load.
- **The stage display is the stage screen**, on black, with nothing else but a quiet Full screen button (until it is full screen) and, while the connection is down, one small warning line in a corner over the last picture.
- **The announcements page is one short form**: the words (a large text box with how many characters are left), who it is from, how long to show it, and one large Send. Below it, "What you sent" lists the phone's own announcements with what became of each, in words and colour: Waiting for the operator (warning), On the screens until 5:12 pm (live), Shown or Not shown (neutral).
- **The Announcements queue is a sheet on the right**, like Phones, opened from a header button that appears while the network is on and turns warning with how many are waiting ("Announcements (2)"). Each waiting announcement is a card: its words large, who sent it, from which device, when and for how long, then the choice of how it goes up (In the ticker or As a message, and the template), Approve (primary), Edit and Reject (danger). On the screens, a card says On the screens (live) or Cleared from the screens (warning), when it comes off, and Take off. Earlier ones are one line each.
- **The ticker is a band along the bottom of the audience screens**: 7.5 % of the canvas high, near-black at 80 % with a thin light line along its top, white words at the messages' size and weight, moving from right to left at about 130 px a second on a 1080-line screen. Messages sit just above it while it shows. It is in the layer bar as "Ticker" (F8), lit while it is on.
- The panel fits at 1280 × 720, the pairing page at 375 × 812, and the remote passes the accessibility checks on a phone and on a tablet (`tests/e2e/network-pairing.spec.ts`, `tests/e2e/remote.spec.ts`). The announcements page passes them at 375 × 812, on a phone and on a tablet, and the queue fits at 1280 × 720 (`tests/e2e/announcements.spec.ts`).

## 17. Looks

- **Switching is a show action, so it sits with the live controls.** The Looks panel under Next is one button per Look, in the list's order. The live Look's button is `live` (red, white text) with a white dot and `aria-pressed="true"`; the others are plain. A Look is never switched by a key alone: it takes a click (or a phone's tap, or the API).
- **Changing a Look is setup, so it lives in Screens.** At the top of Screen groups, the Looks are tabs (`Tabs`, `sm`), the live one with a **Live** badge. Below the tabs: the chosen Look's name (a field, saved on Enter or leaving it), **Duplicate**, **Earlier** and **Later** (the first is the one Drashti starts with), and **Remove** (`danger`, asking first, and saying whether the screens will change). Each group card then shows "In the Look “…”" with that group's settings: layers as tick boxes, how slides are drawn, and the languages picker. Stage groups show only their languages; the stream group only its languages.
- **Simple Mode never shows either.** It keeps the live Look.

## 18. Stage layouts

- **Standard stays as it was.** It is built in, shown first in the editor's list as "Standard (built in)", drawn by the same StageView, and cannot be changed: an `info` notice says so and offers Duplicate.
- **The editor is a large dialog** (`size="full"`): the layouts on the left, the layout in the middle drawn by the same renderer as the stage screens (with what is live now), the chosen box's settings on the right. Boxes are dashed outlines; the chosen one is an `accent` outline with square white handles; snapping guides are `guide`, as in the slide editor (`boxes/BoxCanvas.tsx` serves both editors). The canvas is one focus stop: Tab chooses the next box and the arrows move it; place and size are also number fields, so nothing needs a mouse. Changes are kept until **Save**; leaving with changes asks first.
- **Boxes say what they show in words**, in the list of boxes and the canvas's spoken status ("Clock chosen, at 962, 186, 710 by 130").

## 19. Masks

- **Two kinds, said plainly.** In Screens a group's mask is "Mask (these screens' own shape)"; in the right column the **Masks** panel puts a mask up for a moment. The panel's buttons are like the Looks panel's: the mask that is up is `live` (red) with `aria-pressed="true"`, and pressing it again takes it down (as F7 does).
- **The mask editor is the stage layout editor's twin** (`size="full"`, the same `BoxCanvas`): the masks on the left, the mask in the middle over a blue test grid (what it lets through) on black (what it hides), the chosen shape's settings on the right, Save at the bottom. "Hide what is inside them" and "Show only what is inside them" are two radio buttons, in words.

## 20. Key and fill

- **A group role like the others**, "Key and fill (for a video switcher)", with a short line under it saying what the two displays are and how to set the switcher. Each screen in the group says what it sends ("The fill (the picture)", "The key (white where the fill has something)") in a select beside it.
- **The key is not a picture to look at**: it is only on its output. The operator's previews never show it.

## 21. Macros and MIDI

- **A macro is a coloured button.** In the Macros panel each macro is a two-column button with a strip of its colour and its name; a click runs it at once (it is a show action, like Next). Its colour is chosen from a few that read on the dark panels.
- **The macro editor lists actions as plain sentences in order**: the action's name, then its choices (a Look, a prop, a template and its fields…), with Earlier, Later and Remove as icon buttons with those words as their labels. Only actions a macro may do are offered.
- **MIDI says what it heard.** The MIDI dialog shows the device and whether it is connected (in words), every action with what it is mapped to ("Note 36, channel 1") and Learn, and a live line with the last note or controller the controller sent, so an operator can see the pad is reaching Drashti.

## 22. Shastra

- **A tab of the library, not a mode.** The Shastra tab sits beside Presentations and Media in the left column: the reference box first (with **Show**), then search, then the texts to browse, and **Texts…** at the foot. A reference that names nothing says why in a `warning-fg` line under the box (`role="status"`), never a dialog; the box keeps what was typed, to fix.
- **A passage is shown like a presentation.** It fills the slide grid with a group per item, named by its reference ("Placeholder Granth 14"), and a line in the header says it is a Shastra passage. Edit words, Kirtan and Edit slides are not offered: its slides are made from the text. Rows in the Shastra tab, search results and browsed items alike, can be dragged onto a playlist.
- **Texts… is setup** (Pro Mode): a table of the loaded texts with their abbreviation ("Type “PG” and a number"), items, languages as badges, a theme select, and **Remove** (`ghost`, asking first in an `alertdialog`). The subtitle says that only authorised texts are loaded.
- **Sanskrit's two scripts are named in full** everywhere a language is chosen: "Sanskrit (Devanagari)" and "Sanskrit (Gujarati script)"; badges are `SA` and `SA·GU`.

## 23. The arti at its time

- **A strip, not a dialog.** The arti prompt is a `warning-bg` strip across the operator window under the header, never modal: the show goes on under it, and Next keeps working. It names the arti, counts down to it (tabular figures), and offers **Put up Arti now** (`primary`, the only primary there) and **Not now**. When a schedule goes up by itself, it says so in words ("goes up by itself in ten seconds") with **Cancel** beside the count.
- **Screen readers hear it once per step.** The sentence (coming up; it is time; going up by itself) is a `role="status"` that changes only when the step does; the ticking count beside it is hidden from them, so nothing is read out every second.
- **Simple Mode: one big button.** The same strip sits above the big buttons with an `xxl` **Put up Arti now** and an `xl` **Not now**; there is nothing to set there.
- **Times are set in the live column.** The Arti panel lists each time as its name, "Every day 19:00" or "Sun, Wed 19:00", when it next prompts, and its presentation; a switch turns one off; **By itself** is a `warning` badge. A removed presentation says so in `warning-fg` on its row.
