import { useState } from 'react'
import { z } from 'zod'

import { Textarea } from '#/components/ui/textarea.tsx'
import { jcmMorphModSchema } from '@dth/rom'

import type { Character } from '@dth/rom'

export function JcmModsEditor({
  value,
  onCommit,
}: {
  value: Character['jcmMorphMods']
  onCommit: (mods: Character['jcmMorphMods']) => void
}) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2))
  const [error, setError] = useState('')
  return (
    <div>
      <Textarea
        className="min-h-32 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try {
            const parsed = z.array(jcmMorphModSchema).parse(JSON.parse(draft))
            setError('')
            onCommit(parsed)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">Invalid: {error}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        JSON array of {'{'} boneLabel, axis, positive[], negative[] {'}'} — drives morphs
        proportionally to bone rotations across the JCM ROM.
      </p>
    </div>
  )
}
