/**
 * Uploads missing media files to Vercel Blob, under the exact filenames the database already records.
 *
 * Needed when media records exist (e.g. `pnpm migrate:wp` was run against Neon without
 * BLOB_READ_WRITE_TOKEN) but their files never reached Blob, so /api/media/file/* returns 404.
 * The original is read from public/media when it is there (uploads made with local storage, e.g.
 * `pnpm seed:media-centre` with MEDIA_STORAGE=local), otherwise re-downloaded from `wpSourceUrl`.
 * Image sizes are taken from public/media too, or regenerated with sharp at the recorded dimensions.
 * Database records are not modified, so post links keep working.
 *
 *   DATABASE_URL=<neon url> pnpm repair:media              # upload what's missing
 *   DATABASE_URL=<neon url> pnpm repair:media dry-run      # only report
 */
import config from '@payload-config'
import { list, put } from '@vercel/blob'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload } from 'payload'
import sharp from 'sharp'

const LOCAL_DIR = path.resolve('public/media')
const readLocal = (filename: string) => fs.readFile(path.join(LOCAL_DIR, filename)).catch(() => null)

const DRY_RUN = process.argv.includes('dry-run')
const CONCURRENCY = 5
const token = process.env.BLOB_READ_WRITE_TOKEN
if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is not set')

const payload = await getPayload({ config })

// Everything already in the store, by pathname.
const existing = new Set<string>()
let cursor: string | undefined
do {
  const page = await list({ cursor, limit: 1000, token })
  page.blobs.forEach((b) => existing.add(b.pathname))
  cursor = page.cursor
} while (cursor)
console.log(`Blob store holds ${existing.size} files`)

const sizeConfigs = new Map(
  (payload.collections.media.config.upload.imageSizes || []).map((s) => [s.name, s]),
)

const upload = (pathname: string, body: Buffer, contentType: string) =>
  put(pathname, body, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType, token })

type Stats = { ok: number; skipped: number; failed: { id: unknown; filename: string; error: string }[] }
const stats: Stats = { ok: 0, skipped: 0, failed: [] }

async function repair(doc: any) {
  const sizes = Object.entries((doc.sizes || {}) as Record<string, any>).filter(([, s]) => s?.filename)
  const missing = [doc.filename, ...sizes.map(([, s]) => s.filename)].filter((f) => f && !existing.has(f))
  if (!missing.length) return void stats.skipped++
  if (DRY_RUN) {
    console.log(`would upload ${missing.length} file(s) for #${doc.id} ${doc.filename}`)
    return void stats.ok++
  }
  let original = await readLocal(doc.filename)
  if (!original) {
    if (!doc.wpSourceUrl) throw new Error('not in public/media and no wpSourceUrl to download it from')
    const res = await fetch(doc.wpSourceUrl)
    if (!res.ok) throw new Error(`download ${res.status} ${doc.wpSourceUrl}`)
    original = Buffer.from(await res.arrayBuffer())
  }

  if (!existing.has(doc.filename)) await upload(doc.filename, original, doc.mimeType)

  for (const [name, size] of sizes) {
    if (existing.has(size.filename)) continue
    const local = await readLocal(size.filename)
    if (local) {
      await upload(size.filename, local, size.mimeType || doc.mimeType)
      continue
    }
    const cfg = sizeConfigs.get(name)
    const fixedBox = Boolean(cfg?.width && cfg?.height)
    const image = sharp(original, { animated: doc.mimeType === 'image/gif' }).rotate()
    const resized = await image
      .resize({
        width: size.width,
        height: fixedBox ? size.height : undefined,
        fit: fixedBox ? 'cover' : 'inside',
        position: 'centre',
        withoutEnlargement: !fixedBox,
      })
      .toBuffer()
    await upload(size.filename, resized, size.mimeType || doc.mimeType)
  }
  stats.ok++
  console.log(`✓ #${doc.id} ${doc.filename} (${missing.length} file(s))`)
}

let page = 1
let hasNext = true
while (hasNext) {
  const result = await payload.find({ collection: 'media', depth: 0, limit: 50, page, pagination: true })
  const queue = [...result.docs]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let doc = queue.shift(); doc; doc = queue.shift()) {
        try {
          await repair(doc)
        } catch (err: any) {
          stats.failed.push({ id: doc.id, filename: doc.filename as string, error: err?.message || String(err) })
          console.error(`✗ #${doc.id} ${doc.filename}: ${err?.message}`)
        }
      }
    }),
  )
  hasNext = result.hasNextPage
  page++
}

console.log(
  `\nDone${DRY_RUN ? ' (dry run)' : ''}: ${stats.ok} repaired, ${stats.skipped} already complete, ${stats.failed.length} failed`,
)
if (stats.failed.length) console.table(stats.failed)
process.exit(stats.failed.length ? 1 : 0)
