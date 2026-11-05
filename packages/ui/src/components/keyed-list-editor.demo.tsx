import { useState } from 'react'

import { Input, KeyedListEditor } from '../index.ts'

type Node = { name: string }

function Editor({ initial, emptyHint }: { initial: Node[]; emptyHint?: string }) {
  const [items, setItems] = useState(initial)
  return (
    <div style={{ padding: 16, maxWidth: 420 }}>
      <KeyedListEditor
        items={items}
        onChange={setItems}
        newItem={() => ({ name: '' })}
        addLabel="Add node"
        removeLabel="Remove node"
        emptyHint={emptyHint}
      >
        {(item, set) => <Input value={item.name} onChange={(e) => set({ name: e.target.value })} aria-label="Node" />}
      </KeyedListEditor>
    </div>
  )
}

export function Populated() {
  return <Editor initial={[{ name: 'hip' }, { name: 'pelvis' }, { name: 'lThighBend' }]} />
}

export function Empty() {
  return <Editor initial={[]} emptyHint="No preserved nodes. Add the ones Houdini must keep as authored." />
}
