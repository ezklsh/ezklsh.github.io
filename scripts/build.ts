// DONE: Fetch posts
// DONE: Render each post
// DONE: Render the blog index
// DONE: Separate load template function
// DONE: Copy default pages (e.g. index.html, about.html) to public/ 
// KILL: Insert <base href="/ezkl.sh/"> into pages built for public/

import { readFile, writeFile, mkdir, cp, rm, readdir } from "node:fs/promises"
import { join } from "node:path";

type Post = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content_html: string;
  published_at: string;
};

type GalleryPhoto = {
  id: string;
  date: string;
  camera: string;
  w: number;
  h: number;
  thumb: string;
  alt: string;
};

const OUT_DIR = process.env.OUT_DIR ??  "site"

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1)
}

const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: "application/json" 
}

const POST_URL = `${SUPABASE_URL}/rest/v1/blogs?select=title,slug,summary,content_html,published_at&order=published_at.desc`

async function fetchPosts(): Promise<Post[]> {
    const resp = await fetch(POST_URL, { headers })
    if (!resp.ok) throw new Error(`Supabase fetch failed ${resp.status}`)
    return (await resp.json()) as Post[]
}

async function loadTemplates() {

    let postTpl: string
    let indexTpl: string

    try {
        postTpl = await readFile("src/templates/post.html", "utf-8")
    } catch {
        postTpl = ""
    }

    try {
        indexTpl = await readFile("src/templates/blogs.html", "utf-8")
    } catch {
        indexTpl = ""
    }

    return { postTpl, indexTpl }
}

function injectBaseUrl(page: string, baseUrl: string): string {
    return page
        .replaceAll("{{root}}", baseUrl)
}

function renderPostPage(tpl: string, post: Post): string {
    const titleEsc = post.title
    return tpl
        .replaceAll("{{title}}", titleEsc)
        .replaceAll("{{description}}", post.summary)
        .replaceAll("{{slug}}", post.slug)
        .replaceAll("{{date}}", formatDate(post.published_at))
        .replaceAll("{{content}}", post.content_html)
}

function renderIndexPage(tpl: string, posts: Post[]): string {
    const items = posts.map(
        (p) => 
            `<li><i class="muted">${formatDate(p.published_at)} </i><a href="{{root}}blogs/${encodeURIComponent(p.slug)}/">${p.title}</a></li>`
    ).join("")
    return tpl.replace("{{list}}", items || `<li class="muted">no posts</li>`)
}

function formatDate(iso: string): string {
    const d = new Date(iso)
    if(isNaN(d.getTime())) return iso
    const day = d.getDate()
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
    const mon = months[d.getMonth()]
    const year = d.getFullYear()
    return `${mon} ${day}, ${year}`
}

// Bounds are fractions of the row width, so they hold at every viewport size.
// A row of three 3:2 photos lands at 0.22 of the width in height — a strip —
// while mixing a portrait in makes one cell a sliver. Both are rejected here,
// which is why some rows hold two photos and others three.
const ROW = {
    targetH: 0.34, // ~234px at the 688px column
    minH: 0.26, // a row shorter than this reads as a strip
    maxH: 0.5,
    minW: 0.25, // narrowest a single photo may get
    maxW: 0.66,
    maxPerRow: 2, // pairs only: a third cell shrinks every photo on the row
}

// Segment the list (in order) into rows, minimising a penalty over row height
// and per-cell width. Order is preserved; only the number of photos per row
// varies.
function groupRows(photos: GalleryPhoto[]): GalleryPhoto[][] {
    const n = photos.length
    if (n === 0) return []
    const ar = photos.map((p) => p.w / p.h)

    const price = (from: number, to: number) => {
        const k = to - from + 1
        let sum = 0
        for (let t = from; t <= to; t++) sum += ar[t] as number
        const h = 1 / sum
        let cost = (Math.abs(h - ROW.targetH) / ROW.targetH) * 2
        if (h < ROW.minH) cost += ((ROW.minH - h) / ROW.minH) * 3
        if (h > ROW.maxH) cost += ((h - ROW.maxH) / ROW.maxH) * 6
        for (let t = from; t <= to; t++) {
            const frac = (ar[t] as number) / sum
            if (frac < ROW.minW) cost += ((ROW.minW - frac) / ROW.minW) * 20
            if (frac > ROW.maxW) cost += ((frac - ROW.maxW) / ROW.maxW) * 6
        }
        return cost
    }

    const best = new Array<number>(n + 1).fill(Infinity)
    const cut = new Array<number>(n + 1).fill(0)
    best[0] = 0
    for (let end = 1; end <= n; end++) {
        for (let k = 1; k <= ROW.maxPerRow && end - k >= 0; k++) {
            const total = (best[end - k] as number) + price(end - k, end - 1)
            if (total < (best[end] as number)) {
                best[end] = total
                cut[end] = end - k
            }
        }
    }

    const rows: GalleryPhoto[][] = []
    for (let end = n; end > 0; end = cut[end] as number) rows.unshift(photos.slice(cut[end], end))
    return rows
}

function renderGallery(photos: GalleryPhoto[]): string {
    // Rows are emitted left to right so the reading order matches the numbers.
    // Inside a row, each cell grows in proportion to its aspect ratio, which
    // makes every photo in that row the same height without cropping.
    return groupRows(photos)
        .map((row) => {
            const kind = row.length === 1 ? " row--single" : row.length === 2 ? " row--pair" : ""
            const cells = row
                .map(
                    (p) => `<figure class="photo" style="--ar:${(p.w / p.h).toFixed(4)}">
            <img src="{{root}}${p.thumb}" width="${p.w}" height="${p.h}" loading="lazy" decoding="async"
                 alt="${p.alt || `${p.date} ${p.camera}`.trim()}">
          </figure>`,
                )
                .join("")
            return `<div class="row${kind}">${cells}</div>`
        })
        .join("\n")
}

// Main build
(async function build () {
    console.log("Building site from Supabase...")
    const { postTpl, indexTpl } = await loadTemplates()
    const posts = await fetchPosts()

    // const baseUrl = OUT_DIR === "public" ? `/ezkl.sh/` : `/`
    const baseUrl = `/`

    await rm(OUT_DIR, { recursive: true, force: true })

    // output dirs
    await mkdir(`${OUT_DIR}/blogs`, {recursive: true})
    await mkdir(`${OUT_DIR}/assets`, {recursive: true})

    // write post pages
    for (const p of posts) {
        const outDir = join(OUT_DIR, "blogs", p.slug)
        await mkdir(outDir, {recursive: true})
        const html = injectBaseUrl(renderPostPage(postTpl, p), baseUrl)
        await writeFile(join(outDir, "index.html"), html, "utf8")
        console.log(`✓ ${p.slug}`)
    }

    // write blog index
    const indexHtml = injectBaseUrl(renderIndexPage(indexTpl, posts), baseUrl)
    await writeFile(join(OUT_DIR, "blogs", "index.html"), indexHtml, "utf8")

    await cp("src", OUT_DIR, {
        recursive: true,
        filter: (src) => !src.includes("templates")
    })

    // gallery: inline the photo manifest
    const manifest = await Bun.file("src/assets/photos/manifest.json").json() as { photos: GalleryPhoto[] }
    const galleryPath = join(OUT_DIR, "gallery.html")
    const galleryHtml = await readFile(galleryPath, "utf-8")
    await writeFile(
        galleryPath,
        injectBaseUrl(
            galleryHtml
                .replace("{{photos}}", renderGallery(manifest.photos))
                .replace("{{count}}", `${manifest.photos.length} 枚`),
            baseUrl
        ),
        "utf-8"
    )
    console.log(`✓ gallery (${manifest.photos.length} photos)`)

    if (baseUrl) {
        const files = await readdir(OUT_DIR, {withFileTypes: true})

        for (const file of files) {

            const fullPath = join(OUT_DIR, file.name)
            if (file.isFile() && file.name.endsWith(".html")){
                const content = await readFile(fullPath, 'utf-8')
                const transformed = injectBaseUrl(content, baseUrl)
                await writeFile(fullPath, transformed, 'utf-8')
            }
        }
    }

    console.log(`Build complete -> ${OUT_DIR}/`)
})().catch((e) => {
    console.error(e)
    process.exit(1)
})