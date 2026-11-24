/**
 * WordPress → Payload CMS blog migration (BUSINESSNEXT)
 *
 * Pulls every published post, category, tag and image from the WordPress REST API
 * and writes them into Payload through the Local API. HTML bodies are converted to
 * Lexical rich text; images are downloaded, re-uploaded to the `media` collection
 * and re-linked inside the content.
 *
 * Safe to re-run: posts/terms/media are matched on their WordPress IDs/URLs, and
 * posts that haven't changed in WordPress since the last run are skipped. So you can
 * do a full import now, keep the client blogging in WordPress, and run it again on
 * cut-over day to pick up the delta.
 *
 * Run (from the bn-cms root). `payload run` swallows --flags, so options are plain words:
 *   pnpm migrate:wp              # full import
 *   pnpm migrate:wp limit=5      # trial run, first 5 posts
 *   pnpm migrate:wp dry-run      # fetch + convert, write nothing
 *   pnpm migrate:wp force        # re-import even unchanged posts
 *
 * Env (optional, e.g. in .env):
 *   WP_API_URL=https://www.businessnext.com/blogs/wp-json/wp/v2
 *   WP_USER=admin-username  WP_APP_PASSWORD="xxxx xxxx xxxx xxxx"   # WordPress Application Password;
 *                                                                    # only needed to also pull drafts
 *
 * Leaves `readMinutes` alone: editors enter the read time in the admin, and a re-import
 * never overwrites it.
 * Writes: ./migration-report.json  (per-post warnings, failures, URL checks)
 */
import config from '@payload-config'
import { convertHTMLToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'
import { JSDOM } from 'jsdom'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload } from 'payload'

// ───────────────────────────── settings ─────────────────────────────
const WP_API = (process.env.WP_API_URL || 'https://www.businessnext.com/blogs/wp-json/wp/v2').replace(/\/$/, '')
const WP_ORIGIN = new URL(WP_API).origin
const BLOG_PREFIX = '/blogs' // new Next.js route prefix: /blogs/<slug>/
const SKIP_TERM_SLUGS = new Set(['uncategorized'])

/**
 * Old hosts baked into post HTML by earlier WordPress moves → the live site.
 * Applied to every <img src> and <a href> before anything else.
 */
const LEGACY_URL_FIXES: [RegExp, string][] = [
  // old Cloudways staging URL of this same app
  [/^https?:\/\/phpstack-1220974-4342916\.cloudwaysapps\.com/i, WP_ORIGIN],
  // left over from a local dev install
  [/^https?:\/\/localhost\/projects\/businessnext-blog/i, `${WP_ORIGIN}/blogs`],
  // a past search-replace turned "businessnext.com" into "www.businessnext.com/blogs",
  // e.g. https://www.www.businessnext.com/blogs/request-demo  →  https://www.businessnext.com/request-demo
  [/^https?:\/\/www\.www\.businessnext\.com\/blogs/i, 'https://www.businessnext.com'],
  [/^https?:\/\/www\.www\.businessnext\.com/i, 'https://www.businessnext.com'],
]
const PER_PAGE = 50

// Accept `dry-run`, `--dry-run` (after a `--`), or env vars MIGRATE_DRY_RUN / MIGRATE_FORCE / MIGRATE_LIMIT.
const args = process.argv.slice(2).map((a) => a.replace(/^-+/, ''))
const DRY_RUN = args.includes('dry-run') || !!process.env.MIGRATE_DRY_RUN
const FORCE = args.includes('force') || !!process.env.MIGRATE_FORCE
const LIMIT = Number(args.find((a) => a.startsWith('limit='))?.split('=')[1] || process.env.MIGRATE_LIMIT || 0)

const AUTH =
  process.env.WP_USER && process.env.WP_APP_PASSWORD
    ? 'Basic ' + Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString('base64')
    : undefined

// Passed to every write so any afterChange hook that revalidates the website
// (revalidatePath etc.) skips itself outside Next.js.
const CONTEXT = { disableRevalidate: true }

// ───────────────────────────── WP types ─────────────────────────────
type WPRendered = { rendered: string }
type WPTerm = { id: number; name: string; slug: string; description: string; parent?: number; count: number }
type WPMedia = { id: number; source_url: string; alt_text?: string }
type WPPost = {
  id: number
  date_gmt: string
  modified_gmt: string
  slug: string
  status: string
  link: string
  title: WPRendered
  content: WPRendered
  excerpt: WPRendered
  featured_media: number
  categories: number[]
  tags: number[]
  lang?: string // Polylang
  wpml_current_locale?: string // WPML
  yoast_head_json?: { title?: string; description?: string; og_image?: { url: string }[] }
  _embedded?: { 'wp:featuredmedia'?: WPMedia[] }
}

type PostReport = {
  wpId: number
  slug: string
  title: string
  result: 'created' | 'updated' | 'skipped' | 'failed' | 'dry-run'
  warnings: string[]
  error?: string
}

// ───────────────────────────── helpers ─────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const scratch = new JSDOM('').window.document

/** "Banking &amp; CRM&#8217;s" → "Banking & CRM's" */
const decodeEntities = (s = '') => {
  const t = scratch.createElement('textarea')
  t.innerHTML = s
  return t.value.trim()
}

/** HTML → plain text */
const stripHtml = (html = '') => JSDOM.fragment(`<div>${html}</div>`).textContent?.replace(/\s+/g, ' ').trim() ?? ''

const safeDecodeURI = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Undo Google redirect / Translate-proxy wrappers and legacy hosts. */
function fixUrl(raw: string): string {
  let url = raw.trim()
  try {
    const u = new URL(url)
    // https://www.google.com/url?...&url=https%3A%2F%2Freal-target  →  real target
    if (/^www\.google\./i.test(u.hostname) && u.pathname === '/url') {
      url = u.searchParams.get('url') || u.searchParams.get('q') || url
    }
    // https://www-businessnext-com.translate.goog/request-demo?_x_tr_sl=…  →  https://www.businessnext.com/request-demo
    else if (u.hostname.endsWith('.translate.goog')) {
      const host = u.hostname.replace(/\.translate\.goog$/, '').replace(/--/g, '\u0000').replace(/-/g, '.').replace(/\u0000/g, '-')
      for (const k of [...u.searchParams.keys()]) if (k.startsWith('_x_tr_')) u.searchParams.delete(k)
      url = `https://${host}${u.pathname}${u.search}${u.hash}`
    }
  } catch {
    /* relative URL — leave as is */
  }
  for (const [re, to] of LEGACY_URL_FIXES) url = url.replace(re, to)
  return url
}

const PERMANENT_NET_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']

async function request(url: string, { json = true, retries = 3 } = {}, attempt = 1): Promise<Response> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': 'payload-wp-migration/1.0',
        ...(json ? { Accept: 'application/json' } : {}),
        ...(AUTH && url.startsWith(WP_ORIGIN) ? { Authorization: AUTH } : {}),
      },
    })
    if (res.ok) return res
    if ((res.status === 429 || res.status >= 500) && attempt <= retries) {
      await sleep(1000 * 2 ** attempt)
      return request(url, { json, retries }, attempt + 1)
    }
    throw new Error(`HTTP ${res.status} ${res.statusText}`)
  } catch (err: any) {
    const code = err?.cause?.code || err?.code || err?.name
    const permanent = String(err?.message).startsWith('HTTP') || PERMANENT_NET_ERRORS.includes(code)
    if (!permanent && attempt <= retries) {
      await sleep(1000 * 2 ** attempt)
      return request(url, { json, retries }, attempt + 1)
    }
    if (!String(err?.message).startsWith('HTTP') && code) err.message = `${code}: ${err.message}`
    throw err
  }
}

/** Fetch every page of a WP REST collection. */
async function fetchAll<T>(route: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = []
  let page = 1
  let totalPages = 1
  do {
    const url = new URL(`${WP_API}/${route}`)
    for (const [k, v] of Object.entries({ per_page: String(PER_PAGE), page: String(page), ...params })) {
      url.searchParams.set(k, v)
    }
    const res = await request(url.toString())
    if (!res.headers.get('content-type')?.includes('json')) {
      throw new Error(
        `WordPress REST API did not return JSON for ${url}. It may be disabled by a security plugin — ` +
          `allow /wp-json/wp/v2/* for the migration (or ask the client for an Application Password).`,
      )
    }
    totalPages = Number(res.headers.get('x-wp-totalpages') || 1)
    out.push(...((await res.json()) as T[]))
    console.log(`  ${route}: page ${page}/${totalPages} (${out.length})`)
    page++
  } while (page <= totalPages)
  return out
}

// ───────────────────────────── main ─────────────────────────────
const payload = await getPayload({ config })
// Use the Posts.content field's own editor (with its table + upload-link features) for conversion.
// `content` sits inside the Content tab, so look it up among the flattened fields.
const contentField = payload.collections.posts.config.flattenedFields.find((f: any) => f.name === 'content') as any
const editorConfig = contentField?.editor
  ? editorConfigFactory.fromField({ field: contentField })
  : await editorConfigFactory.default({ config: payload.config })

const report = {
  startedAt: new Date().toISOString(),
  finishedAt: '',
  source: WP_API,
  dryRun: DRY_RUN,
  totals: { posts: 0, created: 0, updated: 0, skipped: 0, failed: 0, media: 0 },
  urlMismatches: [] as { wpLink: string; newPath: string }[],
  posts: [] as PostReport[],
}

// ── media ──
type MediaRef = { id: number | string; url: string }
const mediaCache = new Map<string, MediaRef>()
const mediaIds = new Map<string, number | string>() // String(id) → real id (numeric on Postgres/SQLite)

const remember = (candidates: string[], ref: MediaRef) => {
  candidates.forEach((c) => mediaCache.set(c, ref))
  mediaIds.set(String(ref.id), ref.id)
  return ref
}

/**
 * convertHTMLToLexical reads data-lexical-upload-id as a string. On Postgres/SQLite the
 * media ID is a number, so Payload rejects the node ("not a valid upload ID") — fix it here.
 */
function fixUploadIds(node: any) {
  if (node?.type === 'upload' && mediaIds.has(String(node.value))) node.value = mediaIds.get(String(node.value))
  node?.children?.forEach(fixUploadIds)
}

/** Candidate URLs for the best-quality original of a WP image, best first. */
function mediaCandidates(rawUrl: string): string[] {
  const url = new URL(fixUrl(rawUrl), WP_ORIGIN)
  url.search = ''
  const given = url.toString()
  const noSize = given.replace(/-\d+x\d+(?=(-(?:jpe?g|png))?\.[a-z0-9]+$)/i, '') // photo-1024x576.jpg → photo.jpg
  const noWebp = noSize.replace(/-(jpe?g|png)\.webp$/i, '.$1') // Performance Lab: photo-jpg.webp → photo.jpg
  return [...new Set([noWebp, noSize, given])]
}

let lastMediaError = ''

async function importMedia(rawUrl: string, alt: string): Promise<MediaRef | null> {
  lastMediaError = ''
  if (!rawUrl || rawUrl.startsWith('data:')) return null
  const candidates = mediaCandidates(rawUrl)
  for (const c of candidates) if (mediaCache.has(c)) return mediaCache.get(c)!

  const existing = await payload.find({
    collection: 'media',
    where: { wpSourceUrl: { in: candidates } },
    limit: 1,
    depth: 0,
  })
  if (existing.docs[0]) return remember(candidates, { id: existing.docs[0].id, url: existing.docs[0].url as string })
  if (DRY_RUN) return null

  for (const candidate of candidates) {
    let res: Response
    try {
      res = await request(candidate, { json: false, retries: 1 })
    } catch (err: any) {
      lastMediaError = err?.message || String(err)
      continue // try the next candidate (e.g. un-resized original doesn't exist)
    }
    const mimetype = (res.headers.get('content-type') || '').split(';')[0].trim()
    if (!mimetype || mimetype.startsWith('text/html')) {
      lastMediaError = `not a file (${mimetype || 'no content-type'})`
      continue
    }
    const data = Buffer.from(await res.arrayBuffer())
    const name = safeDecodeURI(path.basename(new URL(candidate).pathname))

    try {
      const doc = await payload.create({
        collection: 'media',
        data: { alt: alt || name, wpSourceUrl: candidate },
        file: { data, mimetype, name, size: data.length },
        context: CONTEXT,
      })
      report.totals.media++
      return remember(candidates, { id: doc.id, url: doc.url as string })
    } catch (err: any) {
      lastMediaError = `rejected by Payload: ${err?.message}`
      return null
    }
  }
  return null
}

// ── terms ──
async function importTerms(kind: 'categories' | 'tags'): Promise<Map<number, number | string>> {
  console.log(`\n▸ ${kind}`)
  const terms = (await fetchAll<WPTerm>(kind, { hide_empty: 'true' })).filter((t) => !SKIP_TERM_SLUGS.has(t.slug))
  const map = new Map<number, number | string>()

  for (const t of terms) {
    const data = {
      title: decodeEntities(t.name),
      slug: safeDecodeURI(t.slug),
      description: stripHtml(t.description),
      wpId: t.id,
    }
    if (DRY_RUN) {
      map.set(t.id, `dry-${t.id}`)
      continue
    }
    const found = await payload.find({ collection: kind, where: { wpId: { equals: t.id } }, limit: 1, depth: 0 })
    const doc = found.docs[0]
      ? await payload.update({ collection: kind, id: found.docs[0].id, data, context: CONTEXT })
      : await payload.create({ collection: kind, data, context: CONTEXT })
    map.set(t.id, doc.id)
  }

  // second pass: category hierarchy
  if (kind === 'categories' && !DRY_RUN) {
    for (const t of terms) {
      if (t.parent && map.has(t.parent)) {
        await payload.update({
          collection: 'categories',
          id: map.get(t.id)!,
          data: { parent: map.get(t.parent) as any },
          context: CONTEXT,
        })
      }
    }
  }
  console.log(`  ${map.size} ${kind} ready`)
  return map
}

// ── content ──
const UNSUPPORTED_TAGS = ['iframe', 'script', 'style', 'form', 'video', 'audio', 'embed', 'object'] // tables are supported via EXPERIMENTAL_TableFeature

type ImageLink = { link: string; newTab: boolean } | null

/**
 * Clean WordPress HTML for convertHTMLToLexical.
 * Returns the HTML plus, for every image kept (in document order), the link it had in
 * WordPress — those are written onto the Lexical upload nodes afterwards.
 */
async function prepareHtml(
  html: string,
  title: string,
  baseUrl: string,
  warnings: string[],
): Promise<{ html: string; imageLinks: ImageLink[] }> {
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document
  const body = doc.body
  const unwrap = (el: Element) => el.replaceWith(...Array.from(el.childNodes))

  // 0. Strip plugin-injected markup that isn't real content.
  //    Easy Table of Contents injects its TOC box + heading anchors into every post —
  //    rebuild the TOC in Next.js from the h2s instead.
  body
    .querySelectorAll('#ez-toc-container, .ez-toc-container, [class*="ez-toc-v"], .ez-toc-section, .ez-toc-section-end')
    .forEach((el) => el.remove())
  body.querySelectorAll('svg').forEach((el) => el.remove())

  for (const tag of UNSUPPORTED_TAGS) {
    const n = body.querySelectorAll(tag).length
    if (n) warnings.push(`${n} <${tag}> element(s) — dropped by the editor, review manually`)
  }
  const shortcodes = body.textContent?.match(/\[\/?[a-z][\w-]*(?:\s[^\]]*)?\]/gi)
  if (shortcodes?.length) warnings.push(`leftover shortcode-like text: ${[...new Set(shortcodes)].slice(0, 5).join(' ')}`)

  // 1. Normalise every link: fix legacy hosts, drop empty / "#" / javascript: links
  //    (Lexical requires a URL on every link), keep simple same-site paths relative.
  for (const a of Array.from(body.querySelectorAll('a'))) {
    const raw = (a.getAttribute('href') || '').trim()
    if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) {
      unwrap(a) // in-page anchors can't work either: Lexical doesn't keep element ids
      continue
    }
    let abs: URL
    try {
      abs = new URL(fixUrl(raw).replace(/\s/g, '%20'), baseUrl)
    } catch {
      warnings.push(`invalid link removed: ${raw}`)
      unwrap(a)
      continue
    }
    let href = abs.toString()
    if (abs.origin === WP_ORIGIN && !abs.pathname.includes('/wp-content/')) {
      const rel = abs.pathname + abs.search + abs.hash
      if (/^\/[\w\-./]*$/.test(rel)) href = rel // only plain paths — Lexical mangles relative URLs with %, ? etc.
    }
    a.setAttribute('href', href)
  }

  // 2. Links around images: remember the link, then unwrap (an upload node can't sit inside a link).
  for (const a of Array.from(body.querySelectorAll('a'))) {
    if (!a.querySelector('img')) continue
    const href = a.getAttribute('href')!
    a.querySelectorAll('img').forEach((img) => {
      // a link straight to the image file itself (lightbox) isn't worth keeping
      if (!/\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(href)) {
        img.setAttribute('data-wp-link', href)
        if (a.getAttribute('target') === '_blank') img.setAttribute('data-wp-newtab', '1')
      }
    })
    unwrap(a)
  }

  // 3. Images → upload to Payload, then tag them so convertHTMLToLexical creates upload nodes.
  const imageLinks: ImageLink[] = []
  for (const img of Array.from(body.querySelectorAll('img'))) {
    const src = img.getAttribute('data-lazy-src') || img.getAttribute('data-src') || img.getAttribute('src') || ''
    const media = await importMedia(src, decodeEntities(img.getAttribute('alt') || '') || title)
    if (!media) {
      if (!DRY_RUN) warnings.push(`image not imported: ${fixUrl(src)} (${lastMediaError || 'unknown error'})`)
      const parent = img.parentElement
      img.remove()
      if (parent && parent !== body && /^(P|FIGURE)$/.test(parent.tagName) && !parent.textContent?.trim() && !parent.querySelector('img')) {
        parent.remove()
      }
      continue
    }
    const link = img.getAttribute('data-wp-link')
    imageLinks.push(link ? { link, newTab: img.hasAttribute('data-wp-newtab') } : null)
    for (const attr of ['srcset', 'sizes', 'data-src', 'data-lazy-src', 'data-srcset', 'data-wp-link', 'data-wp-newtab', 'width', 'height', 'class', 'style']) {
      img.removeAttribute(attr)
    }
    img.setAttribute('src', media.url)
    img.setAttribute('data-lexical-upload-id', String(media.id))
    img.setAttribute('data-lexical-upload-relation-to', 'media')

    // Lift the image out of its <p>/<figure> wrapper so it becomes a block-level node
    // (but leave images inside table cells alone).
    const wrapper = img.closest('p, figure')
    if (wrapper && wrapper.parentNode && !img.closest('td, th')) {
      wrapper.parentNode.insertBefore(img, wrapper)
      const caption = wrapper.querySelector('figcaption')
      if (caption) {
        const p = doc.createElement('p')
        p.innerHTML = `<em>${caption.innerHTML}</em>`
        caption.replaceWith(p)
      }
      if (!wrapper.textContent?.trim() && !wrapper.querySelector('img')) wrapper.remove()
    }
  }

  // 4. Links to uploaded files (PDFs, whitepapers…) → re-host in Payload and repoint.
  for (const a of Array.from(body.querySelectorAll('a[href*="/wp-content/uploads/"]'))) {
    const href = a.getAttribute('href')!
    const media = await importMedia(href, decodeEntities(a.textContent || '') || title)
    if (media) a.setAttribute('href', media.url)
    else if (!DRY_RUN) warnings.push(`linked file not imported: ${href} (${lastMediaError || 'unknown error'})`)
  }

  return { html: body.innerHTML, imageLinks }
}

/** Walk a Lexical tree in document order. */
function walk(node: any, visit: (n: any) => void) {
  visit(node)
  node?.children?.forEach((c: any) => walk(c, visit))
}

/** Put the WordPress image links onto the upload nodes (custom `link` field on Posts.content). */
function applyImageLinks(root: any, imageLinks: ImageLink[], warnings: string[]) {
  const uploads: any[] = []
  walk(root, (n) => n.type === 'upload' && uploads.push(n))
  if (uploads.length !== imageLinks.length) {
    if (imageLinks.some(Boolean)) warnings.push('could not match image links to images — check linked images manually')
    return
  }
  uploads.forEach((node, i) => {
    const l = imageLinks[i]
    if (l) node.fields = { ...(node.fields || {}), link: l.link, newTab: l.newTab }
  })
}

/** Safety net: unwrap any link node that still has no URL (Payload rejects the whole post otherwise). */
function dropEmptyLinks(node: any) {
  if (!node?.children) return
  node.children = node.children.flatMap((c: any) => {
    dropEmptyLinks(c)
    return (c.type === 'link' || c.type === 'autolink') && !c.fields?.url?.trim() ? c.children || [] : [c]
  })
}

function cleanExcerpt(html: string): string {
  const frag = JSDOM.fragment(`<div>${html}</div>`)
  frag.querySelectorAll('.more-link, .screen-reader-text').forEach((el) => el.remove())
  return (frag.textContent || '')
    .replace(/\s*\[(?:…|&hellip;|\.\.\.)\]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── posts ──
async function importPosts(catMap: Map<number, number | string>, tagMap: Map<number, number | string>) {
  console.log('\n▸ posts')
  const params: Record<string, string> = { orderby: 'date', order: 'asc', _embed: 'wp:featuredmedia' }
  if (AUTH) params.status = 'publish,future,draft,pending,private'
  let posts = await fetchAll<WPPost>('posts', params)
  if (LIMIT) posts = posts.slice(0, LIMIT)
  report.totals.posts = posts.length

  for (const [i, post] of posts.entries()) {
    const title = decodeEntities(post.title.rendered) || `(untitled ${post.id})`
    const slug = safeDecodeURI(post.slug) || String(post.id)
    const entry: PostReport = { wpId: post.id, slug, title, result: 'failed', warnings: [] }
    report.posts.push(entry)
    process.stdout.write(`  [${i + 1}/${posts.length}] ${slug} … `)

    try {
      // URL sanity check — new site serves /blogs/<slug>/
      const newPath = `${BLOG_PREFIX}/${slug}/`
      const oldPath = safeDecodeURI(new URL(post.link).pathname)
      if (oldPath !== newPath && post.status === 'publish') report.urlMismatches.push({ wpLink: post.link, newPath })

      const existing = DRY_RUN
        ? undefined
        : (await payload.find({ collection: 'posts', where: { wpId: { equals: post.id } }, limit: 1, depth: 0 }))
            .docs[0]
      if (existing && existing.wpModified === post.modified_gmt && !FORCE) {
        entry.result = 'skipped'
        report.totals.skipped++
        console.log('unchanged, skipped')
        continue
      }

      // featured image
      const fm = post._embedded?.['wp:featuredmedia']?.[0]
      let featuredSrc = fm?.source_url
      let featuredAlt = fm?.alt_text
      if (!featuredSrc && post.featured_media) {
        try {
          const m = (await (await request(`${WP_API}/media/${post.featured_media}`)).json()) as WPMedia
          featuredSrc = m.source_url
          featuredAlt = m.alt_text
        } catch {
          featuredSrc = post.yoast_head_json?.og_image?.[0]?.url
          if (!featuredSrc) entry.warnings.push(`featured media #${post.featured_media} not found in WordPress`)
        }
      }
      const featured = featuredSrc ? await importMedia(featuredSrc, decodeEntities(featuredAlt) || title) : null
      if (featuredSrc && !featured && !DRY_RUN)
        entry.warnings.push(`featured image not imported: ${fixUrl(featuredSrc)} (${lastMediaError || 'unknown error'})`)

      // body
      const { html, imageLinks } = await prepareHtml(post.content.rendered, title, post.link, entry.warnings)
      const content = convertHTMLToLexical({ editorConfig, html, JSDOM })
      fixUploadIds(content.root)
      applyImageLinks(content.root, imageLinks, entry.warnings)
      dropEmptyLinks(content.root)

      const excerpt = cleanExcerpt(post.excerpt.rendered)
      const isPublished = post.status === 'publish'
      const data = {
        title,
        slug,
        publishedAt: new Date(post.date_gmt + 'Z').toISOString(),
        excerpt,
        content,
        heroImage: featured?.id ?? null,
        categories: post.categories.map((id) => catMap.get(id)).filter(Boolean),
        tags: post.tags.map((id) => tagMap.get(id)).filter(Boolean),
        language: post.lang || post.wpml_current_locale || undefined,
        meta: {
          title: decodeEntities(post.yoast_head_json?.title) || title,
          description: decodeEntities(post.yoast_head_json?.description) || excerpt.slice(0, 160),
          image: featured?.id ?? null,
        },
        wpId: post.id,
        wpLink: post.link,
        wpModified: post.modified_gmt,
        _status: isPublished ? 'published' : 'draft',
      } as any // loosely typed so it works whether or not you've run `payload generate:types`

      if (DRY_RUN) {
        entry.result = 'dry-run'
        console.log(`ok (dry run, ${content.root.children.length} blocks)`)
        continue
      }

      if (existing) {
        await payload.update({ collection: 'posts', id: existing.id, data, draft: !isPublished, context: CONTEXT })
        entry.result = 'updated'
        report.totals.updated++
      } else {
        await payload.create({ collection: 'posts', data, draft: !isPublished, context: CONTEXT })
        entry.result = 'created'
        report.totals.created++
      }
      console.log(entry.result + (entry.warnings.length ? ` (${entry.warnings.length} warning/s)` : ''))
    } catch (err: any) {
      entry.error = err?.message || String(err)
      report.totals.failed++
      console.log(`FAILED — ${entry.error}`)
    }
  }
}

// ───────────────────────────── run ─────────────────────────────
console.log(`WordPress → Payload migration${DRY_RUN ? ' (DRY RUN)' : ''}\nSource: ${WP_API}`)
try {
  const catMap = await importTerms('categories')
  const tagMap = await importTerms('tags')
  await importPosts(catMap, tagMap)
} catch (err: any) {
  console.error('\n✖ Migration stopped:', err?.message || err)
  process.exitCode = 1
}

report.finishedAt = new Date().toISOString()
await fs.writeFile('migration-report.json', JSON.stringify(report, null, 2))
const t = report.totals
console.log(
  `\nDone. posts: ${t.posts} | created ${t.created} | updated ${t.updated} | skipped ${t.skipped} | ` +
    `failed ${t.failed} | media uploaded ${t.media} | URL mismatches ${report.urlMismatches.length}` +
    `\nPosts with warnings: ${report.posts.filter((p) => p.warnings.length).length} — see migration-report.json`,
)
process.exit(process.exitCode ?? 0)
