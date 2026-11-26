/**
 * Imports the media centre stories from the website repo into the `media-centre` collection.
 *
 * Reads, from the website repo (bn_revamp-fe-web):
 *   src/features/media-centre/data/media-items.json   - the stories
 *   src/features/media-centre/data/media-centre.json  - `hero.storyId` / `hero.image` = the featured story
 *   public/...                                         - the card images, hero image and PDFs
 * Images and PDFs are uploaded to `media` (Vercel Blob when BLOB_READ_WRITE_TOKEN is set).
 *
 * Safe to re-run: stories are matched on slug (the JSON `id`) and updated in place, and files
 * already in `media` (same filename) are reused instead of uploaded again.
 *
 * Run (from the CMS root). `payload run` swallows --flags, so options are plain words:
 *   pnpm seed:media-centre                         # website repo at ../../bn/code/bn_revamp-fe-web
 *   pnpm seed:media-centre source=/path/to/fe-repo
 *   pnpm seed:media-centre dry-run                 # check every file exists, write nothing
 */
import config from '@payload-config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload } from 'payload'

type SourceItem = {
  id: string
  title: string
  excerpt?: string
  category: string
  publishedAt: string
  readTime: string
  image: { src: string; alt: string }
  href: string
}

const args = process.argv.slice(2).map((a) => a.replace(/^-+/, ''))
const DRY_RUN = args.includes('dry-run')
const SOURCE = path.resolve(
  args.find((a) => a.startsWith('source='))?.slice('source='.length) ||
    process.env.MEDIA_CENTRE_SOURCE ||
    '../../bn/code/bn_revamp-fe-web',
)
const DATA_DIR = path.join(SOURCE, 'src/features/media-centre/data')
const PUBLIC_DIR = path.join(SOURCE, 'public')

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
}

// Skip the website revalidation hooks etc. that other collections may listen for.
const CONTEXT = { disableRevalidate: true }

const items: SourceItem[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'media-items.json'), 'utf8'))
const page = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'media-centre.json'), 'utf8'))
const heroId: string | undefined = page?.hero?.storyId
const heroImageSrc: string | undefined = page?.hero?.image?.src

// Fail before writing anything if a file is missing.
const missing: string[] = []
for (const src of [
  ...items.flatMap((i) => [i.image.src, ...(i.href.startsWith('/') ? [i.href] : [])]),
  ...(heroImageSrc ? [heroImageSrc] : []),
]) {
  await fs.access(path.join(PUBLIC_DIR, src)).catch(() => missing.push(src))
}
if (missing.length) {
  console.error(`Missing ${missing.length} file(s) under ${PUBLIC_DIR}:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}
console.log(`${items.length} stories found in ${DATA_DIR}; all files present.`)
if (DRY_RUN) process.exit(0)

const payload = await getPayload({ config })
const mediaCache = new Map<string, number>()

/** Uploads `/media/...` from the website's public folder, or reuses the copy already in `media`. */
async function upload(src: string, alt = ''): Promise<number> {
  const cached = mediaCache.get(src)
  if (cached) return cached
  const name = path.basename(src)
  const existing = await payload.find({
    collection: 'media',
    where: { filename: { equals: name } },
    limit: 1,
    depth: 0,
  })
  let id = existing.docs[0]?.id
  if (!id) {
    const data = await fs.readFile(path.join(PUBLIC_DIR, src))
    const mimetype = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'
    const doc = await payload.create({
      collection: 'media',
      data: { alt },
      file: { data, mimetype, name, size: data.length },
      context: CONTEXT,
    })
    id = doc.id
  }
  mediaCache.set(src, id)
  return id
}

const stats = { created: 0, updated: 0, failed: [] as { id: string; error: string }[] }

for (const [n, item] of items.entries()) {
  try {
    const isFile = item.href.startsWith('/')
    const featured = item.id === heroId
    const data = {
      title: item.title,
      excerpt: item.excerpt ?? null,
      category: item.category as any,
      // Noon UTC so the calendar day is the same in every timezone.
      publishedAt: new Date(`${item.publishedAt}T12:00:00.000Z`).toISOString(),
      readTime: item.readTime,
      image: await upload(item.image.src, item.image.alt),
      linkType: (isFile ? 'file' : 'external') as 'file' | 'external',
      file: isFile ? await upload(item.href) : null,
      url: isFile ? null : item.href,
      featured,
      featuredImage: featured && heroImageSrc ? await upload(heroImageSrc, page.hero.image.alt) : null,
      slug: item.id,
      generateSlug: false,
      _status: 'published' as const,
    }

    const existing = await payload.find({
      collection: 'media-centre',
      where: { slug: { equals: item.id } },
      limit: 1,
      depth: 0,
      draft: true,
    })
    if (existing.docs[0]) {
      await payload.update({ collection: 'media-centre', id: existing.docs[0].id, data, context: CONTEXT })
      stats.updated++
    } else {
      await payload.create({ collection: 'media-centre', data, context: CONTEXT })
      stats.created++
    }
    console.log(`[${n + 1}/${items.length}] ${item.id}${featured ? '  (featured)' : ''}`)
  } catch (err: any) {
    stats.failed.push({ id: item.id, error: err?.message || String(err) })
    console.error(`[${n + 1}/${items.length}] FAILED ${item.id}: ${err?.message}`)
  }
}

console.log(
  `\nDone: ${stats.created} created, ${stats.updated} updated, ${stats.failed.length} failed, ` +
    `${mediaCache.size} files linked.`,
)
process.exit(stats.failed.length ? 1 : 0)
