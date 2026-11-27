import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  PayloadRequest,
} from 'payload'

/**
 * Tells the website to drop its cached copy of a collection (POST <REVALIDATE_URL>/api/revalidate
 * with `{ tags }`, falling back to WEBSITE_URL), so a publish, edit, unpublish or delete shows up
 * straight away instead of after its 5-minute cache. The website tags every Payload fetch with
 * the collection slug, so the tags are collection slugs.
 * Off when REVALIDATE_SECRET is unset, and for writes made with `context.disableRevalidate`
 * (the seed / WordPress import scripts).
 */
export async function revalidateWebsite(req: PayloadRequest, tags: string[]) {
  const secret = process.env.REVALIDATE_SECRET
  const website = (process.env.REVALIDATE_URL || process.env.WEBSITE_URL || '').replace(/\/$/, '')
  if (!secret || !website || req.context.disableRevalidate) return

  try {
    const res = await fetch(`${website}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    req.payload.logger.info(`Revalidated website: ${tags.join(', ')}`)
  } catch (err) {
    // Never fail the save: the website catches up on its own within 5 minutes.
    req.payload.logger.error(`Website revalidation failed (${tags.join(', ')}): ${(err as Error).message}`)
  }
}

type Status = { _status?: 'draft' | 'published' | null }

/**
 * afterChange/afterDelete hooks that revalidate the website's cache of `collection`.
 * With drafts on, autosaved drafts are skipped - only a published version, or one that just
 * stopped being published, changes what the website shows.
 */
export function revalidateCollectionHooks(collection: string): {
  afterChange: CollectionAfterChangeHook
  afterDelete: CollectionAfterDeleteHook
} {
  return {
    afterChange: async ({ doc, previousDoc, req, collection: config }) => {
      const drafts = Boolean(config.versions?.drafts)
      const was = (previousDoc as Status | undefined)?._status
      if (drafts && (doc as Status)._status !== 'published' && was !== 'published') return doc
      await revalidateWebsite(req, [collection])
      return doc
    },
    afterDelete: async ({ doc, req }) => {
      await revalidateWebsite(req, [collection])
      return doc
    },
  }
}
