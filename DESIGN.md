# DESIGN.md — DAMS web UI

The visual system for `app/`, adopted in a full redesign pass. It replaces
the previous flat-border shadcn default theme with a near-black,
high-contrast theme built around three semantic accent hues and soft
ambient glow instead of hard borders for emphasis.

If you're asked to add or change UI and want it to look native to the app,
following this document should be enough — you shouldn't need to re-derive
the look from screenshots or prior conversation.

All tokens live in `app/src/index.css`. Everything below is a description
of what's there and why, not a separate source of truth — if this doc and
the CSS ever disagree, the CSS is what's shipping; update this file to match.

## Color tokens

Defined as CSS custom properties on `:root` (light) and `.dark` (dark,
default — see `app/src/main.tsx`'s `defaultTheme="dark"`), then re-exposed
as Tailwind utilities via `@theme inline` in `index.css`, exactly like the
shadcn baseline this was built from. Use the Tailwind utility
(`bg-card`, `text-muted-foreground`, `border-border`) in components; reach
for the raw `var(--...)` only where Tailwind can't reach (inline SVG
`fill`/`stroke`, `style` props, the d3-driven graph).

### Structural tokens

| Token | Dark | Light | Use |
|---|---|---|---|
| `--background` | `oklch(0.145 0.012 265)` (~`#0a0a0f`) | near-white, cool-tinted | Page ground |
| `--foreground` | `oklch(0.97 0.004 260)` | near-black | Primary text — high contrast against background |
| `--card` / `--popover` | `oklch(0.195–0.21 ... 265)` | white | Panels, cards, dropdowns — one step lighter than background in dark mode, so panels read as surfaces without a hard edge |
| `--muted` / `--muted-foreground` | dim surface / mid-gray text | pale surface / mid-gray text | Secondary content, captions, placeholders |
| `--border` / `--input` | `oklch(1 0 0 / 9%)` (hairline white) | `oklch(0.9 ...)` (hairline dark) | Low-contrast hairlines — never a strong outline. Emphasis comes from glow, not thicker borders |
| `--primary` | electric blue | deepened blue | Default button fill, links, ring color, user chat bubble tint |

### Semantic accent hues

Nine accent hues, each a CSS variable (`--accent-blue`, `--accent-violet`,
`--accent-teal`, `--accent-amber`, `--accent-rose`, `--accent-green`,
`--accent-cyan`, `--accent-fuchsia`, `--accent-indigo`), each re-exposed as
a Tailwind color (`bg-accent-blue`, `text-accent-teal`, etc. — see the
`--color-accent-*` block in `@theme inline`). They're defined identically
in both themes except for lightness/chroma tuned per background.

Three of the nine carry a structural meaning across the whole app — the
other six exist only to differentiate entity categories in the graph and
don't mean anything outside that context:

- **Blue** — product / the graph itself. Primary interactive color
  (`--primary` is blue), the app's brand mark (sidebar logo, page-header
  icon), and the `product` entity category.
- **Violet** — business / work / concepts. Used for the assistant's
  sparkle marker in chat and the `concept` entity category.
- **Teal** — storage / docs / features. Used for the `feature` entity
  category; reach for it first if you add a docs-adjacent accent.

Category → hue mapping lives in `CATEGORY_HUES` in `app/src/lib/memory.ts`
(`categoryColor(category)` resolves a category straight to its CSS var).
`other` deliberately gets no accent — it renders in
`var(--muted-foreground)` so uncategorized entities (common; see
`CLAUDE.md`'s note that categories aren't backfilled) don't visually
compete with intentionally-categorized ones.

Project sidebar icons cycle through all nine hues by hashing the project
slug (`app/src/lib/palette.ts`'s `hueFor`) — deterministic per project
regardless of list order, not tied to category semantics.

### Ambient glow

`body::before` / `body::after` in `index.css` paint three large, blurred,
low-opacity radial gradients (blue top-left, violet top-right, teal
bottom-center) fixed behind the whole app — the "soft ambient glow" the
theme is named for. Pure decoration: `pointer-events: none`,
`z-index: -1`, opacity driven by `--ambient-opacity` (0.16 dark, 0.05
light — light mode needs a much lighter touch or it looks dirty, not glowy).

Two small Tailwind v4 `@utility` helpers do the interactive glow work:

- **`.glow-ring`** — a permanent soft halo (colored box-shadow, no blur
  filter cost) around a fixed accent element: sidebar logo, project icons,
  the chat sparkle badge. Set `--glow-color` via inline `style` to pick
  the hue; strength is `--glow-strength` (0.55 dark / 0.14 light).
- **`.glow-hover`** — the same halo, but only `:hover`. This is the "soft
  hover glow on nodes and sidebar rows" from the motion spec — cheap
  because it's a plain CSS `:hover`, no JS, and nothing renders it until
  the pointer is actually there.

Graph nodes use a third mechanism (see below) because a `box-shadow` halo
doesn't read right on a small filled circle — they use `drop-shadow()`,
gated by CSS `:hover`/`[data-selected]`/`[data-match]`, never rendered at
rest. **Don't make glow always-on for many small elements** — hundreds of
permanently-blurred nodes is the one thing explicitly called out as a
perf risk; hover/selected-only glow is why the graph stays smooth with
hundreds of nodes.

## Spacing & radius

Radius is one scale, driven by a single `--radius` token
(`0.875rem` = 14px), with `--radius-sm/md/lg/xl` derived from it
(`-6px / -2px / +0 / +4px` → 8 / 12 / 14 / 18px). Bumping `--radius` alone
is what took every `rounded-md`/`rounded-lg`/`rounded-xl` in the app from
the old ~6–14px shadcn default into the 12–16px range the redesign calls
for — components didn't need per-class edits. Prefer `rounded-xl` for
panels/cards/dialogs and `rounded-lg`/`rounded-md` for buttons and small
controls; don't hand-pick pixel radii.

Spacing follows plain Tailwind scale (`gap-2`/`gap-3`/`gap-4`, `p-3`/`p-4`)
— no custom spacing tokens were introduced. Panel padding is `p-3`; page
padding is `p-4`; the two content panels sit in a `gap-4` grid.

## Typography

Unchanged from the pre-redesign baseline: Geist Variable
(`@fontsource-variable/geist`) via the `font-sans`/`font-heading` CSS
vars, loaded once in `index.css`. Scale is plain Tailwind text sizes —
`text-lg font-semibold` for page/project titles, `text-sm font-semibold`
for panel titles, `text-sm` for body copy, `text-xs text-muted-foreground`
for captions/metadata. No new type scale was introduced; don't add one
without a reason beyond this redesign.

## The memory graph (`MemoryGraph.tsx`)

Still a d3-force + d3-zoom simulation rendered into a single imperative
SVG (not a library, not individual React nodes) — that architecture didn't
change, only what gets drawn.

**Node.** A filled circle (`r=15`) in the entity's category color
(`categoryColor`), a `<foreignObject>` holding that category's lucide
icon (white, 16px, pre-rendered once per category via
`renderToStaticMarkup` at module load — see `ICON_MARKUP` — because
individual nodes are d3-owned DOM, not JSX, and can't render `<Icon />`
directly), and a text label offset to the right with a background-colored
stroke outline (`paint-order: stroke`) so it stays legible over the graph
regardless of what's behind it. No permanent ring or glow at rest — those
apply only on `:hover`, `[data-selected="true"]`, or `[data-match="true"]`
(search match), via the scoped `<style>` block at the top of the
component. This is a deliberate perf choice: with hundreds of nodes, an
always-on blurred `drop-shadow` on every circle would be the actual
bottleneck; gating it to hover/selection keeps the steady-state render
cheap regardless of graph size.

**Edge.** A quadratic Bézier (`M s Q control t`, control point offset
perpendicular to the straight line by 12% of the source→target vector) —
"soft curved lines," not straight `<line>` segments. Stroke is a single
shared `<linearGradient id="dams-link-fade">` (objectBoundingBox units, so
one `<defs>` entry serves every edge regardless of position or angle):
opaque near both ends, fading to 15% opacity at the midpoint — "muted,
lightens near the node." Arrowheads use the existing `dams-arrow` marker,
pulled back off the target node's radius so they don't visually overlap
the circle.

**There is no literal "You" node.** The reference mockup's central
anchor-with-radiating-satellites look is a property of *this app's* data
model at the cross-project level (a person's projects/ideas/goals fanning
out from them), which DAMS's graph doesn't model — each `MemoryGraph`
renders one project's own entities and relations, nothing above or across
projects. Force-directed layout with `forceManyBody` + `forceCenter`
naturally produces a similar radiating-cluster look for any reasonably
connected graph, without needing a fabricated node that doesn't correspond
to real data. Don't add a synthetic root/"You" node to make the layout
literally match the mockup — it would misrepresent what's actually in
memory.

**View modes.** Three, via the bottom-left floating toolbar
(`ViewMode = "network" | "grid" | "list"`): the force graph, a responsive
card grid (`EntityChip`, 2–4 columns by breakpoint), and a compact
vertical list of the same chips. All three open the same detail `Sheet`
on click. Grid/list are plain React (not d3) — the `<svg>` unmounts
entirely while they're active, which is also why zoom state resyncs to
100% only on the transition *back* into network mode (see the
`prevModeRef` effect), not on every re-render.

**Toolbar.** Bottom-left floating pill: three view-mode icon buttons,
then (network mode only) zoom out / live `{zoomPct}%` / zoom in / fit-to-
screen. Fit-to-screen computes the actual bounding box of current node
positions and picks a transform that frames them with padding — a real
fit, not a transform reset. Category legend sits bottom-right, network
mode only.

**External focus.** `focusRequest?: { id: string; nonce: number }` lets a
caller (chat citations) select a node and pan/zoom to it exactly like a
search match. `nonce` exists so the same id can be requested twice in a
row and still re-trigger — an id alone wouldn't change and the effect
wouldn't rerun.

## Layout: center graph panel + right Chat/Docs panel

`ProjectView.tsx` is a CSS grid, not stacked tabs: `grid-cols-[1fr_400px]`
on `lg+`, collapsing to a single column with explicit row heights
(`grid-rows-[minmax(320px,1fr)_420px]`) below that. **Use a sized grid
here, not `flex-col` with `flex-1` children** — the panels' own internal
`ScrollArea`s need a definite ancestor height to size against; an
unconstrained flex-column stack lets them collapse to their content's
minimum height instead of filling the available space. This bit before —
don't reintroduce it.

- **Center panel** — its own header (icon + "Memory Graph" title/caption),
  a pill `Tabs` (`variant="default"`, the segmented-control look) for
  Graph / List / Prompts, and a fullscreen toggle that renders the same
  panel in a `fixed inset-4 z-50` overlay (closable via the button or
  `Escape`). List is the existing `EntriesTable`; Prompts is the existing
  seed/sync prompt panel — both were top-level tabs before this redesign
  and are now pages of the center panel instead, alongside Graph.
- **Right panel** — underline `Tabs` (`variant="line"`) for Chat / Docs,
  Chat first and default. `DocsPanel` gets a `compact` prop here that
  forces its mobile (sheet-based file picker) layout regardless of
  viewport width, because the right panel is fixed at 400px — too narrow
  for its desktop two-column layout.

Use the pill (`default`) `TabsList` variant for switching between *views
of the same subject* (Graph/List/Prompts are all views into one project's
memory); use the line/underline variant for switching between *different
kinds of panel content* (Chat vs. Docs). That's the distinction to keep if
a third panel gets added later.

## Sidebar (`AppSidebar.tsx`)

Each project row: a 40px rounded-xl colored square (`ProjectIcon` — the
project's title initial on a tinted version of its hashed accent hue,
with a permanent `.glow-ring`), title, one-line subtitle (project summary,
falling back to its tags, falling back to "No description yet" — never
blank), and a pill count badge on the right showing `entityCount`. Active
row gets `bg-sidebar-accent`. Search input has a visible `⌘K` `<kbd>` hint
inline (not just a tooltip) and its `id` (`SIDEBAR_SEARCH_ID`, exported)
is how the global shortcut focuses it — see below. The "+" new-project
button sits next to search, not buried in the footer; `CreateProjectDialog`
now takes controlled `open`/`onOpenChange` and a `hideTrigger` flag so
both the sidebar's "+" and (if ever needed elsewhere) another trigger can
open the same dialog instance.

## Chat panel

Assistant replies get a small circular sparkle badge (violet-glowing,
`.glow-ring`) to their left instead of just being left-aligned — the
"who's talking" marker from the spec. User messages are right-aligned and
*tinted* (`bg-primary/12` + `border-primary/25`), not a solid fill —
"tinted," not "solid," is the operative word if you touch this.

Citations render as a bordered "Key references" card under the reply:
each source gets an icon by memory-entry type (`FileText`/entity,
`GitBranch`/relation, `StickyNote`/observation), colored by category when
it resolves to one, and the summary text `ChatSource` already carries.
**There's no per-source project name, date, or page number** — unlike the
reference mockup, `ChatSource` (`src/modules/chat/schema.ts`) only carries
`{ id, type, summary }`, and citations only ever point at this project's
own memory entries, never at docs (`ChatService` never cites a doc — see
`extractSources`). Don't fabricate those fields client-side; if per-source
dates matter, that's a backend schema change, not a UI one.

A citation is clickable when it resolves to an entity
(`resolveSourceEntity` in `lib/memory.ts` — direct entity match, an
observation's `entity` field, or a relation's `source`) and jumps the
center panel to Graph + focuses that node via `focusRequest`. Sources that
don't resolve (e.g. a superseded/orphaned reference) render inert, not as
a dead-looking button.

## Icon usage

Lucide only, project-wide — no new icon set. A few rules that keep it
consistent:

- Entity categories always use `CATEGORY_ICONS` (`lib/memory.ts`) — never
  pick an ad hoc icon for a category in a new component; import the map.
- A colored accent badge (project icon, chat sparkle, panel-header icon)
  is a small rounded square/circle at `size-7`–`size-10`, tinted
  background (`color-mix(in oklch, <hue> 15–22%, var(--card))` or
  `var(--primary)` outright for the single brand mark), `.glow-ring`
  applied, icon itself rendered at `size-4` in a contrasting color (white
  on a solid fill, the hue itself on a tinted fill).
- Toolbar/action icons are bare (`variant="ghost"` or `"outline"` button,
  `size-icon-sm`/`size-icon`), no colored badge — badges are reserved for
  identity (whose project, whose message), not actions.

## Motion

No new global transition-duration tokens; standard Tailwind durations
(150–200ms, `ease`) used directly, matching what `.glow-hover` and the
graph's node-hover CSS already use. Keep new hover/selection transitions
in that ~150–200ms range — anything slower reads as sluggish on a hover
state, anything instant loses the "soft" quality the theme is going for.
Panel/dialog open-close animation is unchanged shadcn/Radix defaults
(`data-open`/`data-closed` animate-in/out utilities from `tw-animate-css`).

## Keyboard shortcuts

| Shortcut | Effect | Implemented in |
|---|---|---|
| `⌘K` / `Ctrl+K` | Focus project search (opens the sidebar first on mobile) | `App.tsx`'s `GlobalShortcuts` |
| `⌘/` or `?` | Open the shortcuts help dialog | `App.tsx`'s `GlobalShortcuts`, `ShortcutsHelp.tsx` |
| `G` then `L` | Toggle the center panel between Graph and List | `ProjectView.tsx`, via `hooks/use-key-sequence.ts` |
| `⌘⏎` / `Ctrl+⏎` | Send the current chat message | `ChatPanel.tsx`'s `handleKeyDown` (plain `Enter` already submits too — this is the explicit extra binding) |
| `Esc` | Close the fullscreen graph panel, dialogs, sheets | `ProjectView.tsx` for fullscreen; dialogs/sheets get it free from Radix |

`use-key-sequence.ts`'s `useKeySequence` is the general primitive for
`G`-then-`L`-style chords: it ignores keystrokes while an
input/textarea/contenteditable has focus (so typing "g" or "l" in a text
field never triggers it) and resets if the next key doesn't continue the
sequence within 800ms. Reuse it for any future chord shortcut rather than
hand-rolling key-tracking state again.
