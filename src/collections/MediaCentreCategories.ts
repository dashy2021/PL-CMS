import type { CollectionConfig } from 'payload'
import { slugField } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { revalidateCollectionHooks } from '../utilities/revalidateWebsite'
import { slugify } from '../utilities/slugify'

const revalidate = revalidateCollectionHooks('media-centre-categories')

/**
 * The category tabs of the website's media centre page ("Announcements", "In The Press", ...).
 * Each `media-centre` story references one. Drag the rows in the list view to reorder the tabs;
 * the website reads them sorted by `_order`.
 */
export const MediaCentreCategories: CollectionConfig<'media-centre-categories'> = {
  slug: 'media-centre-categories',
  labels: {
    singular: 'Media Centre Category',
    plural: 'Media Centre Categories',
  },
  access: {
    create: authenticated,
    delete: authenticated,
    read: anyone,
    update: authenticated,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug'],
    group: 'Media Centre',
  },
  // Adds the `_order` field and drag-and-drop sorting in the admin list view.
  orderable: true,
  // Renames, reorders and deletes show on the website's tabs at once.
  hooks: {
    afterChange: [revalidate.afterChange],
    afterDelete: [revalidate.afterDelete],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      admin: { description: 'Tab label on the website, e.g. "Analyst & Awards".' },
    },
    // Stable id the website filters on (e.g. "analyst-awards").
    slugField({ slugify }),
  ],
}
