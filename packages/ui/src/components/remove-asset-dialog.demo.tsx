import { RemoveAssetDialog } from '../index.ts'

export const height = 380

const noop = () => {}

export function Default() {
  return (
    <RemoveAssetDialog
      title="Unlink KiraSummertide_G9_GP.duf?"
      description="The scene stays on disk. Its hair items and ROM overrides are dropped."
      deleteFile={false}
      onDeleteFileChange={noop}
      busy={false}
      onConfirm={noop}
      onClose={noop}
    />
  )
}

export function LinkedInPlace() {
  return (
    <RemoveAssetDialog
      title="Unlink Kira.hip?"
      description="D:/Elsewhere/Kira.hip is linked in place and is never deleted."
      deleteFileDisabled
      onDeleteFileChange={noop}
      busy={false}
      onConfirm={noop}
      onClose={noop}
    />
  )
}

export function Failed() {
  return (
    <RemoveAssetDialog
      title="Remove KiraDefault_G9_GP.duf?"
      description="This deletes the file from D:/DTH Projects/Demo/Kira/daz3d."
      deleteFile
      onDeleteFileChange={noop}
      deleteLabel="Remove"
      busy={false}
      error="Access denied: the file is open in Daz Studio."
      onConfirm={noop}
      onClose={noop}
    />
  )
}
