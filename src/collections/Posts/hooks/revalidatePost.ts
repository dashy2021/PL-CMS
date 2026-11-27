import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

import type { Post } from '@/payload-types'
import { revalidateWebsite } from '@/utilities/revalidateWebsite'

/**
 * Tells the website to drop its cached posts (see revalidateWebsite), so a publish, edit,
 * unpublish or delete shows up straight away instead of after its 5-minute cache.
 */
export const revalidatePost: CollectionAfterChangeHook<Post> = async ({ doc, previousDoc, req }) => {
  // Autosaved drafts don't touch what the website shows - only a published version, or one
  // that just stopped being published, does.
  if (doc._status !== 'published' && previousDoc?._status !== 'published') return doc
  await revalidateWebsite(req, ['posts'])
  return doc
}

export const revalidateDeletedPost: CollectionAfterDeleteHook<Post> = async ({ doc, req }) => {
  await revalidateWebsite(req, ['posts'])
  return doc
}
