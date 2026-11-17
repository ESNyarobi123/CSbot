// Verifies the CSbot → CSolution catalog link end to end.
//
//   npm run catalog:check                                   # use POS_BASE_URL from .env
//   npm run catalog:check -- https://csolution.yunigo.online/api/csbot/ <token>
//
// Reports whether the API answers, how many products it returns, how many have
// photos, and downloads one photo to prove the image path works.
import { readFile } from "node:fs/promises"

const fromFile = async () => {
  try {
    const text = await readFile(new URL("../.env", import.meta.url), "utf8")
    return Object.fromEntries(text.split("\n")
      .filter(line => /^[A-Z0-9_]+=/.test(line))
      .map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]))
  } catch {
    return {}
  }
}

const env = await fromFile()
const raw = (process.argv[2] ?? env.POS_BASE_URL ?? "").trim()
const token = (process.argv[3] ?? env.POS_API_TOKEN ?? "").trim()
// Docker reaches the host by name; this script runs on the host, so translate it.
const base = raw.replace("://host.docker.internal", "://127.0.0.1").replace(/\/?$/, "/")

const fail = message => {
  console.error(`✗ ${message}`)
  process.exitCode = 1
}

if (!base) {
  fail("POS_BASE_URL is empty. Set it in .env or pass it as the first argument.")
  process.exit(1)
}
if (token.length < 24) {
  fail("POS_API_TOKEN is missing or shorter than 24 characters.")
  process.exit(1)
}

const headers = { authorization: `Bearer ${token}`, accept: "application/json" }
const timeout = AbortSignal.timeout(12_000)

console.log(`Catalog: ${base}`)

let health
try {
  // Next.js redirects the bare route to a trailing slash, so follow one hop here.
  const response = await fetch(base, { headers, redirect: "follow", signal: timeout })
  if (!response.ok) {
    fail(`health check answered HTTP ${response.status}. ${response.status === 404
      ? "The catalog API is not deployed on this host yet." : "Check the token and the URL."}`)
    process.exit(1)
  }
  health = await response.json()
} catch (error) {
  fail(`cannot reach the catalog API (${error.cause?.code ?? error.name}).`)
  process.exit(1)
}
console.log(`✓ healthy: ${health.products} products, ${health.images} with photos`)

const listUrl = new URL("products", base)
listUrl.searchParams.set("limit", "100")
const listed = await fetch(listUrl, { headers, redirect: "error", signal: timeout })
if (!listed.ok) {
  fail(`product list answered HTTP ${listed.status}`)
  process.exit(1)
}
const { items = [] } = await listed.json()
const withPhoto = items.filter(item => item.images?.length)
console.log(`✓ list: ${items.length} products, ${withPhoto.length} with a photo`)

if (!items.length) {
  console.error("✗ no products returned; the shop catalog is empty or every item is inactive.")
  process.exitCode = 1
} else if (!withPhoto.length) {
  console.warn("! every product is missing a photo, so WhatsApp replies will be text only.")
} else {
  const sample = withPhoto[0]
  const photoUrl = new URL(sample.images[0].url, base)
  const photo = await fetch(photoUrl, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: timeout })
  const type = photo.headers.get("content-type") ?? ""
  if (photo.ok && type.startsWith("image/")) {
    const bytes = (await photo.arrayBuffer()).byteLength
    console.log(`✓ photo: ${sample.name} → ${type}, ${Math.round(bytes / 1024)} KB`)
  } else {
    fail(`photo for ${sample.name} answered HTTP ${photo.status} (${type || "no type"})`)
  }
}

const missing = items.filter(item => !item.images?.length).slice(0, 12)
if (missing.length) {
  console.log(`\nMissing photos (${items.length - withPhoto.length}):`)
  for (const item of missing) console.log(`  ${item.sku ?? "—"}  ${item.name}`)
}
