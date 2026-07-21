import { sanitizePoseName } from './generate.ts'
import { jcmIsBaseRom, walkCustomPoses } from './frames.ts'
import { SECTION_LABELS } from './types.ts'
import type { RomSection, RomSections } from './types.ts'

/** A required custom-section field that's empty, a pose name Houdini can't
 *  accept, or a section-level configuration the runtime can't honor — any of
 *  them blocks generation/save. */
export interface RomValidationError {
  section: RomSection
  /** The offending group's id — '' for a section-level (`config`) error. */
  groupId: string
  /** The offending pose's id — '' for group/section-level errors. For an
   *  art-direction morph error this is the art-direction FRAME's id. */
  poseId: string
  /** `name` = the pose's name; `morphName` = a morph's property name (custom
   *  pose or art-direction frame); `label` = a group's driver-bone list (the
   *  CSV `bones` column); `config` = a section-level configuration error. */
  field: 'name' | 'morphName' | 'label' | 'config'
  /** Which morph in the pose / art-direction frame (only for `morphName`). */
  morphIndex?: number
  /** 0-based position of the pose in the custom sequence (its relative frame);
   *  -1 for errors with no custom-frame position (`config`, `label`,
   *  art-direction morphs keep their group/frame ids instead). */
  relativeFrame: number
  message: string
}

/** The sections whose custom groups NEED a driver-bone label (CSV `bones`
 *  column): a JCM morph must be driven by a joint, a PHY pose pushed from a
 *  bone. GEN groups are exempt — the ground-truth GP template ships label-less
 *  GENGROUP rows (generation-method driven), so empty is a valid state there. */
const REQUIRED_LABEL_SECTIONS: ReadonlyArray<RomSection> = ['JCM', 'PHY']

/**
 * Every invalid required field across the enabled custom sections, in canonical
 * (frame) order — so the first frame-positioned error is the first offending
 * field on the timeline. A custom pose needs a name and at least one morph, and
 * every morph needs a property name; those are the fields the user types and the
 * generator can't invent. The name must also be Houdini-safe (letters, numbers,
 * underscores) — anything else the generator would silently strip, so it's
 * flagged to save instead. This mirrors the live cell validation so a
 * red-bordered field can never slip past Save.
 *
 * Beyond the per-cell checks: section-level `config` errors (emitted FIRST,
 * before the walk) flag configurations the runtime can't honor — currently FAC
 * preset without a JCM base ROM (the FAC frames live INSIDE the base; enabling
 * FAC alone would stamp `bIncludeFAC` over zero frames). JCM/PHY custom groups
 * flag an empty driver-bone `label`, and GEN preset art-direction frames flag
 * empty morph property names — both feed the HDA/runtime verbatim.
 *
 * `reservedPoseNames` are the RESOLVED Unreal morph names the preset/template
 * blocks already export (see `templateBakedPoseNames`) — a custom pose that
 * resolves to one of them would silently overwrite the baked morph in Unreal,
 * so the collision is flagged exactly like a custom↔custom duplicate.
 */
export function romValidationErrors(
  sections: RomSections,
  reservedPoseNames?: Iterable<string>,
): Array<RomValidationError> {
  const errors: Array<RomValidationError> = []

  // ── Section-level config errors (no frame position) ────────────────────────
  if (sections.FAC.enabled && sections.FAC.mode === 'preset' && !jcmIsBaseRom(sections)) {
    errors.push({
      section: 'FAC',
      groupId: '',
      poseId: '',
      field: 'config',
      relativeFrame: -1,
      message:
        'Face: the FAC preset frames live inside the JCM base ROM — enable JCM ' +
        '(preset, or custom with a base .duf) or switch Face off/custom.',
    })
  }

  // ── GEN preset art direction: morph property names feed the runtime verbatim ─
  if (sections.GEN.enabled && sections.GEN.mode === 'preset') {
    for (const frame of sections.GEN.artDirection) {
      frame.morphs.forEach((morph, morphIndex) => {
        if (morph.prop.trim() === '') {
          errors.push({
            section: 'GEN',
            groupId: '',
            poseId: frame.id,
            field: 'morphName',
            morphIndex,
            relativeFrame: -1,
            message: `Art direction “${frame.name}”: a morph name is empty.`,
          })
        }
      })
    }
  }

  // Resolved Unreal morph name -> first relative frame. The group suffix appends
  // _l/_r (centre appends nothing — see romPoseSchema), so two poses collide when
  // their sanitized-name-plus-suffix RESOLVE equal, even across different suffix
  // scopes (a centre `Smile_l` and a left `Smile` both become `Smile_l`). Keying
  // on the resolved name catches that cross-scope case, not just same-scope dupes;
  // one silently overwrites the other in Unreal, so flag it here instead.
  const suffixToken: Record<string, string> = { left: '_l', right: '_r', centre: '' }
  const seen = new Map<string, number>()
  const reserved = new Set(reservedPoseNames ?? [])
  for (const { section, group, pose, relativeFrame, firstInGroup } of walkCustomPoses(sections)) {
    const at = `${SECTION_LABELS[section]} frame ${relativeFrame}`
    // A group that emits rows needs its driver bones (the CSV `bones` column) —
    // an empty list ships a JCM/PHY group the HDA/runtime can't drive. Emitted
    // once per group, at its first pose (an empty group emits no rows at all).
    if (firstInGroup && REQUIRED_LABEL_SECTIONS.includes(section) && group.label.trim() === '') {
      errors.push({
        section,
        groupId: group.id,
        poseId: '',
        field: 'label',
        relativeFrame: -1,
        message: `${SECTION_LABELS[section]}: a group has no driver bone(s) — fill in the bones field.`,
      })
    }
    if (pose.name.trim() === '') {
      errors.push({
        section,
        groupId: group.id,
        poseId: pose.id,
        field: 'name',
        relativeFrame,
        message: `${at}: the pose name is empty.`,
      })
    } else if (pose.name !== sanitizePoseName(pose.name)) {
      errors.push({
        section,
        groupId: group.id,
        poseId: pose.id,
        field: 'name',
        relativeFrame,
        message: `${at}: the pose name has characters Houdini rejects — use letters, numbers and underscores only.`,
      })
    } else {
      // The final Unreal morph name = sanitized pose name + the group's suffix
      // token; collisions are keyed on that so cross-scope dupes are caught too.
      const key = `${sanitizePoseName(pose.name)}${suffixToken[group.suffix] ?? ''}`
      const first = seen.get(key)
      if (reserved.has(key)) {
        errors.push({
          section,
          groupId: group.id,
          poseId: pose.id,
          field: 'name',
          relativeFrame,
          message: `${at}: the name “${key}” is already exported by the preset ROM — both would become the same Unreal morph.`,
        })
      } else if (first === undefined) {
        seen.set(key, relativeFrame)
      } else {
        errors.push({
          section,
          groupId: group.id,
          poseId: pose.id,
          field: 'name',
          relativeFrame,
          message: `${at}: duplicate morph name “${key}” — frame ${first} already resolves to it, so both would become the same Unreal morph.`,
        })
      }
    }
    if (pose.morphs.length === 0) {
      errors.push({
        section,
        groupId: group.id,
        poseId: pose.id,
        field: 'morphName',
        morphIndex: 0,
        relativeFrame,
        message: `${at}: no morph is set.`,
      })
    }
    pose.morphs.forEach((morph, morphIndex) => {
      if (morph.prop.trim() === '') {
        errors.push({
          section,
          groupId: group.id,
          poseId: pose.id,
          field: 'morphName',
          morphIndex,
          relativeFrame,
          message: `${at}: a morph name is empty.`,
        })
      }
    })
  }
  return errors
}
