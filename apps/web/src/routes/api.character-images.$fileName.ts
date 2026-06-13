import { createFileRoute } from '@tanstack/react-router'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Serves the uploaded character avatars from data/images/. */
export const Route = createFileRoute('/api/character-images/$fileName')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { readFile } = await import('node:fs/promises')
        const { basename, extname } = await import('node:path')
        const { dataPath } = await import('../server/paths')
        // basename() blocks path traversal.
        const fileName = basename(params.fileName)
        const contentType = CONTENT_TYPES[extname(fileName).toLowerCase()]
        if (!contentType) return new Response('Unsupported file type', { status: 400 })
        try {
          const data = await readFile(dataPath('images', fileName))
          return new Response(new Uint8Array(data), {
            headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
          })
        } catch {
          return new Response('Not found', { status: 404 })
        }
      },
    },
  },
})
