# bn-cms // //

Payload 3 CMS for the BUSINESSNEXT blog. It has no website of its own: `/` redirects to
`/admin`, and the website (`bn_revamp-fe-web`) reads posts over the REST API at `/api/posts`.

## Collections

| Collection | What it holds |
|---|---|
| `posts` | Blog posts: title, slug (= the `/blogs/<slug>/` URL), hero image, excerpt, Lexical content (tables, linked images), categories, tags, read time, SEO meta, WordPress ids |
| `categories` | Post categories, nested (parent / breadcrumbs) |
| `tags` | Post tags |
| `media` | Images and PDFs |
| `users` | Admin users |

`readMinutes` is entered by the editor. The website shows "<n> min read" only when it is set.

## Development

```bash
cp .env.example .env   # fill in DATABASE_URL and PAYLOAD_SECRET
pnpm install
pnpm dev               # http://localhost:3000/admin
```

After changing a collection, run `pnpm generate:types` and `pnpm generate:importmap`.

## WordPress import

`src/scripts/migrate-wordpress.ts` imports every post, category, tag, image and linked PDF from
`businessnext.com/blogs` through the WordPress REST API. It matches records on WordPress ids, so
it is safe to re-run: it only re-imports posts that changed.

```bash
pnpm migrate:wp dry-run    # fetch + convert only, writes nothing
pnpm migrate:wp limit=5    # import 5 posts, then check them in /admin
pnpm migrate:wp            # full import
pnpm migrate:wp force      # re-import unchanged posts too
```

`payload run` drops `--flags`, so the options are plain words. When the import finishes, open
`migration-report.json` and fix the posts it flags by hand (iframes, forms, leftover shortcodes).

### Mandatory: repair media after every import

**Every time `pnpm migrate:wp` runs, run `repair:media` against the production (Neon) database
straight after it.** Without it, imported images won't load on Vercel (Blob storage).

```bash
! DATABASE_URL='<production Neon pooled connection string>' pnpm repair:media
```

Copy the connection string from the Neon dashboard or the Vercel project's environment variables.
Don't commit it.

If `/blogs/wp-json/wp/v2/posts` does not return JSON, a security plugin is blocking it. Allow it
for the import, or set `WP_USER` and `WP_APP_PASSWORD` (a WordPress Application Password). Those
two also pull drafts.
