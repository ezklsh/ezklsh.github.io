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

// Main build
(async function build () {
    console.log("Building site from Supabase...")
    const { postTpl, indexTpl } = await loadTemplates()
    const posts = await fetchPosts()

    const baseUrl = OUT_DIR === "public" ? `/ezkl.sh/` : `/`

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