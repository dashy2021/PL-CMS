import type { CollectionConfig } from 'payload'

import {
  EXPERIMENTAL_TableFeature,
  FixedToolbarFeature,
  HeadingFeature,
  HorizontalRuleFeature,
  InlineToolbarFeature,
  lexicalEditor,
  OrderedListFeature,
  UnorderedListFeature,
  BlockquoteFeature,
  InlineCodeFeature,
  StrikethroughFeature,
  SubscriptFeature,
  SuperscriptFeature,
  UploadFeature,
} from '@payloadcms/richtext-lexical'
import {
  MetaDescriptionField,
  MetaImageField,
  MetaTitleField,
  OverviewField,
  PreviewField,
} from '@payloadcms/plugin-seo/fields'
import { slugField } from 'payload'

import { authenticated } from '../../access/authenticated'
import { authenticatedOrPublished } from '../../access/authenticatedOrPublished'
import { slugify } from '../../utilities/slugify'
import { revalidateDeletedPost, revalidatePost } from './hooks/revalidatePost'

/**
 * Blog posts, served by the website at /blogs/<slug>/. Most of them come from WordPress
 * (src/scripts/migrate-wordpress.ts), so slugs are kept identical to the old URLs.
 */
export const Posts: CollectionConfig<'posts'> = {
  slug: 'posts',
  access: {
    create: authenticated,
    delete: authenticated,
    read: authenticatedOrPublished,
    update: authenticated,
  },
  // What a post shows when another document references it.
  // https://payloadcms.com/docs/queries/select#defaultpopulate-collection-config-property
  defaultPopulate: {
    title: true,
    slug: true,
    excerpt: true,
    heroImage: true,
    categories: true,
    readMinutes: true,
    publishedAt: true,
  },
  hooks: {
    afterChange: [revalidatePost],
    afterDelete: [revalidateDeletedPost],
  },
  admin: {
    defaultColumns: ['title', 'slug', 'publishedAt', '_status'],
    useAsTitle: 'title',
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Content',
          fields: [
            {
              name: 'heroImage',
              type: 'upload',
              relationTo: 'media',
            },
            {
              name: 'excerpt',
              type: 'textarea',
              admin: { description: 'One or two sentences for the blog listing and the hero carousel.' },
            },
            {
              name: 'content',
              type: 'richText',
              editor: lexicalEditor({
                features: ({ rootFeatures }) => [
                  ...rootFeatures,
                  StrikethroughFeature(),
                  SubscriptFeature(),
                  SuperscriptFeature(),
                  InlineCodeFeature(),
                  // h2s split a post into its "On this Page" sections on the website.
                  HeadingFeature({ enabledHeadingSizes: ['h2', 'h3', 'h4', 'h5', 'h6'] }),
                  UnorderedListFeature(),
                  OrderedListFeature(),
                  BlockquoteFeature(),
                  HorizontalRuleFeature(),
                  // Images can carry a link (CTA banners, charts linking to their source) - set
                  // by the migration from WordPress <a><img></a>, editable from the image.
                  UploadFeature({
                    collections: {
                      media: {
                        fields: [
                          { name: 'link', type: 'text', label: 'Link (optional)' },
                          { name: 'newTab', type: 'checkbox', label: 'Open in new tab' },
                        ],
                      },
                    },
                  }),
                  EXPERIMENTAL_TableFeature(),
                  FixedToolbarFeature(),
                  InlineToolbarFeature(),
                ],
              }),
              label: false,
              required: true,
            },
          ],
        },
        {
          label: 'Meta',
          fields: [
            {
              name: 'categories',
              type: 'relationship',
              admin: {
                position: 'sidebar',
                description: 'The first one files the post under a tab on the blog listing.',
              },
              hasMany: true,
              relationTo: 'categories',
            },
            {
              name: 'tags',
              type: 'relationship',
              admin: { position: 'sidebar' },
              hasMany: true,
              relationTo: 'tags',
            },
          ],
        },
        {
          name: 'meta',
          label: 'SEO',
          fields: [
            OverviewField({
              titlePath: 'meta.title',
              descriptionPath: 'meta.description',
              imagePath: 'meta.image',
            }),
            MetaTitleField({
              hasGenerateFn: true,
            }),
            MetaImageField({
              relationTo: 'media',
            }),
            MetaDescriptionField({}),
            PreviewField({
              hasGenerateFn: true,
              titlePath: 'meta.title',
              descriptionPath: 'meta.description',
            }),
          ],
        },
      ],
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        position: 'sidebar',
      },
      hooks: {
        beforeChange: [
          ({ siblingData, value }) => {
            if (siblingData._status === 'published' && !value) {
              return new Date()
            }
            return value
          },
        ],
      },
    },
    {
      // Entered by the editor - the website shows "<n> min read" and never estimates it.
      name: 'readMinutes',
      type: 'number',
      label: 'Read time (minutes)',
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Leave empty to hide the read time.',
      },
    },
    {
      name: 'language',
      type: 'text',
      admin: { position: 'sidebar' },
    },
    // Served at /blogs/<slug>/ - keep it identical to the old WordPress URL.
    slugField({ slugify }),
    // --- WordPress import bookkeeping (lets the migration re-run safely and only sync changes) ---
    {
      name: 'wpId',
      type: 'number',
      unique: true,
      index: true,
      admin: { position: 'sidebar', readOnly: true, description: 'Original WordPress post ID' },
    },
    {
      name: 'wpLink',
      type: 'text',
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'wpModified',
      type: 'text',
      admin: { hidden: true },
    },
  ],
  versions: {
    drafts: {
      autosave: {
        interval: 100,
      },
      schedulePublish: true,
    },
    maxPerDoc: 50,
  },
}
