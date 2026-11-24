import type { CollectionConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { slugField } from 'payload'
import { slugify } from '../utilities/slugify'

/** Post tags, imported from WordPress. Shown as "#Tag" pills under a blog post. */
export const Tags: CollectionConfig = {
  slug: 'tags',
  access: {
    create: authenticated,
    delete: authenticated,
    read: anyone,
    update: authenticated,
  },
  admin: {
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'description',
      type: 'textarea',
    },
    slugField({
      position: undefined,
      slugify,
    }),
    {
      name: 'wpId',
      type: 'number',
      unique: true,
      index: true,
      admin: { readOnly: true, description: 'Original WordPress term ID (set by the migration)' },
    },
  ],
}
