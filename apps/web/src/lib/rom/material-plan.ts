/**
 * A DazToHue material setup, proposed from the export the HDA already reads.
 *
 * ## Why this can exist at all
 *
 * The DTH exporter writes a `Materials` array into every `.dth` — one entry per
 * Daz SURFACE, carrying the asset that owns it, the Daz **content type**, the
 * shader, and every channel with its texture path. That is the whole input a
 * material setup needs, and it is already on disk beside the `.fbx` the network
 * imports. Nothing here runs Daz, Houdini or hython: it reads a JSON file.
 *
 * **The join is `Material Name` ↔ `@fbx_material_name=`.** Verified 2026-08-14
 * against a real pair (LaraCroft_G81's export vs its scanned `.hiplc`): 26
 * claims, exact string equality on every one present in both. That single
 * correspondence is what makes everything below possible, so it lives in exactly
 * one place — {@link surfaceClaim} — and is never re-spelled.
 *
 * NOT verified: whether a surface name ever needs escaping on its way into the
 * FBX. Every name measured so far survives verbatim, including ones with
 * underscores and mixed case, but no name needing a transform has been seen —
 * so a mismatch is reported as a mismatch, never repaired by guessing.
 *
 * ## Why the grouping needs no heuristic
 *
 * The `.dth`'s `Value` field is the Daz **content type** (`Actor/Character`,
 * `Follower/Wardrobe`, `Follower/Attachment/Head/Face/Tears`), authored by the
 * asset's vendor. It already separates figure from wardrobe from attachment, so
 * "all of the same material kind" is data we are handed rather than something to
 * infer. Both slot layouts found in real projects fall out of it directly — one
 * merged `MI_Clothing`, or one slot per garment ({@link MaterialGrouping}).
 *
 * The ONE place a name heuristic remains is the eye stack, and it is marked as
 * such where it happens ({@link slotNameFor}).
 *
 * ## What this deliberately does not do
 *
 * It proposes; it never writes. A proposal is compared against what a node
 * actually claims ({@link diffExportAgainstSlots}) and shown. Installing one is a
 * separate step with its own dry run, backup and merge rule — the existing
 * transfer machinery (`material_utils.py`), which takes a payload and does not
 * care whether it came from a source node or from here.
 */

import { surfaceLabel } from './houdini-material-merge.ts'

/**
 * The group-expression prefix a DazToHue material slot claims a surface with.
 *
 * The attribute name is the HDA's business — this is reproduced verbatim from a
 * measured `material_group` value, never constructed from a rule about how
 * Houdini names FBX attributes.
 */
const SURFACE_CLAIM_ATTR = '@fbx_material_name='

/** The claim token a node would carry for a Daz surface. THE join — see the
 *  module header. */
export function surfaceClaim(surface: string): string {
  return `${SURFACE_CLAIM_ATTR}${surface}`
}

/** One Daz surface as the export describes it. */
export interface ExportSurface {
  /** The Daz surface name, verbatim (`Body`, `metal_1`). */
  surface: string
  /** The asset that owns it, as Daz names it (`Boots_12736`). */
  asset: string
  /** The asset's human label, when the export carries one. */
  assetLabel: string
  /** The Daz CONTENT TYPE (`Follower/Wardrobe`) — the grouping signal. Spelled
   *  `Value` in the `.dth`, which says nothing about what it holds. */
  contentType: string
  /** The Daz shader (`Iray Uber`, `PBRSkin`). Reported, not acted on: it decides
   *  what a good baker LOOKS like, which is beyond what this can derive. */
  shader: string
  /** Only the channels that actually carry a texture. A Daz material reports
   *  every channel it has — 117 on an Iray Uber surface, of which a handful are
   *  mapped — so the unmapped ones are dropped at parse time rather than carried
   *  as noise through everything downstream. */
  channels: Array<ExportChannel>
}

/** One textured channel on a surface. */
export interface ExportChannel {
  /** The Daz property name (`Diffuse Color`). */
  daz: string
  /** The baker channel it feeds (`Colour`), or '' when unmapped. */
  channel: string
  /** Absolute texture path as the export stored it. */
  texture: string
}

/**
 * Daz channel → baker channel.
 *
 * MEASURED from two directions and deliberately kept small: the left column is
 * every property carrying a texture in a real export (LaraCroft_G81, DTH 2.0.2,
 * 32 surfaces), the right is the vocabulary of the baker names in two real
 * projects (`T_Skin_Colour`, `T_Skin_Normal`, `T_Skin_Roughness`,
 * `T_Skin_Specular`, `T_Dress_Metallic`).
 *
 * **The two do not cover each other, and that is the honest state.** A real
 * `T_Skin_Roughness` baker exists in a project whose export has no roughness
 * texture on any surface — some bakers are built from constants or from inputs
 * this file cannot see. So a proposal derived from textures is a PARTIAL setup
 * by construction, never a finished one, and the UI must not imply otherwise.
 *
 * An unlisted property is carried with `channel: ''` rather than dropped: "this
 * surface has a texture we do not know where to put" is information, and
 * silently swallowing it is how a channel goes missing for a year.
 */
const CHANNEL_MAP: ReadonlyArray<readonly [string, string]> = [
  ['Diffuse Color', 'Colour'],
  ['Base Color', 'Colour'],
  ['Normal Map', 'Normal'],
  ['Detail Normal Map', 'Normal'],
  ['Bump Strength', 'Bump'],
  ['Metallic Weight', 'Metallic'],
  ['Glossy Roughness', 'Roughness'],
  ['Specular Lobe 1 Roughness', 'Roughness'],
  ['Dual Lobe Specular Reflectivity', 'Specular'],
  ['Glossy Layered Weight', 'Specular'],
  ['Translucency Color', 'Translucency'],
  ['Cutout Opacity', 'Opacity'],
  ['Top Coat Color', 'TopCoat'],
  ['Metallic Flakes Color', 'Flakes'],
]

/** The baker channel a Daz property feeds, or '' when unmapped. */
export function bakerChannelFor(dazProperty: string): string {
  return CHANNEL_MAP.find(([daz]) => daz === dazProperty)?.[1] ?? ''
}

/**
 * Read the surfaces out of a parsed `.dth`.
 *
 * TOLERANT BY CONSTRUCTION. This file is a third-party exporter's output, its
 * shape has only been measured on the versions that happened to be installed,
 * and it is read on a path where the useful failure is "we could not propose a
 * setup" — never "the drawer would not open". So an entry missing the one field
 * that matters is skipped and everything else still parses. A `.dth` from a
 * future DTH that renames a key degrades to an empty proposal, which reads as
 * "nothing to say" rather than as a crash.
 *
 * Zod is deliberately not used here: it would either be lenient in exactly this
 * way (and then it is doing nothing a filter does not) or strict, which is the
 * behaviour this must not have.
 */
export function parseDthSurfaces(dth: unknown): Array<ExportSurface> {
  const materials = (dth as { Materials?: unknown })?.Materials
  if (!Array.isArray(materials)) return []
  const out: Array<ExportSurface> = []
  for (const entry of materials) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const surface = str(record['Material Name'])
    // The surface name is the join and the identity — an entry without one
    // cannot be claimed, proposed or diffed, so there is nothing to carry.
    if (!surface) continue
    out.push({
      surface,
      asset: str(record['Asset Name']),
      assetLabel: str(record['Asset Label']),
      contentType: str(record['Value']),
      shader: str(record['Material Type']),
      channels: parseChannels(record['Properties']),
    })
  }
  return out
}

function parseChannels(properties: unknown): Array<ExportChannel> {
  if (!Array.isArray(properties)) return []
  const out: Array<ExportChannel> = []
  for (const property of properties) {
    if (typeof property !== 'object' || property === null) continue
    const record = property as Record<string, unknown>
    const texture = str(record['Texture'])
    // Unmapped channels are the overwhelming majority (113 of 117 on a real
    // Iray Uber surface) and say nothing about a baker.
    if (!texture) continue
    const daz = str(record['Name'])
    out.push({ daz, channel: bakerChannelFor(daz), texture })
  }
  return out
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** How wardrobe surfaces are grouped into slots. Both shapes were found in real
 *  hand-built projects, so this is a preference and not a right answer:
 *  `merged` gives one `MI_Clothing` (fewer bakers, one texture budget for the
 *  whole outfit), `perGarment` one slot per asset (`MI_Boots`, `MI_Holster`). */
export const MATERIAL_GROUPINGS = ['merged', 'perGarment'] as const
export type MaterialGrouping = (typeof MATERIAL_GROUPINGS)[number]

/** A slot the export implies, with the bakers its textures imply. */
export interface ProposedSlot {
  /** Slot name as a node would store it (`Clothing`) — the display form is the
   *  node's own prefix plus this, which only the node knows. */
  name: string
  /** The surfaces this slot would claim, as raw claim tokens. */
  surfaces: Array<string>
  /** The Daz content types that landed here — what the grouping was based on,
   *  kept so the UI can explain a slot rather than assert it. */
  contentTypes: Array<string>
  /** Daz shaders across those surfaces. More than one is worth showing: an eye
   *  stack mixing `PBRSkin` and `Iray Uber` will not bake as one material. */
  shaders: Array<string>
  /** The bakers the textures imply. */
  bakers: Array<ProposedBaker>
  /** Textured channels with no mapping — named so they are visibly unhandled
   *  rather than quietly absent. */
  unmappedChannels: Array<string>
}

/** One baker a proposal would create. */
export interface ProposedBaker {
  /** `T_<Slot>_<Channel>` — the convention every measured project already uses. */
  name: string
  /** The baker channel (`Colour`). */
  channel: string
  /** Distinct texture paths feeding it, in first-seen order. Their COUNT is the
   *  useful number: it is how many layers the baker needs. */
  textures: Array<string>
}

/**
 * The slot a surface belongs to.
 *
 * Content type first, because that is vendor data. The two exceptions are name
 * matches, and are called out as such:
 *
 *  - **the eye stack** — `Pupils`/`Irises`/`Sclera`/`Cornea`/`EyeMoisture` are
 *    `Actor/Character` like the body, but every real setup gives them their own
 *    material (measured: `MI_Eyes` in a hand-built project). They need a
 *    different shader, not a different texture, so folding them into skin is
 *    wrong in a way no texture data reveals.
 *  - **the tear** — same story, its own surface and its own material.
 *
 * Both are NAME heuristics over a fixed Genesis surface vocabulary, unlike
 * everything else here. A figure that names them differently falls through to
 * the content-type rule, which puts them in `Skin` — visible in the proposal and
 * fixable by hand, rather than silently wrong.
 */
export function slotNameFor(surface: ExportSurface, grouping: MaterialGrouping): string {
  const name = surface.surface
  if (/^(Pupils|Irises|Sclera|Cornea|EyeMoisture|EyeReflection)$/i.test(name)) return 'Eyes'
  if (/^Tear$/i.test(name)) return 'Tear'

  const type = surface.contentType
  // The figure, plus the grafts fitted INTO it: a genital graft shares the
  // figure's texture space and belongs in the same slot, which is what every
  // measured skin setup does (a real `MI_Skin` claims 17 surfaces including the
  // graft's).
  if (type.startsWith('Actor/')) return 'Skin'
  if (/^Follower\/Attachment\/(Lower-Body|Upper-Body|Torso)/.test(type)) return 'Skin'

  if (type.startsWith('Follower/Wardrobe')) {
    return grouping === 'perGarment' ? assetSlotName(surface.asset) : 'Clothing'
  }
  if (type.startsWith('Follower/Hair')) return 'Hair'
  // An attachment is a prop (a backpack, a weapon) — its own thing, never
  // merged into the outfit's texture budget.
  return assetSlotName(surface.asset) || 'Misc'
}

/**
 * A Daz asset name as a slot name: `Boots_12736` → `Boots`,
 * `SaltBikini_Bra_2050` → `SaltBikiniBra`.
 *
 * Daz appends a numeric id to the asset name, which is noise in a material name
 * and — more to the point — changes between installs of the same product, so a
 * slot named with it would not match the same outfit on another machine.
 */
export function assetSlotName(asset: string): string {
  return asset
    .replace(/_\d+$/, '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('')
}

/**
 * The slots and bakers an export implies.
 *
 * Order is the export's own, which is the order Daz lists the figure's surfaces
 * before its followers' — so a proposal reads figure-first the way a setup is
 * built.
 */
export function planMaterialSetup(
  surfaces: ReadonlyArray<ExportSurface>,
  grouping: MaterialGrouping = 'merged',
): Array<ProposedSlot> {
  const slots = new Map<string, ProposedSlot>()
  // Texture sets are kept per slot+channel while building so a texture shared by
  // two surfaces (one map across a whole outfit) counts once.
  const textures = new Map<string, Set<string>>()

  for (const surface of surfaces) {
    const name = slotNameFor(surface, grouping)
    let slot = slots.get(name)
    if (!slot) {
      slot = {
        name,
        surfaces: [],
        contentTypes: [],
        shaders: [],
        bakers: [],
        unmappedChannels: [],
      }
      slots.set(name, slot)
    }
    slot.surfaces.push(surfaceClaim(surface.surface))
    pushUnique(slot.contentTypes, surface.contentType)
    pushUnique(slot.shaders, surface.shader)

    for (const channel of surface.channels) {
      if (!channel.channel) {
        pushUnique(slot.unmappedChannels, channel.daz)
        continue
      }
      const key = `${name} ${channel.channel}`
      let set = textures.get(key)
      if (!set) {
        set = new Set()
        textures.set(key, set)
        slot.bakers.push({ name: `T_${name}_${channel.channel}`, channel: channel.channel, textures: [] })
      }
      set.add(channel.texture)
    }
  }

  for (const slot of slots.values()) {
    for (const baker of slot.bakers) {
      baker.textures = [...(textures.get(`${slot.name} ${baker.channel}`) ?? [])]
    }
  }
  return [...slots.values()]
}

function pushUnique(list: Array<string>, value: string): void {
  if (value && !list.includes(value)) list.push(value)
}

/** A surface the export has that nothing claims. */
export interface UnclaimedSurface {
  surface: string
  contentType: string
  asset: string
}

/** What an export and a node's claims disagree about. */
export interface SetupDiff {
  /** Surfaces in the export that NO slot claims — they arrive in Houdini with no
   *  material. Grouped by content type by the caller: whether this is a defect
   *  depends entirely on intent, and only the content type makes that legible
   *  (measured: a "naked" variant node correctly leaves 11 wardrobe surfaces
   *  unclaimed, while the same node leaving the eye stack unclaimed is a gap). */
  unclaimed: Array<UnclaimedSurface>
  /** Claims naming a surface this export does not contain. Unlike `unclaimed`
   *  these are unambiguous: the claim binds to nothing, so whatever it was for
   *  is not happening. Measured on a real project — five `GP*` claims left
   *  behind after a Golden Palace graft was removed from the scene, plus a
   *  `metal1` against the export's `metal_1`. */
  dead: Array<{ claim: string; slot: string }>
  /** Claims that match — the size of the agreement, so a UI can say "26 of 32"
   *  instead of only ever showing what is wrong. */
  matched: number
}

/** One node's claims, as the scan stores them. */
export interface ClaimedSlot {
  /** The name to blame in a report — the node's display form (`MI_Skin`). */
  displayName: string
  /** Raw claim tokens (`@fbx_material_name=Body`). */
  surfaces: ReadonlyArray<string>
}

/**
 * Compare what an export contains against what a node claims.
 *
 * Both sides are compared as RAW TOKENS, the same discipline
 * `houdini-material-merge.ts` keeps: a pattern claim
 * (`@fbx_material_name=GP*`) matches nothing here and is reported as dead, which
 * is a false alarm in the safe direction — it points at a claim a human should
 * look at, rather than silently accepting one that may bind to nothing.
 *
 * **Scope this to a node whose network imports THIS `.dth`.** The stored scan
 * records imports per PROJECT, not per node, so a project importing several
 * scenes cannot be attributed from disk — `dead` would then blame a node for
 * surfaces belonging to another scene. {@link canDiffProject} is that gate, and
 * callers must pass it before showing a diff.
 */
export function diffExportAgainstSlots(
  surfaces: ReadonlyArray<ExportSurface>,
  slots: ReadonlyArray<ClaimedSlot>,
): SetupDiff {
  const claimed = new Map<string, string>()
  for (const slot of slots) {
    for (const token of slot.surfaces) claimed.set(token, slot.displayName)
  }
  const exported = new Set(surfaces.map((surface) => surfaceClaim(surface.surface)))

  const unclaimed = surfaces
    .filter((surface) => !claimed.has(surfaceClaim(surface.surface)))
    .map((surface) => ({
      surface: surface.surface,
      contentType: surface.contentType,
      asset: surface.asset,
    }))
  const dead = [...claimed]
    .filter(([token]) => !exported.has(token))
    .map(([claim, slot]) => ({ claim, slot }))

  return { unclaimed, dead, matched: claimed.size - dead.length }
}

/**
 * Baker layer groups naming a surface this export does not contain.
 *
 * The other half of {@link diffExportAgainstSlots}'s `dead`, and the half that
 * actually costs something: a slot claim that binds to nothing merely leaves a
 * surface unclaimed, while a baker LAYER pointed at a group that matches no
 * geometry bakes nothing and — measured on DazToHue 2.5 — raises nothing.
 *
 * **Only `@fbx_material_name=` tokens are judged.** A baker layer has a second
 * group field (`material_texture_baker_layer_geoshell_group#_#`) whose
 * vocabulary has never been measured, and its values arrive mixed into the same
 * list. Judging a token whose attribute we do not understand would report a
 * healthy geoshell layer as dead — so anything else is returned as `unjudged`
 * and shown as exactly that, rather than counted either way.
 */
export function deadBakerGroups(
  surfaces: ReadonlyArray<ExportSurface>,
  bakerGroups: ReadonlyArray<string>,
): { dead: Array<string>; unjudged: Array<string> } {
  const exported = new Set(surfaces.map((surface) => surfaceClaim(surface.surface)))
  const dead: Array<string> = []
  const unjudged: Array<string> = []
  for (const token of bakerGroups) {
    if (!token.startsWith(SURFACE_CLAIM_ATTR)) unjudged.push(token)
    else if (!exported.has(token)) dead.push(token)
  }
  return { dead, unjudged }
}

/**
 * Whether a scanned project's nodes can be attributed to one exported scene.
 *
 * A project importing exactly one `.dth` is unambiguous — every material node in
 * it describes that scene. Several imports means the stored scan cannot say
 * which node goes with which, and a diff would blame the wrong node; NO imports
 * means the scan predates the field or nothing is wired yet, which is "not
 * known" and not "matches everything" (the same rule `exportSets` carries).
 *
 * Deliberately conservative: refusing to show a diff costs the user a look at
 * one project, while a confident wrong one costs them a cleanup they should not
 * have made.
 */
export function canDiffProject(imports: ReadonlyArray<string>): boolean {
  return imports.length === 1
}

/** One material node, judged against the export its project imports. */
export interface MaterialPlanNode {
  nodePath: string
  /** What the user calls it — the network box title, falling back to the node
   *  name (every DTH material node is `DazToHueMaterial`, `…1`, `…2`). */
  label: string
  /** Slots and bakers the node carries TODAY — the size of what is already
   *  there, so a proposal is never presented as if it were replacing nothing. */
  slots: number
  bakers: number
  diff: SetupDiff
  /** Baker layer groups the export does not back — see {@link deadBakerGroups}. */
  deadGroups: Array<string>
  /** Layer groups in a vocabulary this cannot judge. Shown as unjudged, never
   *  folded into either count. */
  unjudgedGroups: Array<string>
}

/** One scanned project's plan, or the reason there isn't one. */
export interface MaterialPlanProject {
  hipPath: string
  /** '' when a plan is available; otherwise why not, in the user's terms. A
   *  blocked project still appears — silently dropping it would read as "this
   *  project is fine". */
  blocked: string
  /** The `.dth` the plan was read from ('' when blocked). */
  dthPath: string
  /** How many surfaces that export contains. */
  surfaces: number
  /** What a setup built from the export alone would look like. */
  proposal: Array<ProposedSlot>
  nodes: Array<MaterialPlanNode>
}

/** A scanned project as this needs to see it — the subset of the scan store's
 *  shape, so the rules here never depend on the whole native type. */
export interface ScannedProjectView {
  hipPath: string
  imports: ReadonlyArray<string>
  nodes: ReadonlyArray<{
    nodePath: string
    label: string
    slots: ReadonlyArray<ClaimedSlot>
    bakers: number
    bakerGroups: ReadonlyArray<string>
  }>
}

/**
 * Judge each scanned project against the export it imports.
 *
 * Pure: exports are handed in already read (`dthByPath`, keyed by the LOWERCASE
 * path the scan stores), because the reading is the api layer's job and the
 * deciding is testable only if it is separated from it. A path present with a
 * `null` value means "looked, not there" — distinct from a path absent from the
 * map, which means nobody looked.
 */
export function buildMaterialPlan(
  projects: ReadonlyArray<ScannedProjectView>,
  dthByPath: ReadonlyMap<string, unknown>,
  grouping: MaterialGrouping = 'merged',
): Array<MaterialPlanProject> {
  return projects.map((project) => {
    const blank = { hipPath: project.hipPath, dthPath: '', surfaces: 0, proposal: [], nodes: [] }
    if (!canDiffProject(project.imports)) {
      return {
        ...blank,
        blocked:
          project.imports.length === 0
            ? 'The scan does not know which scene this project imports — rescan it.'
            : `This project imports ${project.imports.length} scenes, and the scan records them per project rather than per network — so the studio cannot tell which material node belongs to which.`,
      }
    }
    const dthPath = project.imports[0]
    const dth = dthByPath.get(dthPath)
    if (dth === undefined || dth === null) {
      return {
        ...blank,
        blocked: `No export at ${dthPath} — run a DTH Export for this scene once and the setup can be read from it.`,
      }
    }
    const surfaces = parseDthSurfaces(dth)
    if (surfaces.length === 0) {
      return {
        ...blank,
        dthPath,
        // A readable export with no materials is not a normal state, and saying
        // "0 surfaces" as if that were an answer would send the user hunting in
        // the wrong place.
        blocked: `The export at ${dthPath} carries no material list — it may predate the DTH version that writes one.`,
      }
    }
    return {
      hipPath: project.hipPath,
      blocked: '',
      dthPath,
      surfaces: surfaces.length,
      proposal: planMaterialSetup(surfaces, grouping),
      nodes: project.nodes.map((node) => {
        const groups = deadBakerGroups(surfaces, node.bakerGroups)
        return {
          nodePath: node.nodePath,
          label: node.label,
          slots: node.slots.length,
          bakers: node.bakers,
          diff: diffExportAgainstSlots(surfaces, node.slots),
          deadGroups: groups.dead,
          unjudgedGroups: groups.unjudged,
        }
      }),
    }
  })
}

/** Whether a plan found anything worth the user's attention — the badge rule.
 *  A blocked project is NOT a finding: it is a missing input, and badging it
 *  would train the eye to ignore the badge. */
export function planHasFindings(projects: ReadonlyArray<MaterialPlanProject>): boolean {
  return projects.some((project) =>
    project.nodes.some(
      (node) =>
        node.diff.dead.length > 0 || node.deadGroups.length > 0 || node.diff.unclaimed.length > 0,
    ),
  )
}

/** `@fbx_material_name=Body` → `Body`, for report text. Re-exported from the
 *  merge module so a caller never grows its own second parser. */
export { surfaceLabel }
