import type { CollectionConfig } from 'payload'
import { slugField } from 'payload'

import { authenticated } from '../access/authenticated'
import { authenticatedOrPublished } from '../access/authenticatedOrPublished'
import { slugify } from '../utilities/slugify'

/**
 * Media centre stories (press releases, coverage, awards), listed on the website's media centre
 * page. Mirrors `MediaItem` in the frontend (src/features/media-centre/types.ts); each card opens
 * either an uploaded PDF or an article on a publisher's site in a new tab.
 */
export const MEDIA_CENTRE_CATEGORIES = [
  { label: 'Announcements', value: 'announcements' },
  { label: 'Analyst & Awards', value: 'analyst-awards' },
  { label: 'Partnerships', value: 'partnerships' },
  { label: 'Customer Wins', value: 'customer-wins' },
  { label: 'People & Culture', value: 'people-culture' },
  { label: 'In The Press', value: 'in-the-press' },
]

export const MediaCentre: CollectionConfig<'media-centre'> = {
  slug: 'media-centre',
  labels: {
    singular: 'Media Centre Story',
    plural: 'Media Centre',
  },
  access: {
    create: authenticated,
    delete: authenticated,
    read: authenticatedOrPublished,
    update: authenticated,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', 'publishedAt', 'featured', '_status'],
  },
  defaultSort: '-publishedAt',
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      // Sub-headline; most press releases have none.
      name: 'excerpt',
      type: 'textarea',
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      required: true,
      admin: { description: 'Card image in the listing.' },
    },
    {
      name: 'linkType',
      type: 'radio',
      required: true,
      defaultValue: 'file',
      options: [
        { label: 'PDF / file', value: 'file' },
        { label: 'External article', value: 'external' },
      ],
      admin: { layout: 'horizontal', description: 'What the card opens in a new tab.' },
    },
    {
      name: 'file',
      type: 'upload',
      relationTo: 'media',
      // Not `required`: that would make the column NOT NULL for external stories too.
      admin: { condition: (_, siblingData) => siblingData?.linkType === 'file' },
      validate: (value: unknown, { siblingData }: { siblingData: any }) =>
        siblingData?.linkType !== 'file' || Boolean(value) || 'Upload the PDF this story opens.',
    },
    {
      name: 'url',
      type: 'text',
      label: 'External URL',
      admin: { condition: (_, siblingData) => siblingData?.linkType === 'external' },
      validate: (value: string | null | undefined, { siblingData }: { siblingData: any }) => {
        if (siblingData?.linkType !== 'external') return true
        if (!value) return 'Enter the article URL.'
        return /^https?:\/\//.test(value) || 'URL must start with http:// or https://'
      },
    },
    // --- Sidebar ---
    {
      name: 'featured',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Show this story as the featured hero at the top of the media centre page.',
      },
    },
    {
      // The hero uses a larger crop than the listing card.
      name: 'featuredImage',
      type: 'upload',
      relationTo: 'media',
      admin: {
        position: 'sidebar',
        condition: (_, siblingData) => Boolean(siblingData?.featured),
        description: 'Hero image. Falls back to the card image when empty.',
      },
    },
    {
      name: 'category',
      type: 'select',
      required: true,
      index: true,
      options: MEDIA_CENTRE_CATEGORIES,
      admin: { position: 'sidebar' },
    },
    {
      // Its year groups the listing.
      name: 'publishedAt',
      type: 'date',
      required: true,
      index: true,
      defaultValue: () => new Date(),
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayOnly', displayFormat: 'd MMM yyyy' },
      },
    },
    {
      // Shown as-is on the card, e.g. "3 min read".
      name: 'readTime',
      type: 'text',
      required: true,
      admin: { position: 'sidebar', placeholder: '3 min read' },
    },
    // Stable id the website uses for the story (e.g. "rhb-bank-goes-live-with-businessnext-to-advance").
    slugField({ slugify }),
  ],
  versions: {
    drafts: true,
    maxPerDoc: 20,
  },
}
