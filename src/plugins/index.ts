import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { vercelBlobStorage } from '@payloadcms/storage-vercel-blob'
import { GenerateTitle, GenerateURL } from '@payloadcms/plugin-seo/types'
import { Plugin } from 'payload'

import { Post } from '@/payload-types'
import { useBlobStorage } from '@/utilities/mediaStorage'

/** The public website that renders the posts, e.g. https://www.businessnext.com - no trailing slash. */
const WEBSITE_URL = (process.env.WEBSITE_URL || 'https://www.businessnext.com').replace(/\/$/, '')

const generateTitle: GenerateTitle<Post> = ({ doc }) => doc?.title ?? ''

const generateURL: GenerateURL<Post> = ({ doc }) =>
  doc?.slug ? `${WEBSITE_URL}/blogs/${doc.slug}/` : `${WEBSITE_URL}/blogs/`

export const plugins: Plugin[] = [
  // Adds `parent` and `breadcrumbs` to categories (the WordPress category tree).
  nestedDocsPlugin({
    collections: ['categories'],
    generateURL: (docs) => docs.reduce((url, doc) => `${url}/${doc.slug}`, ''),
  }),
  seoPlugin({
    generateTitle,
    generateURL,
  }),
  // Stores uploads in Vercel Blob when BLOB_READ_WRITE_TOKEN is set (Vercel's disk is read-only).
  // Without the token, or with MEDIA_STORAGE=local, uploads are stored in and served from public/media.
  vercelBlobStorage({
    enabled: useBlobStorage,
    collections: { media: true },
    token: process.env.BLOB_READ_WRITE_TOKEN,
    // The browser uploads straight to Blob, so files over Vercel's 4.5 MB request limit (PDFs) work.
    clientUploads: true,
  }),
]
