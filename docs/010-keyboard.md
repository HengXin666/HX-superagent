# 010 Keyboard and accessibility

Everything in the panel can be done from the keyboard. Each interactive component follows the matching pattern of the WAI-ARIA Authoring Practices (APG). This page is the contract: the keyboard model of every component, the one focus ring, where focus goes when something opens or closes, and the checks that keep all of it true. [005 Panel](005-panel.md) describes the pages these components make up.

## Rules for every component

- **One Tab stop per widget.** A composite widget (tab list, radio group, listbox, table rows, chip list) is a single Tab stop. Arrow keys move inside it with a roving `tabindex`: the chosen or current item has `tabindex=0` and the others have `-1`. Tab leaves the widget.
- **Arrows choose where choosing is cheap.** Tabs and radio groups use automatic activation, so moving to an item chooses it. Lists that open something (a listbox, table rows) move a highlight, and Enter acts on it.
- **Ends wrap, disabled items are skipped.** Home and End go to the first and last enabled item.
- **Escape closes the innermost layer only.** A tooltip, popover or listbox stops the key there, so the dialog or drawer under it stays open.
- **No keyboard trap.** Only modal layers (Modal, ConfirmDialog, Drawer, the command palette) keep Tab inside, and Escape always closes them. A field that takes Tab for itself (the code editor) always has a documented way out.
- **Shortcuts show the platform's key.** `Kbd` and `aria-keyshortcuts` say ⌘ on Apple platforms and Ctrl elsewhere.

## Component keyboard models

| Component | Pattern (APG) | Keys |
|---|---|---|
| `Button`, `IconButton` | Button | Enter and Space activate. A busy button stays focusable but does nothing |
| `Switch` | Switch | Space and Enter toggle |
| `Tabs`, `PageTabs`, `FilterTabs` | Tabs (horizontal, automatic activation) | ←/→ move and choose, Home/End, wrap, disabled tabs skipped. `aria-controls` points only at the panel that is rendered |
| `TabPanel` | Tabs | A Tab stop (`tabindex=0`) so a panel with no control can still be reached and read |
| `SegmentedControl` | Radio group | ←/→ and ↑/↓ move and choose, Home/End, wrap. One Tab stop |
| `RadioGroup` | Radio group | As `SegmentedControl`, disabled items skipped. One Tab stop, on the chosen item (the first enabled one when none is chosen) |
| `CheckboxGroup` | Checkbox (group) | Each item a Tab stop; Space and Enter toggle, with `aria-checked`. The group is named by its field label or its own `label` |
| `Pill` | Toggle button | Enter and Space toggle, with `aria-pressed` |
| `DisclosureRow` | Disclosure | Enter and Space show or hide, with `aria-expanded`; while open, `aria-controls` points at the content it shows |
| `Select` | Select-only combobox | ↓/↑/Enter/Space open; ↑/↓/Home/End move; Enter or Space picks; typing jumps by first letters; Escape closes without changing; Tab closes. Focus stays on the button |
| `Combobox` | Editable combobox with list autocomplete | ↓/↑ open and move; Enter picks (or commits typed text with `allowCustom`); Escape closes, then reverts to the committed value; Tab commits |
| `MultiSelect` | Combobox plus a chip list | In the input as `Combobox`; Backspace in an empty input goes to the last chip. On a chip: ←/→ move between chips, Alt+←/→ (or Alt+↑/↓) reorder and announce the new position, Delete/Backspace remove. Removing the last chip puts focus back in the input |
| `DataTable` | Table with row navigation | Sort headers are buttons. Rows: ↑/↓/Home/End/PageUp/PageDown move, Enter opens. One Tab stop for the rows |
| `Modal`, `ConfirmDialog` | Dialog (modal) | Focus moves in on open (to a field that took it, the initial target, or the dialog itself); Tab and Shift+Tab stay inside; Escape closes. A dangerous confirmation focuses Cancel first |
| `Drawer` | Dialog (modal) | As Modal. When it shows another item without closing, focus moves back to the drawer |
| `Popover` | Dialog (non-modal) | Escape closes and returns focus to the trigger; a click outside closes |
| `Tooltip`, `InfoTip` | Tooltip | Shown on hover or keyboard focus (focus-visible only); Escape hides it without closing anything else |
| Skip link | Link (WCAG 2.4.1 bypass blocks) | The panel's first Tab stop, hidden until focused; Enter moves focus to the page's main region, so the next Tab is the page's first control |
| Command palette | Combobox in a modal dialog | ⌘K / Ctrl+K, or `/` outside a field, opens it; ↑/↓ move; Enter runs; Escape closes |
| `CodeEditor` (CodeMirror) | Multi-line text box | Tab indents, so an editable editor tells screen readers its way out (`aria-describedby`): Escape, then Tab within 2 s, leaves it, and Ctrl+M (Shift+Alt+M on macOS) makes Tab move focus until pressed again. That first Escape stops in the editor; a second one closes the dialog or drawer around it. A read-only editor never takes Tab. Where CodeMirror cannot lay out, a plain text area |
| `TagInput` | Text field plus a list of remove buttons | Space, comma or Enter turns the typed name into a chip; Backspace in the empty field takes the last chip back to edit; each chip's × is a button in the Tab order |

## Focus ring

There is one ring, drawn by one rule in `src/client/ui/ui.css` for the panel and every layer it portals (dialogs, popovers, listboxes, toasts): `outline: var(--hx-ui-focus-outline)` at `--hx-ui-focus-offset`, shown on `:focus-visible` only.

- `--hx-ui-focus-color` is the brand color (`--hx-c-brand-primary`, which DSH flips for dark mode). The ring is solid, not translucent, so it keeps 3:1 against the surface (WCAG 2.4.11).
- In forced-colors mode the ring uses the system `Highlight` color.
- A component never draws its own ring. One that needs another position sets only `outline-offset` from `--hx-ui-focus-offset` or `--hx-ui-focus-offset-inset` (rows, the settings navigation). The component layer in `src/client/ui/tokens.css` declares no focus token of its own (the old per-component box-shadow rings `--hx-btn-focus`, `--hx-tab-focus` and the like are gone, with `--hx-ui-focus-ring` and `--hx-ui-focus-inset`), so there is nothing a component could draw a second ring from. A field drawn inside a wrapper (`Input`, `Combobox`, tag input, code editor) puts the ring on the wrapper with `:has(:focus-visible)`.
- Only surfaces that take focus as a fallback (the dialog and drawer surfaces, the page's main region) and the inner fields of a wrapper hide the ring.

`tests/styles.spec.ts` fails on any focus rule that adds a box-shadow ring, a literal outline, or an offset outside the tokens.

## Where focus goes

- **Skipping to the content**: the skip link sends focus to the page's main region (`#dt-page`), past the header and the page tabs.
- **Opening a layer** moves focus into it (see Modal above). The element that had focus is remembered, even when a field inside took focus on mount.
- **Closing a layer** returns focus to that element. When it is gone (the row was removed by a live refresh, or the layer was opened from another layer that has closed), focus goes to the page's main region (`[data-focus-fallback]`), never to `<body>`.
- **Following a link inside a page** unmounts the element that had focus; focus then moves to the new page's main region, so Tab continues from the top of the page.
- **Removing an item** (a chip, a row) moves focus to the item that took its place, or to the input when none is left.
- **Saving a settings block** returns focus to the field that had it (see `tests/panel-settings.spec.tsx`).

## Checks

- `tests/a11y.spec.tsx` runs axe-core (a dev dependency, pinned) on every page, every settings group, the open command palette and a Ticket open in the drawer, and fails on any `critical` or `serious` violation. Color contrast, target size and the host document's `<title>` and `lang` are outside what jsdom can judge or what the panel owns. Contrast is checked in the light and dark screenshot pass.
- `tests/a11y-layers.spec.tsx` runs the same check (`tests/fixtures/axe.ts`) on each component in its open state, which a page at rest never shows: an open Select listbox and Combobox list, a Popover and a Tooltip, a Modal, a ConfirmDialog and a Drawer, and the composite controls at rest.
- `tests/keyboard.spec.tsx` is the keyboard-only acceptance. It drives the panel only through `tests/fixtures/keyboard.ts` (Tab order, Enter, Space, arrows, Escape and typing; no clicks and no direct focus) and covers: the skip link, moving through every page, opening a Ticket from the list and closing it with focus back on its row, the command palette, changing and saving a setting, reordering a capability pack chain with Alt+arrows and saving the new order, and on every page no trap and no control that neither Tab nor its widget's arrows can reach.
- `tests/ui.spec.tsx` covers each component's keys and focus return in isolation. `tests/code-editor.spec.tsx` covers the code editor's way out, which jsdom's text-area fallback cannot show in the page-level tests.

When you add a component or a page control, give it a row in the table above, follow its APG pattern, and extend these tests if it adds a new kind of flow.
