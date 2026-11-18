// Shop search (owner, 17.11): for one shopping recommendation, Codex searches the web — the stores at
// the owner's place (Profile → Магазини) and the owner's stores first, then the brands' own stores — and returns
// 2–4 real products with a match score against the recommendation, its looks and the owner's taste.
// Results are dated options, never availability promises; product photos are fetched by the server.
import fs from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import type { DB, Job, Product } from './schema.ts';
import { newId, now } from './store.ts';
import { detectImageType } from './media.ts';
import { siteLooks, wardrobeBrands, missingNeeds, resolveRef, shopLocation } from '../src/lib.ts';

const str = { type: 'string' } as const;

export const SHOP_SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reason', 'products'],
  properties: {
    status: { type: 'string', enum: ['done', 'error'] },
    reason: str,
    products: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['store', 'brand', 'model', 'sku', 'url', 'imageUrl', 'price', 'currency', 'inTower', 'size', 'matchScore', 'matchNote'],
        properties: { store: str, brand: str, model: str, sku: str, url: str, imageUrl: str, price: str, currency: str, inTower: { type: 'boolean' }, size: str, matchScore: { type: 'number' }, matchNote: str },
      },
    },
  },
};

export interface ShopReply {
  status: string;
  reason: string;
  products: { store: string; brand: string; model: string; sku?: string; url: string; imageUrl: string; price: string; currency: string; inTower: boolean; size: string; matchScore: number; matchNote: string }[];
}

/** The owner's brands: the saved list, or what the wardrobe shows until the owner edits it. */
export const ownerBrands = (db: DB) => db.profile.brands ?? wardrobeBrands(db);

export function shopSearchPrompt(db: DB, job: Job) {
  const need = db.needs.find((n) => n.id === job.needId)!;
  const prefs = db.profile.preferences;
  const location = shopLocation(db);
  // Links the owner dropped with × count as found: a new search never brings them back.
  const known = [...db.products.filter((p) => p.needId === need.id && p.url).map((p) => p.url!), ...(need.droppedUrls ?? [])];
  const sizes = db.profile.knownSizes.map((s) => `${s.brand} ${s.category}: ${s.size}`).join('; ');
  const looks = siteLooks(db)
    .filter((l) => missingNeeds(db, l).includes(need.id))
    .map((l) => `- ${l.name}: ${Object.values(l.slots).flat().filter((r) => !(r.kind === 'need' && r.id === need.id)).map((r) => resolveRef(db, r).title).join(', ')}`);
  return [
    'You are the Cap Fashion shop-search worker running unattended. Use live web search. Answer with JSON only (schema enforced).',
    'Find 2 to 4 products the owner can buy now that fulfil this shopping recommendation.',
    `Recommendation: ${need.title} — ${need.description}`,
    need.why ? `Why it is recommended: ${need.why}` : '',
    need.fitCheck ? `Fit to check: ${need.fitCheck}` : '',
    `Owner's brands (search these first): ${ownerBrands(db).join(', ') || '—'}.`,
    db.profile.stores?.length ? `Owner's stores (check these first): ${db.profile.stores.join(', ')}.` : '',
    location
      ? `Where: first the stores at the owner's shopping place «${location}» — check which stores are there (the owner's stores first) and whether they sell such a piece; then the official online stores of the owner's stores and brands that ship to Croatia. Other shops only if nothing suitable is found there.`
      : 'Where: the official online stores of the owner\'s stores and brands that ship to Croatia. Other shops only if nothing suitable is found there.',
    `Owner's taste — comfort: ${prefs.comfort || '—'}; materials: ${prefs.materials || '—'}; fit: ${prefs.fit || '—'}; branding: ${prefs.branding || '—'}.`,
    sizes ? `Known sizes: ${sizes}.` : '',
    looks.length ? `Looks this piece would complete (with their other pieces):\n${looks.join('\n')}` : '',
    known.length ? `Already found (do not return these again; find different ones): ${known.join(' ')}` : '',
    'Rules: only real products listed right now, each with its direct product page URL and a direct https image URL of the product taken from that page. Never invent products, prices, URLs or images; leave out anything you could not verify. model: the model name and colour as shown to shoppers, without article numbers or colour codes; sku: the article number if shown, else empty. price: the number with a decimal point as text, empty if unknown; currency: ISO code. inTower: true only when the store is at the owner\'s shopping place. size: the size to try from the known sizes, else empty. matchScore 0–10: colour, cut, material and style against the recommendation, the looks and the taste; use distinct scores so the best one is clear. matchNote: one short Ukrainian sentence why. Best first.',
    'Return status "error" only if web search is unavailable; if nothing suitable exists, status "done" with an empty list and the reason in Ukrainian.',
    job.instructions ? `Owner note: ${job.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const httpsUrl = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' ? x : null;
  } catch {
    return null;
  }
};

/** Saves the found products as dated options of the recommendation; returns the photos to fetch. */
export function applyShopSearch(db: DB, job: Job, reply: ShopReply) {
  const need = db.needs.find((n) => n.id === job.needId);
  const at = now();
  const created: string[] = [];
  const images: { productId: string; url: string }[] = [];
  if (!need) return { created, images, note: 'Покупку не знайдено' };
  const known = new Set([...db.products.filter((p) => p.needId === need.id && p.url).map((p) => p.url), ...(need.droppedUrls ?? [])]);
  for (const r of (reply.products ?? []).slice(0, 4)) {
    const url = httpsUrl(String(r.url || '').trim());
    const store = String(r.store || '').trim().slice(0, 80);
    // Article numbers stay out of the name the owner sees: «Spezial Brown (JQ1740)» → name + sku.
    const code = /\s*\((?=[^)]*\d)([A-Z0-9][A-Z0-9 /.-]{3,})\)\s*$/.exec(String(r.model || ''));
    const model = String(r.model || '').replace(code?.[0] ?? '', '').trim().slice(0, 160);
    const sku = String(r.sku || '').trim().slice(0, 60) || code?.[1];
    if (!url || !store || !model || known.has(url.href)) continue;
    known.add(url.href);
    const price = Number(String(r.price || '').replace(',', '.'));
    const p: Product = {
      id: newId('S'),
      rev: 1,
      needId: need.id,
      store,
      brand: String(r.brand || '').trim().slice(0, 80),
      model,
      sku: sku || undefined,
      url: url.href,
      price: String(r.price || '').trim() && Number.isFinite(price) ? price : null,
      currency: String(r.currency || '').trim().slice(0, 8) || undefined,
      recommendedSize: String(r.size || '').trim().slice(0, 40) || undefined,
      onlineAvailability: 'unknown',
      towerAvailability: r.inTower ? 'confirmed' : 'unknown',
      checkedAt: at.slice(0, 10),
      sources: `Пошук ${at.slice(0, 10)}`,
      matchScore: Math.max(0, Math.min(10, Math.round(Number(r.matchScore) || 0))),
      matchNote: String(r.matchNote || '').trim().slice(0, 240) || undefined,
      status: 'option',
      createdAt: at,
      updatedAt: at,
    };
    db.products.push(p);
    created.push(p.id);
    const img = httpsUrl(String(r.imageUrl || '').trim());
    if (img) images.push({ productId: p.id, url: img.href });
  }
  const note = created.length ? `Знайдено варіантів: ${created.length}` : reply.reason || 'Нічого відповідного не знайдено';
  return { created, images, note };
}

const PRIVATE_HOST = /^(localhost|0\.)|\.local$|\.internal$|\.exmachina$|\.ts\.net$/i;

/** Loopback, private, link-local, carrier-grade NAT (tailnet) and unique-local addresses are never fetched. */
function privateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

async function publicUrl(u: URL) {
  if (u.protocol !== 'https:' || PRIVATE_HOST.test(u.hostname)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !privateAddress(host);
  try {
    const all = await dns.lookup(host, { all: true });
    return all.length > 0 && all.every((x) => !privateAddress(x.address));
  } catch {
    return false;
  }
}

const MAX_PHOTO = 8 * 1024 * 1024;

/** Fetches a product photo from a public https address; returns the saved file (relative) or null. */
export async function fetchProductImage(projectRoot: string, dataDir: string, id: string, url: string): Promise<string | null> {
  let u = httpsUrl(url);
  try {
    let res: Response | null = null;
    // Every redirect is checked again before it is followed (at most 3).
    for (let hop = 0; u && hop <= 3; hop += 1) {
      if (!(await publicUrl(u))) return null;
      res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (Cap Fashion product photo)' } });
      if (res.status < 300 || res.status >= 400) break;
      const next = res.headers.get('location');
      u = next ? httpsUrl(new URL(next, u).href) : null;
      res = null;
    }
    if (!res || !res.ok || !String(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_PHOTO) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_PHOTO) return null;
    const type = detectImageType(buf);
    if (!type || type === 'heic') return null;
    const dir = path.join(dataDir, 'media', 'products');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${id}.${type}`);
    fs.writeFileSync(file, buf);
    return path.relative(projectRoot, file);
  } catch {
    return null;
  }
}
