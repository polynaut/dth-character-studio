import { describe, expect, it } from 'vitest'

import { CHARACTER_INTERNAL_FILES, relocatableInternals } from './character-internals.ts'

// The rule that decides which files leave a character folder for `.dcsmeta`.
// Getting it wrong in either direction is bad in a different way: too narrow
// leaves the clutter this move exists to remove, too wide moves a file the user
// put there — which is why it is an intersection with the studio's own names
// rather than a pattern.

const OWNED = [...CHARACTER_INTERNAL_FILES, 'Kira_pose_asset.csv', 'Kira_Beach_pose_asset.csv']

describe('relocatableInternals', () => {
  it('picks the studio-written files and leaves everything else alone', () => {
    expect(
      relocatableInternals(
        [
          'Kira.json',
          'Kira.notes.md',
          '.dth_execute_stamps.json',
          '.dth_export_folders.json',
          '.last_rom_run.json',
          'dth_rom_run_log.json',
          'Kira_pose_asset.csv',
          'Kira_Beach_pose_asset.csv',
        ],
        OWNED,
      ),
    ).toEqual([
      '.dth_execute_stamps.json',
      '.dth_export_folders.json',
      '.last_rom_run.json',
      'dth_rom_run_log.json',
      'Kira_pose_asset.csv',
      'Kira_Beach_pose_asset.csv',
    ])
  })

  it("never claims a CSV the studio didn't write for this character", () => {
    // A delivered CSV copied back out of an export folder, and another
    // character's — both match `*_pose_asset.csv`, neither is ours.
    expect(
      relocatableInternals(
        ['Kira_Summertide_v2_pose_asset.csv', 'Electra_pose_asset.csv', 'my_pose_asset.csv'],
        OWNED,
      ),
    ).toEqual([])
  })

  it('matches case-insensitively and reports the name as it is on disk', () => {
    // Windows resolves names case-insensitively, and `characterSlug` preserves
    // the character's own casing — so a case-only rename must still match, and
    // the move has to use the real on-disk spelling.
    expect(relocatableInternals(['kira_Pose_Asset.csv', '.DTH_Execute_Stamps.json'], OWNED)).toEqual(
      ['kira_Pose_Asset.csv', '.DTH_Execute_Stamps.json'],
    )
  })

  it('is empty for a folder that holds none of them', () => {
    expect(relocatableInternals(['Kira.json', 'daz3d'], OWNED)).toEqual([])
    expect(relocatableInternals([], OWNED)).toEqual([])
  })
})
