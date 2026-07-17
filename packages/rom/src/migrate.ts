import { sectionsFromFlatFrames } from './frames'
import { CHARACTER_SCHEMA_VERSION, ROM_SECTIONS, defaultSections } from './types'

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
    const gen = data.sections.GEN
    if (gen?.presetVariant && !gen.presetAssets) {
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
        const section: RomSection = (ROM_SECTIONS as ReadonlyArray<string>).includes(group.section)
          ? group.section
          : 'MISC'
        const { section: _ignored, ...rest } = group
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
      if (group.suffix === 'none') group.suffix = 'centre'
    }
  }
  return data
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
 */
export function migrateCharacterData(raw: unknown): Record<string, any> {
  let data = normalizeLegacyCharacter(raw as Record<string, any>)
  const from = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
  for (let version = from + 1; version <= CHARACTER_SCHEMA_VERSION; version++) {
    const step = characterMigrations[version]
    if (step) data = step(data)
  }
  return data
}
