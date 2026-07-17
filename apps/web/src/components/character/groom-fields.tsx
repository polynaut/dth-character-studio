import { InfoPopup, Input, KeyedListEditor, Label } from '@dth/ui'

import type { Character } from '@dth/rom'

/**
 * The "groom items" list of the character editor's Export section: scene items
 * (hair — usually the fitted cap; its children ride along) the generated script
 * unfits + unparents around the DTH export and restores afterwards, so one
 * scene carries full hair while the ROM export stays clean. With items listed
 * (and an export folder set) generation also emits the standalone
 * `Export_Groom_<Name>.dsa` (frame-0 Alembic of just the groom). `patch` is the
 * route's partial-Character updater — saved with the ordinary Save.
 */
export function GroomFields({
  character,
  patch,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
}) {
  return (
    <div className="max-w-xl">
      <Label className="mb-2 flex w-fit items-center gap-1">
        Groom items kept out of the export (hair)
        <InfoPopup label="Groom items kept out of the export — more information">
          Scene items listed here are unfitted and moved out of the figure right before the DTH
          Exporter runs, then restored — the exporter ignores visibility, so hiding hair is not
          enough. List the top fitted item (e.g. the hair cap); its children ride along. Enter the
          label exactly as shown in Daz's Scene pane. With groom items listed, generation also
          writes an <code>Export_Groom</code> script that exports just the hair at frame 0 as
          Alembic (needs Daz's Alembic Exporter add-on).
        </InfoPopup>
      </Label>
      <KeyedListEditor
        items={character.groomNodes}
        onChange={(groomNodes) => patch({ groomNodes })}
        newItem={() => ({ nodeLabel: '' })}
        addLabel="Add groom item"
      >
        {(item, set) => (
          <Input
            value={item.nodeLabel}
            placeholder="dForce Black Tie Cap"
            onChange={(e) => set({ nodeLabel: e.target.value })}
          />
        )}
      </KeyedListEditor>
    </div>
  )
}
