import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'

import type { Post } from '@/payload-types'

/**
 * Tells the website to drop its cached copy of a post (POST <NEXT_PUBLIC_SERVER_URL>/api/revalidate,
 * falling back to WEBSITE_URL), so a publish, edit, unpublish or delete shows up straight away
 * instead of after its 5-minute cache.
 * Off when REVALIDATE_SECRET is unset, and for writes made with `context.disableRevalidate`
 * (the WordPress import).
 */
async function revalidate(req: PayloadRequest, slugs: (string | null | undefined)[]) {
  const secret = process.env.REVALIDATE_SECRET
  const website = (process.env.NEXT_PUBLIC_SERVER_URL || process.env.WEBSITE_URL || '').replace(/\/$/, '')
  if (!secret || !website || req.context.disableRevalidate) return

  const unique = [...new Set(slugs.filter((slug): slug is string => Boolean(slug)))]
  try {
    const res = await fetch(`${website}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ slugs: unique }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    req.payload.logger.info(`Revalidated website for post(s): ${unique.join(', ')}`)
  } catch (err) {
    // Never fail the save: the website catches up on its own within 5 minutes.
    req.payload.logger.error(`Website revalidation failed: ${(err as Error).message}`)
  }
}

export const revalidatePost: CollectionAfterChangeHook<Post> = async ({ doc, previousDoc, req }) => {
  // Autosaved drafts don't touch what the website shows - only a published version, or one
  // that just stopped being published, does.
  if (doc._status !== 'published' && previousDoc?._status !== 'published') return doc
  await revalidate(req, [doc.slug, previousDoc?.slug])
  return doc
}

export const revalidateDeletedPost: CollectionAfterDeleteHook<Post> = async ({ doc, req }) => {
  await revalidate(req, [doc?.slug])
  return doc
}
