import { sectionsFromFlatFrames } from './frames'
import { CHARACTER_SCHEMA_VERSION, ROM_SECTIONS, SECTION_MODES, defaultSections, newId } from './types'

import type { RomSection } from './types'

/**
 * Character-JSON migration framework.
 *
 * `characterMigrations[N]` upgrades a definition from schema version `N - 1` to
 * `N`, mutating and returning the RAW object BEFORE zod validation. The runner
 * {@link migrateCharacterData} applies the applicable steps in version order, from
 * the definition's stored `schemaVersion` up to {@link CHARACTER_SCHEMA_VERSION},
 * so a JSON written by any older build reaches the current shape before parsing.
 *
 * ── HOW TO CHANGE THE CHARACTER SCHEMA (read this before editing the schema) ──
 *
 * Every change is the same 3-step ritual:
 *   1. Edit `characterSchema` in types.ts (add / rename / remove the field).
 *   2. Bump `CHARACTER_SCHEMA_VERSION` in types.ts + add a one-line History entry.
 *   3. Add a `migrateCharacterData` case to migrate.test.ts covering the change.
 *
 * Whether you ALSO add a step here depends on the KIND of change:
 *
 *   • Additive field WITH a zod default ........... NO step. zod fills it on read.
 *   • Removed field .............................. NO step. zod strips unknown keys.
 *   • Renamed / restructured / meaning changed ... ADD a step — Case A below.
 *   • New field whose value must be COMPUTED from
 *     the character's own data .................... ADD a step — Case B below.
 *   • New value that needs HOST CONTEXT (settings,
 *     filesystem, active DTH release, etc.) ....... NO step here (this module is
 *       pure / no I/O). Give the field a nullable/'' default so "unresolved" is a
 *       valid state, then resolve the real value in the web layer's
 *       `parseCharacter`, next to `canonicalImage` — Case C below.
 *
 * Two rules EVERY step must follow:
 *   • Idempotent + partial-data tolerant — it may run on a definition that already
 *     has the new shape, so guard with `if (data.x === undefined)`.
 *   • Pure — no I/O. Steps run on every read, inside the core.
 *
 * Why the `=== undefined` guard works: steps see the RAW pre-zod object, so
 * `data.x === undefined` reliably means "absent on disk" — the signal a zod
 * default would erase post-parse. That's how you compute a value only when it's
 * missing (and it makes the step idempotent for free).
 *
 * History: the authoritative per-version log lives atop
 * {@link CHARACTER_SCHEMA_VERSION} in types.ts. Bumps 1–9 were additive /
 * removal-only (handled by the zod schema); v10 renamed the per-pose `referenceFbx`
 * string to a `boneScaleRef` boolean, so it carries the step below — add one here
 * only for a rename/restructure or a computed value (see the templates).
 */
export const characterMigrations: Record<
  number,
  (data: Record<string, any>) => Record<string, any>
> = {
  // v10 — the free-text per-pose `referenceFbx` path became a `boneScaleRef`
  // boolean (the exporter auto-generates the FBX + the studio computes its path
  // now). A non-empty old path means the pose was a reference-skeleton frame.
  10: (data) => {
    const sections = data.sections
    if (sections && typeof sections === 'object') {
      for (const key of Object.keys(sections)) {
        const groups = sections[key]?.groups
        if (!Array.isArray(groups)) continue
        for (const group of groups) {
          if (!Array.isArray(group?.poses)) continue
          for (const pose of group.poses) {
            if (!pose) continue
            if (pose.boneScaleRef === undefined) {
              pose.boneScaleRef =
                typeof pose.referenceFbx === 'string' && pose.referenceFbx.trim() !== ''
            }
            delete pose.referenceFbx
          }
        }
      }
    }
    return data
  },
  // v16 — a JCM "Modify frames" rule kept two separate drive lists (positive /
  // negative rotation); direction is inferred from each drive's angle-range sign
  // now, so the two lists merge into one signed `drives[]`. Pre-zod, or zod would
  // strip the old keys before we could read them.
  16: (data) => {
    if (Array.isArray(data.jcmMorphMods)) {
      for (const mod of data.jcmMorphMods) {
        if (!mod || typeof mod !== 'object') continue
        if (mod.drives === undefined) {
          mod.drives = [
            ...(Array.isArray(mod.positive) ? mod.positive : []),
            ...(Array.isArray(mod.negative) ? mod.negative : []),
          ]
        }
        delete mod.positive
        delete mod.negative
      }
    }
    return data
  },
  // v20 — the ROM `enabled` gate's zod default flipped true → false (a fresh
  // override starts fully disabled). A pre-v20 override that OMITS `enabled` was
  // ACTIVE under the old default; preserve that, so the flip only affects NEW
  // overrides. The UI has always written `enabled` explicitly, so this is a
  // belt-and-suspenders guard against a hand-edited / bare stored override
  // silently deactivating — and its scene CSV vanishing — on the next regenerate.
  20: (data) => {
    if (Array.isArray(data.sceneOverrides)) {
      for (const override of data.sceneOverrides) {
        if (!override || typeof override !== 'object') continue
        if (override.enabled === undefined) override.enabled = true
      }
    }
    return data
  },
  // v23 — a whole-section override became the section's full OWNED config, so a
  // scene can override mode / preset asset / art direction / custom path too (not
  // just groups). The stored entry changed from `{section, groups}` to `{section,
  // config}`. Old entries only ever escalated on structural row edits, which only
  // custom-capable sections have — so wrap the old groups in a `custom` config.
  23: (data) => {
    if (!Array.isArray(data.sceneOverrides)) return data
    for (const override of data.sceneOverrides) {
      if (!override || typeof override !== 'object' || !Array.isArray(override.sectionOverrides))
        continue
      for (const entry of override.sectionOverrides) {
        if (entry && typeof entry === 'object' && entry.config === undefined && entry.groups !== undefined) {
          // 'custom' is right for every entry the UI could produce (only custom-capable
          // sections ever escalated). But a crafted/legacy file could carry an entry for a
          // preset-only section (e.g. RET) — 'custom' there is UNSUPPORTED, and the
          // sectionOverride superRefine is reject-only (unlike the base section schema's
          // absent-mode healing), so it would hard-fail the WHOLE character on load. Heal
          // to the section's own default mode when 'custom' isn't in its SECTION_MODES.
          const modes = SECTION_MODES[entry.section as RomSection]
          entry.config = {
            enabled: true,
            mode: modes && !modes.includes('custom') ? modes[0] : 'custom',
            presetAssets: [],
            artDirection: [],
            groups: entry.groups,
            customAssetPath: '',
          }
          delete entry.groups
        }
      }
    }
    return data
  },
  // v24 — the scene-override restructure. The four parallel ROM layers (`poses`,
  // `additions`, `sectionOverrides`, `sectionEnabled`) became ONE section-keyed
  // `rom` record; the per-scene panels went PRESENCE-armed (`identity`/`preserve`/
  // `jcm` blocks exist iff their old `enabled` was on); and the character-level
  // `groomScenes` map folded into the records as `hair`. Entries that were DEAD
  // under the old precedence — orphaned pose/group ids, sparse layers under an
  // owned section, a disarmed override's rows, a disarmed panel's stored payload —
  // are dropped, not carried: they never generated and the arm-on-edit UI could
  // only resurrect them by rewriting them anyway.
  24: (data) => {
    const overrides: Array<Record<string, any>> = Array.isArray(data.sceneOverrides)
      ? data.sceneOverrides
      : []
    // Attribution maps from the character's own sections: which section a base
    // pose id / group id lives in (a flat `flat-<SECTION>` sentinel encodes its
    // section itself).
    const poseSection = new Map<string, string>()
    const groupSection = new Map<string, string>()
    const sections = data.sections
    if (sections && typeof sections === 'object') {
      for (const key of Object.keys(sections)) {
        const groups = sections[key]?.groups
        if (!Array.isArray(groups)) continue
        for (const group of groups) {
          if (!group || typeof group !== 'object') continue
          if (typeof group.id === 'string') groupSection.set(group.id, key)
          if (!Array.isArray(group.poses)) continue
          for (const pose of group.poses) {
            if (pose && typeof pose === 'object' && typeof pose.id === 'string')
              poseSection.set(pose.id, key)
          }
        }
      }
    }
    const flatSection = (groupId: string): string | undefined => {
      const match = /^flat-(\w+)$/.exec(groupId)
      return match && (ROM_SECTIONS as ReadonlyArray<string>).includes(match[1])
        ? match[1]
        : undefined
    }
    for (const override of overrides) {
      if (!override || typeof override !== 'object') continue
      if (override.rom === undefined) {
        const rom: Record<string, any> = {}
        const entry = (section: string) =>
          (rom[section] ??= { replaced: [], added: [] } as Record<string, any>)
        // The row layers only migrate when the old ROM gate was armed (absent =
        // armed, per the v20 default) — a disarmed override's rows never
        // generated.
        if (override.enabled !== false) {
          if (Array.isArray(override.sectionOverrides)) {
            for (const so of override.sectionOverrides) {
              // Validated like flatSection above: `rom` is a partialRecord over
              // the section enum, and zod 4 REJECTS unknown record keys — an
              // unvalidated string here would brick the whole character over
              // one hand-edited legacy entry (heal, don't brick).
              if (
                so &&
                typeof so === 'object' &&
                typeof so.section === 'string' &&
                (ROM_SECTIONS as ReadonlyArray<string>).includes(so.section) &&
                so.config
              )
                entry(so.section).owned = so.config
            }
          }
          if (Array.isArray(override.poses)) {
            for (const pose of override.poses) {
              if (!pose || typeof pose !== 'object' || typeof pose.id !== 'string') continue
              const section = poseSection.get(pose.id)
              if (section && !rom[section]?.owned) entry(section).replaced.push(pose)
            }
          }
          if (Array.isArray(override.additions)) {
            for (const add of override.additions) {
              if (!add || typeof add !== 'object' || typeof add.groupId !== 'string') continue
              if (!Array.isArray(add.poses) || add.poses.length === 0) continue
              const section = groupSection.get(add.groupId) ?? flatSection(add.groupId)
              if (section && !rom[section]?.owned) entry(section).added.push(add)
            }
          }
        }
        // The enable overlay is independent of the row gate — a preset section
        // can be toggled per scene without any rows stored.
        if (Array.isArray(override.sectionEnabled)) {
          for (const se of override.sectionEnabled) {
            if (
              se &&
              typeof se === 'object' &&
              typeof se.section === 'string' &&
              // Same guard as sectionOverrides above — an unknown section key
              // would fail the whole character's parse.
              (ROM_SECTIONS as ReadonlyArray<string>).includes(se.section) &&
              typeof se.enabled === 'boolean'
            )
              entry(se.section).enabled = se.enabled
          }
        }
        override.rom = rom
      }
      // Presence-armed panels: keep the payload iff the old gate was on. A block
      // WITHOUT an `enabled` key is already the new shape — leave it.
      if (override.identity && typeof override.identity === 'object' && 'enabled' in override.identity) {
        const { enabled, ...rest } = override.identity
        if (enabled) override.identity = rest
        else delete override.identity
      }
      if (override.preserve && typeof override.preserve === 'object' && 'enabled' in override.preserve) {
        const { enabled, ...rest } = override.preserve
        if (enabled) override.preserve = rest
        else delete override.preserve
      }
      if (override.jcm && typeof override.jcm === 'object' && !Array.isArray(override.jcm)) {
        if (override.jcm.enabled && Array.isArray(override.jcm.mods)) override.jcm = override.jcm.mods
        else delete override.jcm
      }
      delete override.groom
      delete override.enabled
      delete override.poses
      delete override.additions
      delete override.sectionOverrides
      delete override.sectionEnabled
    }
    // groomScenes → per-scene `hair`, creating records for scenes that had hair
    // but no override (the PRIMARY scene, typically).
    if (Array.isArray(data.groomScenes)) {
      for (const gs of data.groomScenes) {
        if (!gs || typeof gs !== 'object' || typeof gs.scenePath !== 'string') continue
        const nodes = Array.isArray(gs.nodes) ? gs.nodes : []
        if (nodes.length === 0) continue
        let record = overrides.find(
          (o) => o && typeof o === 'object' && o.scenePath === gs.scenePath,
        )
        if (!record) {
          record = { scenePath: gs.scenePath, rom: {} }
          overrides.push(record)
        }
        if (record.hair === undefined) record.hair = nodes
      }
    }
    delete data.groomScenes
    data.sceneOverrides = overrides
    return data
  },
  // v29 — the per-scene `houdiniProjectFolder` override is gone with the whole
  // v27 export nesting (exports are a fixed, Houdini-independent root now). zod
  // strips the key by itself; what it CANNOT do is notice that dropping it
  // leaves a record carrying nothing — and a record that means exactly what NO
  // record means is the dead stub schema v24 exists to keep out of the JSON.
  // So prune here, on the raw object (mirrors `sceneRecordEmpty`, which can only
  // run post-zod), but ONLY for records that actually carried the field:
  // an already-empty record is left alone, because the v20/v21/v24 steps emit
  // those on purpose. Idempotent: a second pass finds no field to remove.
  29: (data) => {
    if (!Array.isArray(data.sceneOverrides)) return data
    data.sceneOverrides = data.sceneOverrides.filter((override: any) => {
      // Only records THIS removal touches are candidates. An empty record that
      // was already empty is not ours to judge — earlier migrations
      // deliberately produce those, and the editor's writers prune on write.
      if (!override || typeof override !== 'object') return true
      if (!('houdiniProjectFolder' in override)) return true
      delete override.houdiniProjectFolder
      const romEmpty =
        !override.rom || typeof override.rom !== 'object' || Object.keys(override.rom).length === 0
      return !(
        romEmpty &&
        (!Array.isArray(override.hair) || override.hair.length === 0) &&
        override.identity === undefined &&
        override.preserve === undefined &&
        override.jcm === undefined &&
        override.frameZero === undefined
      )
    })
    return data
  },
  // ── TEMPLATES — copy one, set N = the new CHARACTER_SCHEMA_VERSION ──────────
  //
  // Case A — rename / restructure an existing field:
  //   7: (data) => {
  //     if (data.newName === undefined && data.oldName !== undefined) {
  //       data.newName = transform(data.oldName)
  //     }
  //     delete data.oldName
  //     return data
  //   },
  //
  // Case B — new field whose value is DERIVED from the character's own data
  //          (a static zod default can't express it). Keep a schema default too —
  //          it covers brand-new characters; this fills the meaningful value for
  //          existing ones (and the guard keeps it idempotent):
  //   8: (data) => {
  //     if (data.frameBudget === undefined) {
  //       data.frameBudget = countCustomFrames(data.sections)
  //     }
  //     return data
  //   },
  //
  // Case C — value needs host context (settings / filesystem / active release):
  //   DON'T do it here (this module is pure). Give the field a nullable/'' schema
  //   default so an old character is valid the moment it loads, then resolve the
  //   real value in apps/web/src/lib/rom/storage.ts `parseCharacter`, AFTER
  //   migrateCharacterData() — exactly how `canonicalImage` post-processes
  //   `data.image` today. (Tools → Refresh assets then re-saves it, persisting
  //   the resolved value.)
}

/**
 * Pre-versioning shape normalization — the implicit "before `schemaVersion` → v1"
 * migration. Legacy definitions stored flat `entries` / `groups` / `options`
 * instead of `sections`, a GEN `presetVariant` instead of `presetAssets`, and a
 * "none" group suffix. These transforms are shape-detected and idempotent, so
 * they run on every read and are no-ops for already-current data. (The old
 * `resetGPBeforeApplying` flag once mapped here too; its successor field was
 * removed in schema v11, so either spelling is now simply stripped by zod.)
 */
export function normalizeLegacyCharacter(data: Record<string, any>): Record<string, any> {
  if (data.sections) {
    // v3 stored a GEN presetVariant instead of selected preset asset files.
    // The guard is on LENGTH, not presence: a transitional file carrying the
    // legacy presetVariant next to an EMPTY presetAssets array (e.g. written by
    // a build that added the field before this fold ran) still means "the
    // user's selection lives in presetVariant" — `!gen.presetAssets` alone
    // discarded it. A non-empty presetAssets always wins (never clobbered).
    const gen = data.sections.GEN
    if (gen?.presetVariant && !gen.presetAssets?.length) {
      gen.presetAssets =
        gen.presetVariant === 'both'
          ? ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf']
          : gen.presetVariant === 'dk'
            ? ['DK9 - Dicktator.duf']
            : ['GP9 - Golden Palace.duf']
    }
  }
  if (!data.sections) {
    const sections = Array.isArray(data.entries)
      ? sectionsFromFlatFrames(data.entries)
      : defaultSections()
    if (Array.isArray(data.groups)) {
      for (const group of data.groups) {
        // A hand-edited legacy JSON can carry null/non-object entries — skip
        // them so the definition flows to migrateCharacterData's promised clean
        // zod "unreadable definition" failure, never a raw TypeError in here.
        if (!group || typeof group !== 'object') continue
        const section: RomSection = (ROM_SECTIONS as ReadonlyArray<string>).includes(group.section)
          ? group.section
          : 'MISC'
        const { section: _ignored, ...rest } = group
        // Legacy flat groups predate stable ids; `romGroupSchema.id` /
        // `romPoseSchema.id` have no zod default, so a folded group/pose lacking
        // one fails the whole character parse ("unreadable definition"). Mint
        // ids here so the folded result is schema-valid.
        if (rest.id === undefined) rest.id = newId()
        if (Array.isArray(rest.poses)) {
          for (const pose of rest.poses) {
            if (pose && typeof pose === 'object' && pose.id === undefined) pose.id = newId()
          }
        }
        sections[section].enabled = true
        sections[section].mode = 'custom'
        sections[section].groups.push(rest)
      }
    }
    const options = data.options ?? {}
    if (options.includeJCM === false) {
      sections.RET.enabled = false
      if (sections.JCM.mode === 'preset') sections.JCM.enabled = false
    }
    if (options.includeFAC === false && sections.FAC.mode === 'preset') {
      sections.FAC.enabled = false
    }
    if ((options.includeGP || options.includeDK) && sections.GEN.mode === 'preset') {
      sections.GEN.enabled = true
      sections.GEN.presetAssets = [
        ...(options.includeGP ? ['GP9 - Golden Palace.duf'] : []),
        ...(options.includeDK ? ['DK9 - Dicktator.duf'] : []),
      ]
    }
    data.sections = sections
    delete data.entries
    delete data.groups
    delete data.options
  }
  // The PoseAsset node knows no "none" suffix — older data migrates to centre.
  for (const config of Object.values((data.sections ?? {}) as Record<string, any>)) {
    for (const group of config?.groups ?? []) {
      // Same guard as the fold above: a null/non-object entry stays for zod to
      // reject cleanly instead of throwing a TypeError here.
      if (!group || typeof group !== 'object') continue
      if (group.suffix === 'none') group.suffix = 'centre'
    }
  }
  return data
}

/**
 * Thrown by {@link migrateCharacterData} when a definition's stored
 * `schemaVersion` is a genuine integer ABOVE {@link CHARACTER_SCHEMA_VERSION} —
 * the JSON was saved by a newer build. The old behavior (clamp to current, keep
 * going) was a silent downgrade: zod then STRIPPED the newer build's fields and
 * the next save destroyed them for good. Failing loud lets the host tell the
 * user to update the app instead. Carries both versions so the UI can say
 * exactly what it found.
 */
export class CharacterSchemaTooNewError extends Error {
  readonly storedVersion: number
  readonly supportedVersion: number
  constructor(storedVersion: number, supportedVersion: number = CHARACTER_SCHEMA_VERSION) {
    super(
      `This character was saved by a newer version of DTH Character Studio ` +
        `(schema v${storedVersion}; this build supports up to v${supportedVersion}). ` +
        `Update the app to open it — editing it here would discard the newer fields.`,
    )
    this.name = 'CharacterSchemaTooNewError'
    this.storedVersion = storedVersion
    this.supportedVersion = supportedVersion
  }
}

/**
 * Bring a raw character definition (straight from JSON) to the current schema
 * shape: first the pre-versioning normalization, then each registered migration
 * step from the stored `schemaVersion` up to {@link CHARACTER_SCHEMA_VERSION}.
 * Returns the migrated raw object for the caller to validate (zod) and stamp.
 *
 * The stored `schemaVersion` is left untouched, so callers can still tell a
 * migrated-on-read definition (stored value below current) apart from one already
 * saved at the current version — the version is bumped only when the definition is
 * written back to disk (see storage `saveCharacter`).
 *
 * @throws {CharacterSchemaTooNewError} when the stored `schemaVersion` is an
 *   integer above {@link CHARACTER_SCHEMA_VERSION} (a file from a newer build) —
 *   proceeding would silently strip its fields and a later save would destroy
 *   them. Thrown BEFORE any normalization touches the data. Pass
 *   `{ allowDowngrade: true }` to suppress this and force the file down to the
 *   current shape instead (zod then drops the newer fields): a deliberate,
 *   lossy reset — see `resetDefinitionToCurrentVersion` in the web storage layer.
 */
export function migrateCharacterData(
  raw: unknown,
  opts: {
    /** Force a forward-version file down to the current schema instead of
     *  throwing — the newer fields are dropped. Off by default (data safety). */
    allowDowngrade?: boolean
  } = {},
): Record<string, any> {
  // Non-object input (null, an array, a bare string…) must flow into a clean
  // zod validation failure downstream — not a TypeError inside the legacy
  // normalizer. Such input starts from an empty object, which zod then rejects
  // with its usual required-field errors.
  const base =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, any>)
      : {}
  // A REAL forward version (a well-formed integer above current) is a file from
  // a newer build — refuse before touching it. Only the trustworthy shape
  // throws: a fractional/NaN/absurd value is corruption, not provenance, and
  // falls into the clamp below like every other corrupt version.
  const stored = base.schemaVersion
  if (
    !opts.allowDowngrade &&
    typeof stored === 'number' &&
    Number.isInteger(stored) &&
    stored > CHARACTER_SCHEMA_VERSION
  ) {
    throw new CharacterSchemaTooNewError(stored)
  }
  let data = normalizeLegacyCharacter(base)
  // Clamp the stored version to a sane integer in [1, CURRENT]. A corrupt or
  // hand-edited definition carrying a hugely negative `schemaVersion` (e.g.
  // -9e15) would otherwise spin the loop below ~9 quadrillion times and hang
  // the app at project open — `migrateCharacterData` runs on every read, and
  // zod's `int().positive()` guard only runs AFTER migration. A fractional
  // value collapses to 1 (running every idempotent step) rather than silently
  // skipping registered steps; integers above current threw above.
  const from =
    typeof stored === 'number' && Number.isInteger(stored) && stored >= 1 ? stored : 1
  for (let version = from + 1; version <= CHARACTER_SCHEMA_VERSION; version++) {
    const step = characterMigrations[version]
    if (step) data = step(data)
  }
  return data
}
