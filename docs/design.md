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
- **Middle:** the chosen presentation's slides as thumbnails in groups, with the group colour beside each group's name.
- **Right:** Live, Next and the stage screen, then the props, messages and timers panels.
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
