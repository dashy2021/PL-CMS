import { nestedDocsPlugin } from '@payloadcms/plugin-nested-docs'
import { seoPlugin } from '@payloadcms/plugin-seo'
import { GenerateTitle, GenerateURL } from '@payloadcms/plugin-seo/types'
import { Plugin } from 'payload'

import { Post } from '@/payload-types'

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
]
