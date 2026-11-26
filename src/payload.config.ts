import { postgresAdapter } from '@payloadcms/db-postgres'
import sharp from 'sharp'
import path from 'path'
import { buildConfig, PayloadRequest } from 'payload'
import { fileURLToPath } from 'url'

import { Categories } from './collections/Categories'
import { Media } from './collections/Media'
import { MediaCentre } from './collections/MediaCentre'
import { Posts } from './collections/Posts'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { plugins } from './plugins'
import { defaultLexical } from '@/fields/defaultLexical'
import { getServerSideURL } from './utilities/getURL'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    importMap: {
      baseDir: path.resolve(dirname),
    },
    user: Users.slug,
  },
  // This config helps us configure global or default features that the other editors can inherit
  editor: defaultLexical,
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    // Dev-mode schema push only against a local database. Scripts run on a laptop against Neon
    // (pnpm migrate:wp) would otherwise push the schema there and block `payload migrate` on deploy.
    // Also off with MEDIA_STORAGE=local: the Blob plugin's `media` column disappears then, and
    // push would offer to drop it (data loss). Run `pnpm payload migrate` for schema changes instead.
    push:
      /@?(localhost|127\.0\.0\.1)(:|\/)/.test(process.env.DATABASE_URL || '') &&
      process.env.MEDIA_STORAGE !== 'local',
  }),
  collections: [Posts, MediaCentre, Categories, Tags, Media, Users],
  cors: [getServerSideURL()].filter(Boolean),
  plugins,
  secret: process.env.PAYLOAD_SECRET,
  sharp,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  // Runs scheduled publishing (Posts `schedulePublish`): a logged-in user, or a cron job
  // sending `Authorization: Bearer <CRON_SECRET>`.
  jobs: {
    access: {
      run: ({ req }: { req: PayloadRequest }): boolean => {
        if (req.user) return true
        const secret = process.env.CRON_SECRET
        if (!secret) return false
        return req.headers.get('authorization') === `Bearer ${secret}`
      },
    },
    tasks: [],
  },
})
