// Normalise photo rotation, emit web derivatives and a manifest.
//
//   bun scripts/photos.ts                          # ~/Documents/Images/gallery
//   GALLERY_SRC=/some/dir bun scripts/photos.ts
//
// Requires sips (macOS) and cwebp (brew install webp).
import { readdir, mkdir, writeFile, rm } from "node:fs/promises"
import { join, basename, extname } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

const SRC = process.env.GALLERY_SRC ?? `${process.env.HOME}/Documents/Images/gallery`
const OUT = "src/assets/photos"
const TMP = join(OUT, ".tmp")
// One size only: the grid tops out around 227px wide, so 900px on the long edge
// covers retina at the widest column. Bumping this is a one-line change if a
// full-size view ever comes back.
const LONG = 900

// EXIF orientation -> clockwise degrees needed to make the pixels upright.
const ROTATION: Record<number, number> = { 1: 0, 3: 180, 6: 90, 8: 270 }

type Photo = {
  id: string
  file: string
  date: string
  camera: string
  w: number
  h: number
  thumb: string
  alt: string
}

/* --- minimal EXIF reader: orientation, model, DateTimeOriginal --- */

function parseTiff(t: Buffer) {
  const le = t.toString("ascii", 0, 2) === "II"
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o))
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o))
  const out: { orientation?: number; model?: string; datetime?: string } = {}

  const readIfd = (off: number) => {
    if (off <= 0 || off >= t.length - 2) return
    const count = u16(off)
    for (let i = 0; i < count; i++) {
      const e = off + 2 + i * 12
      if (e + 12 > t.length) return
      const tag = u16(e)
      const type = u16(e + 2)
      const n = u32(e + 4)
      const unit = type === 3 ? 2 : type === 4 ? 4 : 1
      const valOff = n * unit > 4 ? u32(e + 8) : e + 8
      if (tag === 0x0112) out.orientation = u16(valOff)
      if (tag === 0x0110)
        out.model = t.toString("ascii", valOff, valOff + Math.min(n, 32)).replace(/\0.*$/, "").trim()
      if (tag === 0x8769) readIfd(u32(valOff))
      if (tag === 0x9003) out.datetime = t.toString("ascii", valOff, valOff + 19)
    }
  }
  readIfd(u32(4))
  return out
}

function readExif(buf: Buffer) {
  let i = 2
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1] ?? 0
    if (marker === 0xe1) {
      const len = buf.readUInt16BE(i + 2)
      const start = i + 4
      if (buf.toString("ascii", start, start + 6) === "Exif\0\0")
        return parseTiff(buf.subarray(start + 6, start + len - 2))
      i += 2 + len
    } else if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
    } else {
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return {}
}

/* --- helpers --- */

const CAMERA: Record<string, string> = {
  "EX-Z75": "EX-Z75",
  "Canon EOS 5D Mark II": "5D Mark II",
}

async function dims(path: string) {
  const { stdout } = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path])
  const w = Number(/pixelWidth:\s*(\d+)/.exec(stdout)?.[1])
  const h = Number(/pixelHeight:\s*(\d+)/.exec(stdout)?.[1])
  return { w, h }
}

const scale = (w: number, h: number, long: number) => {
  const k = Math.min(1, long / Math.max(w, h))
  return { w: Math.round(w * k), h: Math.round(h * k) }
}

/* --- main --- */

await rm(OUT, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })

const files = (await readdir(SRC)).filter((f) => /\.jpe?g$/i.test(f)).sort()
const photos: Photo[] = []

for (const file of files) {
  const src = join(SRC, file)
  const exif = readExif(Buffer.from(await Bun.file(src).arrayBuffer()))
  const orientation = exif.orientation ?? 1
  const deg = ROTATION[orientation]
  if (deg === undefined)
    throw new Error(`${file}: unsupported EXIF orientation ${orientation} (mirrored variants are not handled)`)

  const id = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, "-")
  const upright = join(TMP, `${id}.jpg`)

  if (deg) await run("sips", ["-r", String(deg), src, "--out", upright])
  else await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "95", src, "--out", upright])

  const { w, h } = await dims(upright)
  if ((deg === 90 || deg === 270) && w >= h)
    throw new Error(`${file}: expected portrait after ${deg}° rotation, got ${w}x${h}`)

  const thumb = scale(w, h, LONG)
  const resize = w >= h ? ["-resize", String(LONG), "0"] : ["-resize", "0", String(LONG)]
  await run("cwebp", ["-q", "78", "-m", "6", ...resize, upright, "-o", join(OUT, `${id}-900.webp`)])

  const raw = exif.datetime ?? ""
  photos.push({
    id,
    file,
    date: raw ? raw.slice(0, 10).replace(/:/g, "-") : "",
    camera: CAMERA[exif.model ?? ""] ?? exif.model ?? "",
    w: thumb.w,
    h: thumb.h,
    thumb: `assets/photos/${id}-900.webp`,
    alt: "",
  })
}

photos.sort((a, b) => a.date.localeCompare(b.date) || a.file.localeCompare(b.file))
await rm(TMP, { recursive: true, force: true })
await writeFile(
  join(OUT, "manifest.json"),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), photos }, null, 2) + "\n",
)
console.log(`${photos.length} photos → ${OUT}`)
