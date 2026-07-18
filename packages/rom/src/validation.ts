import { sanitizePoseName } from './generate.ts'
import { walkCustomPoses } from './frames.ts'
import { SECTION_LABELS } from './types.ts'
import type { RomSection, RomSections } from './types.ts'

/** A required custom-section field that's empty, or a pose name Houdini can't
 *  accept — either blocks generation/save. */
export interface RomValidationError {
  section: RomSection
  groupId: string
  poseId: string
  /** `name` = the pose's name; `morphName` = a morph's property name. */
  field: 'name' | 'morphName'
  /** Which morph in the pose (only for `morphName`). */
  morphIndex?: number
  /** 0-based position of the pose in the custom sequence (its relative frame). */
  relativeFrame: number
  message: string
}

/**
 * Every invalid required field across the enabled custom sections, in canonical
 * (frame) order — so `errors[0]` is the first offending field on the timeline. A
 * custom pose needs a name and at least one morph, and every morph needs a
 * property name; those are the fields the user types and the generator can't
 * invent. The name must also be Houdini-safe (letters, numbers, underscores) —
 * anything else the generator would silently strip, so it's flagged to save
 * instead. This mirrors the live cell validation so a red-bordered field can
 * never slip past Save. Preset sections have nothing to fill in, so they never
 * error.
 */
export function romValidationErrors(sections: RomSections): Array<RomValidationError> {
  const errors: Array<RomValidationError> = []
  // Sanitized name → first relative frame, per suffix scope: two poses whose
  // sanitized names collide within the same suffix become the SAME morph name
  // in Unreal (the group suffix appends _l/_r), where one silently overwrites
  // the other — flag the collision here instead.
  const seen = new Map<string, number>()
  for (const { section, group, pose, relativeFrame } of walkCustomPoses(sections)) {
    const at = `${SECTION_LABELS[section]} frame ${relativeFrame}`
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
      const key = `${group.suffix}:${sanitizePoseName(pose.name)}`
      const first = seen.get(key)
      if (first === undefined) {
        seen.set(key, relativeFrame)
      } else {
        errors.push({
          section,
          groupId: group.id,
          poseId: pose.id,
          field: 'name',
          relativeFrame,
          message: `${at}: duplicate pose name — frame ${first} already uses it (same suffix), so both would become the same Unreal morph.`,
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
