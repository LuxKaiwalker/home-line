# HOMELINE search block (Cmd-K)

Spec in the repo for the search block (Notion "HOMELINE search block", approved Sun 15 Nov 13:05).
Base branch `design` (41ebc28). Packages: S2 registry, S3a queries part 1, S1 index expansion,
S3b queries part 2, S4 palette UX, S5 tests (in every package). Everything below was checked against the
code at 41ebc28. "Not found" means that no callable exists today and the owner has to confirm one.

## 1. Purpose and rules

Goal: **press Cmd-K and type what you want: a place, an action or a question.**

| Kind | Scope |
| --- | --- |
| FIND | overlays and highlight areas (ridges, mineral hints, blocked areas), legs ("leg 3", "S7 → S6"), timeline events (turn-back, arrivals, alarms), scenarios, report sections and evidence items, glossary terms, saved plans in My plans; plus today's pad, parking options, stations, sites, landmarks |
| DO | every shortcut and menu action, registered once (section 3) |
| ASK | `t 45` / `at 01:20`, `route S4 S1 S6`, `stations within 30 min`, `time home here` / `time home 137.39, -4.77`, `margin below 10 min` |
| COORDINATES | decimal lon/lat (either order), DMS, planner metres from the pad (section 2.4) |
| OUT | language models, network search, share-code search (D69), new data files |

| # | Rule |
| --- | --- |
| 1 | A pattern grammar, not an LLM. Text that matches no pattern goes to fuzzy search (`rank()`). |
| 2 | Honest numbers. A number in a row comes from a manifest-backed file, shown by `<Num>` (`components/Num.tsx`) with its TrustChip, or from a field lookup (`fieldAt`) labelled "estimate". No new validated number. The value snapshot stays unchanged. |
| 3 | Nothing changes until a row is chosen. Typing and arrowing only preview inside the list: no map highlight, no timeline jump, no replay interruption. Choosing acts through existing stores, so undo works. |
| 4 | Live-only rows appear only when the API is reachable (`liveStatus`). Otherwise the row is shown disabled with the reason. |
| 5 | Under 16 ms per keystroke with the full index. The index builds after the intro has started and never delays the loading screen or the intro (L12). |
| 6 | Keyboard first: Cmd/Ctrl-K (and `/`) opens, ↑/↓ move, Enter runs, Tab completes a pattern, Esc closes, `?` lists the patterns. Every row has a screen-reader label. |
| 7 | Tokens only, Lucide icons from `ui/icons/names.gen.ts`, copy from the copy deck (`search.*`, `commands.*`), mouse mapping I1 untouched, design rules 1–12 (`docs/design-agents.md`). |

## 2. Grammar

### 2.1 Normalisation (before every pattern)
`q = input.trim().toLowerCase().normalize('NFKC')`, then collapse runs of spaces to one space.
Arrows `→`, `->` and `–>` become `→`. `′` becomes `'` and `″` becomes `"`. In this section, `NUM` = `[-+]?\d+(?:\.\d+)?`,
`STOP` = a station id from `stations.json` (today S1, S2, S4, S6, S7, S8), matched case-insensitively.

### 2.2 Precedence (first match wins; the order of `PATTERNS`)

| # | Pattern id | Regex (on normalised `q`) | Examples | Tab prefix |
| --- | --- | --- | --- | --- |
| 0 | help | `^\?$` | `?` | — |
| 1 | coords (DMS) | `^(\d{1,3})°\s*(\d{1,2})'\s*(\d{1,2}(?:\.\d+)?)"?\s*([ensw])[\s,;]+(\d{1,3})°\s*(\d{1,2})'\s*(\d{1,2}(?:\.\d+)?)"?\s*([ensw])$`, where one hemisphere letter is E/W and the other is N/S, in either order | `137°23'36"E 4°46'35"S`, `4°46'35"S, 137°23'36"E` | — |
| 1 | coords (planner m) | `^x\s*(NUM)\s*(?:m)?[\s,;]+y\s*(NUM)\s*(?:m)?$` | `x 120 y -40`, `x -300m, y 85m` | `x ` |
| 1 | coords (decimal) | existing `parseCoordinates` (`search.ts`): two `NUM`s split by `[\s,;]+`, `°` stripped. The value outside ±90 is the longitude, and a match is accepted only when that is unambiguous | `137.39, -4.77`, `-4.77 137.39` | — |
| 2 | time | `^(?:t\s*\+?\s*|at\s+)(?:(\d{1,2}):([0-5]\d)|(\d{1,3}))\s*(?:min)?$` gives `h:mm`, or minutes `N` (EVA clock) | `t 45`, `t45`, `at 01:20` | `t `, `at ` |
| 3 | route | `^route\s+(STOP(?:\s*(?:,|→|\s)\s*STOP)*)$` (tokens are validated after the match) | `route S4 S1 S6`, `route s4, s1 → s6` | `route ` |
| 4 | within | `^(?:stations?\s+)?within\s+(\d{1,3})\s*(?:min(?:utes?)?)?$` | `stations within 30 min`, `within 45` | `stations within ` |
| 5 | timeHome | `^time\s+home(?:\s+(here|.+))?$`. The tail must be `here` or parse as coords (pattern 1) | `time home here`, `time home 137.39, -4.77`, `time home x 120 y -40` | `time home ` |
| 6 | marginBelow | `^margin\s*(?:below|under|<)\s*(\d{1,3})\s*(?:min)?$` | `margin below 10 min`, `margin < 5` | `margin below ` |
| — | fuzzy | anything else: `rank(items, q, label)` over the index (section 4.1) plus the commands | `ridge`, `leg 3`, `s7 → s6`, `undo`, `turn-back` | — |

- A matched pattern gives its rows first, in the group "Answer" (`search.groups.answer`). Fuzzy results for the
  same text follow, so `time home` still finds the glossary term.
- Out of range: `t` above `tMaxMin`, `within` above 999, an unknown `STOP`, or planner metres beyond
  `config/site.yaml planning_radius_m` (3700). These still give a row, but it is disabled and states why
  (`search.reason.*`). It never falls through silently.
- `leg N` and `A → B` are FIND items, not patterns. Each leg item has code `leg N` and name `S7 → S6`, normalised
  the same way, so fuzzy search finds both forms. No new pattern id is needed.
- `?` inside the palette input is text, so `keys.ts isTypingTarget` returns true and the shell help overlay
  does not open. The palette then shows its own pattern help (S4).

### 2.3 Tab completion
Tab with input `p`: when one or more `prefixes` start with `p` and `p` is not already longer than the prefix,
complete to the first one in precedence order (`st` → `stations within `, `a` → `at `, `ti` → `time home `,
`m` → `margin below `). If no prefix matches and the active row is an object, Tab fills in its code. Otherwise Tab
keeps the default focus move (a11y: Tab never traps).

### 2.4 Coordinates and the pad-relative projection
- Decimal: unchanged (`search.ts parseCoordinates`, result `SelectionRef {kind:'cell'}`).
- DMS: `deg + min/60 + sec/3600`, negative for S and W. Same `cell` ref.
- Planner metres: **the web app has a pad-relative projection.** `web/src/nav/geom.ts`
  `fromENU(e, n, centre, sphereMetric(centre.lat, CONFIG.marsRadiusM))` is a local tangent plane on the Mars
  sphere (`config/site.yaml crs.mars_radius_m`). It is static code with no live import. The centre is the official pad
  (`pad.json pad.lon/lat`, rank1), or the pad in use (`mission.plan.pad`) when a parking option is chosen.
  `x` = metres east, `y` = metres north. The analysis projection (`crs.analysis_proj`, eqc, lat_ts −4.8)
  exists only forward (`edit/route/map/heights.ts lonLatToXY`, waypoint-owned, absolute, not pad-relative).
  Within 3.7 km, the difference between the two is far below one 3 m field pixel. The row title says "from the pad" (open question Q3).

## 3. Command list (DO)

Groups: `CommandGroup` (section 5). Keys come from `HELP_ROWS`. Live = disabled when `!liveStatus.reachable`.
"runShortcut(x)" means `ui/shell/keys.ts:runShortcut(x, env)`. That function announces `hl:shortcut` first, so the
listeners that exist today (camera, selection history, plan-edit undo) handle the command exactly as they handle the key.

| id | label (copy key) | icon | group | keys | live | owner | calls (exact) | flag / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mode.plan` `mode.fly` `mode.report` `mode.evidence` | `modes.{m}.label` | map, compass, file-text, shield-check | view | P Y R E | no | shell | runShortcut({action:'mode',mode}) → `env.navigate(modeHash(m))` (`ui/shell/store.ts`) | — |
| `view.toggle3d` | `shortcuts.toggle3d` | rotate-3d | map | T | no | shell | runShortcut({action:'toggle3d'}) → `ui.view` | keys.ts sets `ui.view` directly. `map/terrain/state.ts:toggleView()` also sets the default exaggeration (Q5) |
| `timeline.playPause` | `shortcuts.playPause` | play | timeline | Space | no | shell | runShortcut({action:'playPause'}) → `state/mission.ts:missionClock.toggle()` | FLY only: disabled elsewhere, reason `commands.reason.flyOnly` |
| `timeline.back` / `timeline.forward` | `shortcuts.scrub` | skip-back / skip-forward | timeline | ← → | no | shell | runShortcut({action:'scrub',minutes:∓1}) → `missionClock.seek(t±1)` | FLY only |
| `app.help` | `shortcuts.help` | keyboard | app | ? | no | shell | runShortcut({action:'help'}) → `shell.helpOpen` | — |
| `view.focusMode` | `buttons.focusMode` | panel-left | view | F | no | shell | runShortcut({action:'focusMode'}) → `shell.focusMode` | — |
| `view.fullscreen` | `commands.fullscreen` | maximize | view | — | no | design | **not found**: no `requestFullscreen` in `web/src` (owner to confirm; `document.documentElement.requestFullscreen()` would be new code) | hidden when `document.fullscreenEnabled` is false |
| `camera.overhead` `camera.isometric` `camera.low` `camera.focus` | `commands.camera.{overhead,isometric,low,focus}` | camera | map | 1–4 | no | design | runShortcut({action:'camera',preset:1…4}) → `map/camera/index.ts` hl:shortcut listener (line ~100) | map modes only |
| `camera.follow` | `commands.followCrew` | locate-fixed | map | 5 | no | design | runShortcut({action:'camera',preset:5}) → `map/camera/index.ts flyFollow().toggle()`, which clicks the M10 flythrough button (`map/flythrough/control.ts`) | **follow crew = flythrough** (same button), registered once, keyword `flythrough` (Q1) |
| `selection.back` / `selection.forward` | `buttons.back` / `buttons.forward` | chevron-left / chevron-right | app | [ ] | no | shell | runShortcut({action:'history',step:∓1}) → `ui/cards/sidebar.tsx` listener → `state/selection.ts:stepHistory` | enabled: `canGoBack()` / `canGoForward()` |
| `edit.undo` / `edit.redo` | `buttons.undo` / `buttons.redo` | undo-2 / redo-2 | plan | Ctrl+Z / Ctrl+Shift+Z | no | edit | runShortcut({action:'undo'\|'redo'}) → `edit/bind.ts:handleEditShortcut` → `PlanEditStore.undo()/redo()` (`edit/store.ts`) | the store instance is local to `edit/roverMap.ts:339`, so `enabled` cannot read `canUndo` (Q2). Edit route has its own stack (`edit/route/controller.ts undo/redo`) |
| `map.layer.{id}` × 8 (contours, slopeClass, rough, mineralSulfate, mineralClay, ridges, mineralPatches, blocked) | `layers.{id}.name` (existing `OverlayDef.name`) | layers | map | — | no | design | `map/overlays/state.ts:setOverlay(id, !overlayOn.peek()[id])` | thematic cap is applied by setOverlay (`capNotice`) |
| `map.layers.reset` | `commands.layersReset` | eye-off | map | — | no | design | `map/overlays/state.ts:resetOverlays()` | — |
| `map.exaggeration.more` / `.less` / `.reset` | `commands.exaggeration.{more,less,reset}` | mountain | map | — | no | design | `map/terrain/state.ts:setExaggeration(exaggeration() ± TERRAIN_PENDING.exaggerationStep)` / `setExaggeration(TERRAIN.exaggeration.default)` (clamped by `clampExaggeration`) | enabled only when `ui.view === '3d'` |
| `plan.official` | `nav.officialPlan` | shield-check | plan | — | no | edit | **not found**: no "back to official plan" action. Candidate: `PlanEditStore.apply({pad: c.officialPadId, scenario: c.defaultScenario, budgetMin: c.bandBudgetsMin[0], dwell:{}})` (one undo step), but the instance is not exported (Q2) | owner to confirm |
| `plan.copyPermalink` | `buttons.copyLink` | link | export | — | yes | waypoint | `live/plan.ts:permalink(mission.plan.hash, location)` + clipboard. **No clipboard code exists** (new, waypoint) | needs `mission.plan.hash` |
| `plan.exportJson` | `buttons.exportJson` | download | export | — | yes | waypoint | `live/planio.ts:exportPlanInputs(inputs)` → `<a download>` as in `live/planview.tsx:PlanActions` | VITE_LIVE |
| `sim.send` (mission.json) | `commands.sendToSimulator` | share-2 | export | — | no* | waypoint | `ui/cards/simslot.tsx:simExportOn()` + the manifest's `kind:"sim_plan"` file via `dataUrl(f.file, …)` download (live tree: `live/simslot.tsx`) | **VITE_SIM_EXPORT**. Registered only when it is on and a sim_plan file is listed. *live when the tree is live |
| `route.open` | `nav.rail.stationsRoute` | station | route | — | yes | waypoint | rail section `ROUTE_SECTION_ID='edit-route'` (`live/route/mount.tsx:180`). **No "open rail section" function** in `ui/shell/store.ts` (Q4) | VITE_LIVE (there is no VITE_ROUTE_EDIT flag in the code) |
| `route.compute` | `buttons.computeFullPlan` | gauge | route | — | yes | waypoint | `edit/route/controller.ts` `computePlan` (= `runCompute`) on the controller created in `live/route/mount.tsx` | VITE_LIVE |
| `plans.open` | `commands.myPlans` | file-text | plan | — | yes | waypoint | `live/plans/view.tsx:MyPlans`, mounted in `live/planview.tsx:75/332` (owner to confirm the target) | VITE_LIVE |
| `story.intro` | `buttons.replayIntro` | play | story | — | no | design (WS16) | **not found** as a callable: `story/attach.ts:attachStory(cmap, {kind:'intro'})` needs the ConsoleMap (`map/consoleMap.ts:259`). Today only `?intro=1` | owner to confirm (e.g. `ConsoleMap.replayIntro()`) |
| `story.storm` | `buttons.stormReplayOn` / `stormReplayOff` | radiation | story | — | no | design (WS16) | **not found** as a callable: `map/storm/index.ts StormControl` button → `map/storm/mode.tsx:startStormMode(map)`. Today only `?storm=1` | owner to confirm |

Not registered as commands: `search` (opens the palette itself), `escape` (the palette closes first).
Feature flags: `VITE_LIVE` (`live/config.ts LIVE_ENABLED`) hides route.*, plans.open, plan.exportJson and
plan.copyPermalink. `VITE_SIM_EXPORT` hides sim.send. **`VITE_ROUTE_EDIT` does not exist** in the code. Edit route is
behind VITE_LIVE only.

## 4. Data and store map

### 4.1 FIND groups (S1; static, through the loader `data()`; no new files)

| Group (`search.groups.*`) | Source (file → function) | Row number? | Choose = |
| --- | --- | --- | --- |
| areas | `map/overlays/catalog.ts OVERLAYS` + `public/data/highlights/{ridges,mineral,blocked}.geojson` (overlay sources) | none | `setOverlay(id, true)` + fit to the feature (map camera) |
| legs | `route_{scenario}.geojson` (`loader.route(scenario)`), feature `leg` property | none | `select({kind:'leg', leg, pad})` (`state/selection.ts`) |
| events | `timeline_{scenario}.json` (`loader.timeline`) via `ui/timeline/model.ts buildTimelineModel` (turnBacks, checkpoints, rows `arrive/depart/leave/return/o2_checkpoint/turn_back`, storm tripwire) | the clock time comes from the row (`timeline.{s}.{i}.t_min`), so the row shows `<Num k=…>` | `missionClock.seek(t)` (FLY) |
| scenarios | `scenarios/index.json` (`loader.scenarios()`) | none | `state/mission.ts:choosePlanScenario(s)` |
| report | `views/cuff.tsx` headings, `MODE_VIEWS.report` | none | navigate (no section anchors today, Q6) |
| evidence | `manifest.json` keys → `views/scorecard.tsx` row `id="k-{key}"` (+ validation headings) | the manifest value via `<Num>` | `href({name:'scorecard', key})` |
| glossary | `ui/copy.json glossary.*` (term + `*Hint`) | none | show the hint inline (no state change) |
| plans | `live/plans/store.ts` (`PLANS_KEY` browser storage) | none | `#/plan/{hash}`. Live only: registered by waypoint |

### 4.2 ASK rows

| Pattern | Reads | Number shown | Choose = |
| --- | --- | --- | --- |
| time | `missionClock.tMax` | none (the user's minute in `vars`, formatted mm:ss) | `missionClock.seek(t)`. Navigate to FLY when not in a map mode |
| route | `stations.json` ids | none | waypoint route controller `edit({mode:'ordered', stops:[{station}…]})` (one undo step) + `route.open`. **Live-only**, and needs a bridge (Q4) |
| within | `stations.json t_home_min[scenario]` (scenario = `mission.plan.scenario ?? index.default`) | `{kind:'manifest', key:'t_home_min.{id}.{scenario}'}`, the same key as `ui/cards/cards.tsx:180` | `select({kind:'station', id})` |
| timeHome | here = selected cell/station/pad; coords tail | station: manifest key as above. Point: `{kind:'estimate', value: fieldAt(lon,lat).tHome[variant], unit:'min', source:'fieldAt'}` (`map/field/decode.ts fieldAt`); `null` → "no route home" | `select({kind:'cell', lon, lat})` |
| marginBelow | `TimelineModel.curve` (rows with `margin_min`) | `{kind:'manifest', key:'timeline.{scenario}.{i}.margin_min'}` | `missionClock.seek(row.t)`. **Map highlight below N: not found** (the margin shader only has `amberMin`; Q7) |
| coords | — | none | `select({kind:'cell', …})` (as today) |

Number component: **`components/Num.tsx <Num v file k>`** (static manifest from `prov/store`, links to the scorecard,
flags unbacked numbers), with `ui/components/TrustChip.tsx` (`ChipMark` inside list rows, because the row is the button).
`ui/components/Readout.tsx` wraps the same `<Num>` and adds a label. `live/num.tsx LiveNum` is **not usable**: it lives under
`web/src/live/` and static code must not import it (design rule 6). Estimates use the `estimate` label
(`search.estimate`), never a chip that says real/modelled.

## 5. API (from `/tmp/hl-search/interfaces.md`, with types fixed to match the code)

```ts
// web/src/ui/commands/registry.ts (S2). Pure TS + @preact/signals. Imports nothing from live/ or edit/route/.
export type CommandGroup = 'view' | 'map' | 'timeline' | 'plan' | 'route' | 'export' | 'story' | 'app'
export type CommandSource = 'palette' | 'shortcut' | 'menu' | 'button'
export interface Command {
  id: string; label: CopyKey; keywords?: readonly string[]; icon: IconName; group: CommandGroup
  shortcut?: ShortcutAction          // CHANGED from ShortcutAction['action']: the full action, so mode/camera/history/scrub keep their parameter
  keys?: readonly string[]           // default keysForAction(shortcut)
  live?: boolean; enabled?: () => boolean; reason?: () => CopyKey | null
  run: (src: CommandSource) => void | boolean | Promise<unknown>
  owner: 'shell' | 'search' | 'design' | 'edit' | 'waypoint'
}
export function registerCommand(c: Command): () => void   // duplicate id: throws in dev/test, last wins in prod
export const commands: ReadonlySignal<readonly Command[]>
export function getCommand(id: string): Command | undefined
export function isEnabled(c: Command): boolean
export function reasonFor(c: Command): CopyKey | null
export function runCommand(id: string, src: CommandSource): boolean
export function commandForShortcut(a: ShortcutAction): Command | undefined  // CHANGED: matches action + parameter
export interface LiveStatus { reachable: boolean; reason: CopyKey | null }
export const liveStatus: ReadonlySignal<LiveStatus>       // default { reachable:false, reason:'search.live.unknown' }
export function setLiveStatus(s: LiveStatus): void
```

keys.ts adapter (S2, ≤ 15 lines): `keysForAction(a: ShortcutAction): string[]`, read from HELP_ROWS through a fixed
action → `HelpRow.label` map (HELP_ROWS rows have no action field). In `runShortcut`'s `default:` branch, delegate to
`commandForShortcut(a)` **only when `owner !== 'shell'`**. Shell commands run through `runShortcut`, so delegating to them
would recurse forever on an unhandled `camera` or `undo`. Built-in cases, the announce order, VIEW_KEYS and I1 stay unchanged.

```ts
// web/src/ui/search/queries/types.ts (S3a/S3b)
export interface QueryContext {
  stations: readonly { id: string; name: string; lon: number; lat: number; t_home_min: Record<string, number | null> }[] // = data/types Station subset
  scenario: string                                    // ADDED: key part for manifest values
  pad: { id: string; lon: number; lat: number }
  tMaxMin: number
  live: boolean
  marsRadiusM: number                                 // ADDED: CONFIG.marsRadiusM for planner metres
  fieldAt?: (lon: number, lat: number) => FieldSample | null   // map/field FieldSample
  timeline?: TimelineModel | null                     // REPLACES stationTimes?: ManifestBacked (type did not exist)
  here?: { lon: number; lat: number; ref: SelectionRef } | null // ADDED: "time home here"
}
export type RowValue =
  | { kind: 'manifest'; key: string; v: number | null; file: string }   // ADDED v + file: <Num> needs them
  | { kind: 'estimate'; value: number; unit: 'min' | 'm'; source: 'fieldAt' }
export interface QueryRunEnv { navigate: (hash: string) => void; win?: Window }  // DEFINED (= palette RunEnv)
export interface QueryRow {
  id: string; pattern: string; icon: IconName; title: CopyKey; vars?: Record<string, string>
  values?: readonly RowValue[]; live?: boolean; disabledReason?: CopyKey | null
  run: (env: QueryRunEnv) => void
}
export interface QueryPattern {
  id: 'time' | 'route' | 'within' | 'timeHome' | 'marginBelow' | 'coords'
  hint: CopyKey; examples: readonly string[]; prefixes: readonly string[]
  parse: (q: string, ctx: QueryContext) => QueryRow[] | null   // pure, sync, no side effects
}
export const PATTERNS: readonly QueryPattern[]   // order = section 2.2
export function runQueries(q: string, ctx: QueryContext): QueryRow[]
```

Index (S1, `search.ts`): `SearchGroup` adds `'areas' | 'legs' | 'events' | 'scenarios' | 'report' | 'glossary' | 'plans'`
(+ `'answer'` for pattern rows). `SearchItem` keeps its shape and gains `run?: (env: QueryRunEnv) => void` for non-selection targets.
It is built lazily on the first palette open, or at idle after the intro has started (L12). Never during load.

## 6. Test plan (S5, in every package; vitest + jsdom)

| Area | Package | Tests |
| --- | --- | --- |
| Patterns | S3a, S3b | every example in section 2.2 parses to the expected row. Near-misses (`t`, `route`, `within x`, `137°23'E`) give null or a disabled row with its reason. Precedence: `t 45` is not fuzzy, and `137.39 -4.77` is coords before anything else. DMS ↔ decimal round trip within 1e-6°. Planner `x 0 y 0` = pad. Tab prefixes complete |
| Value integrity | S1, S3a, S3b | every `RowValue.kind==='manifest'` key exists in `manifest.json` and equals the file value. Estimate rows carry the `estimate` label and no chip. A static scan of `queries/` and `commands/` finds no numeric literal shown to the user. The value snapshot test stays unchanged |
| Nothing changes until chosen | S3a, S4 | spy on `select`, `missionClock.seek`, `setOverlay`, `ui.view`, `location.hash` while typing and arrowing through 50 queries: zero calls. Enter calls exactly one. Undo after choosing restores the previous state |
| Live / offline | S2, S3a | `setLiveStatus({reachable:false, reason})`: live rows are disabled and show the reason, and `runCommand` returns false. Reachable: they are enabled. Flag off (VITE_LIVE / VITE_SIM_EXPORT): not registered. `isolation.test` style import scan: `ui/commands`, `ui/search` never import `live/` or `edit/route/` |
| Registry | S2 | every section 3 id is registered once (dup throws). Every HELP_ROWS keyboard row maps to a command. `keysForAction` matches HELP_ROWS. Delegation does not recurse (unhandled camera returns false) |
| Keyboard + a11y | S4 | Cmd/Ctrl-K and `/` open; ↑/↓ wrap; Enter runs; Tab completes; Esc closes; `?` shows help. Rows are `role=option` with `aria-label` = title + value text + "estimate"/chip name + "disabled: reason". `aria-activedescendant` follows |
| Latency < 16 ms | S1, S4 | build the full index from fixtures (×4 duplicated as a margin), then time `runQueries` + `rank` with `performance.now()` over 200 recorded keystroke prefixes, after a warm-up of 20. Assert the p95 is under 8 ms in jsdom (half of the budget, for CI noise). Log the max |
| Intro not delayed | S1, S4 | mock the loader. Before the first palette open and before the `introSeen`/intro-started signal, no index file is requested. Then it builds on `requestIdleCallback` (fake timers). `main.ts` imports nothing new eagerly (bundle check) |

## 7. Ownership and coordination

| Path / item | Owner |
| --- | --- |
| `web/src/ui/search/`, `web/src/ui/commands/` (new), `docs/design/search.md` | search orchestrator |
| `web/src/ui/shell/keys.ts` (S2 adapter only), menus, `map/`, `story/`, icon sprite | design orchestrator (WS15/WS16) |
| `web/src/edit/`, `web/src/edit/route/`, `web/src/live/` | waypoint orchestrator / WS18. Registers its own commands (route.open, route.compute, plan.exportJson, plan.copyPermalink, sim.send, plans.open) in its files after S2 merges, and calls `setLiveStatus` from `live/health.ts watchHealth` |
| Copy | search packages append keys only under `search.*` and `commands.*` in `web/src/ui/copy.json`. They reuse existing keys (`modes.*`, `shortcuts.*`, `buttons.*`, `layers.*`, `nav.*`) without editing them |

Merge order: open design PRs on keys.ts merge first, then S2 rebases. S2 → S3a/S1 (parallel) → S3b → S4.

## 8. Open questions

| # | Question | Owner |
| --- | --- | --- |
| Q1 | Follow crew (preset 5) and Flythrough are the same M10 button. Is one command right? | design (WS16) |
| Q2 | The plan-edit store instance is closure-local in `edit/roverMap.ts`. Export it (or `canUndo`/`canRedo` signals) so undo/redo/official-plan can be enabled honestly | edit (WS18) |
| Q3 | Planner metres: is local ENU from the pad (`nav/geom.ts`) acceptable, or must it be the eqc analysis projection (needs an inverse of `lonLatToXY`)? | waypoint |
| Q4 | No API to open a rail section or to fill the Edit route from static code. Proposal: waypoint registers `route.open` and exposes a route-fill hook through the registry | design + waypoint |
| Q5 | `keys.ts` toggle3d vs `map/terrain/state.ts toggleView()` (default exaggeration): which one should the command call? | design |
| Q6 | Report sections have no anchors (`views/cuff.tsx`). Add ids, or link to the view only? | design |
| Q7 | "margin below N highlights on the map": no threshold-highlight API exists (the margin shader uses `amberMin`). Is a timeline-row jump enough for now? | design (WS16) |
| Q8 | "Alarms" in timeline events: the timeline has `o2_checkpoint` and the storm tripwire only. Confirm the meaning | search + design |
| Q9 | Full screen, replay intro and storm have no callable today (URL params only) | design |
