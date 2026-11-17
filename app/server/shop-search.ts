// Shop search (owner, 17.11): for one shopping recommendation, Codex searches the web — stores in
// Tower Center Rijeka first, then the owner's brands' own stores shipping to Croatia — and returns
// 2–4 real products with a match score against the recommendation, its looks and the owner's taste.
// Results are dated options, never availability promises; product photos are fetched by the server.
import fs from 'node:fs';
import path from 'node:path';
import type { DB, Job, Product } from './schema.ts';
import { newId, now } from './store.ts';
import { detectImageType } from './media.ts';
import { siteLooks, wardrobeBrands, missingNeeds, resolveRef } from '../src/lib.ts';

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
        required: ['store', 'brand', 'model', 'url', 'imageUrl', 'price', 'currency', 'inTower', 'size', 'matchScore', 'matchNote'],
        properties: { store: str, brand: str, model: str, url: str, imageUrl: str, price: str, currency: str, inTower: { type: 'boolean' }, size: str, matchScore: { type: 'number' }, matchNote: str },
      },
    },
  },
};

export interface ShopReply {
  status: string;
  reason: string;
  products: { store: string; brand: string; model: string; url: string; imageUrl: string; price: string; currency: string; inTower: boolean; size: string; matchScore: number; matchNote: string }[];
}

/** The owner's brands: the saved list, or what the wardrobe shows until the owner edits it. */
export const ownerBrands = (db: DB) => db.profile.brands ?? wardrobeBrands(db);

export function shopSearchPrompt(db: DB, job: Job) {
  const need = db.needs.find((n) => n.id === job.needId)!;
  const prefs = db.profile.preferences;
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
    'Where: first the stores in Tower Center Rijeka (Rijeka, Croatia) — check which stores are there and whether they sell such a piece; then the official online stores of the owner\'s brands that ship to Croatia. Other shops only if nothing suitable is found there.',
    `Owner's taste — comfort: ${prefs.comfort || '—'}; materials: ${prefs.materials || '—'}; fit: ${prefs.fit || '—'}; branding: ${prefs.branding || '—'}.`,
    sizes ? `Known sizes: ${sizes}.` : '',
    looks.length ? `Looks this piece would complete (with their other pieces):\n${looks.join('\n')}` : '',
    'Rules: only real products listed right now, each with its direct product page URL and a direct https image URL of the product taken from that page. Never invent products, prices, URLs or images; leave out anything you could not verify. price: the number with a decimal point as text, empty if unknown; currency: ISO code. inTower: true only when the store is in Tower Center Rijeka. size: the size to try from the known sizes, else empty. matchScore 0–10: colour, cut, material and style against the recommendation, the looks and the taste. matchNote: one short Ukrainian sentence why. Best first.',
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
  const known = new Set(db.products.filter((p) => p.needId === need.id && p.url).map((p) => p.url));
  for (const r of (reply.products ?? []).slice(0, 4)) {
    const url = httpsUrl(String(r.url || '').trim());
    const store = String(r.store || '').trim().slice(0, 80);
    const model = String(r.model || '').trim().slice(0, 160);
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

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|0\.)|\.local$|\.internal$|\.exmachina$|\.ts\.net$/i;

/** Fetches a product photo from a public https address; returns the saved file (relative) or null. */
export async function fetchProductImage(projectRoot: string, dataDir: string, id: string, url: string): Promise<string | null> {
  const u = httpsUrl(url);
  if (!u || PRIVATE_HOST.test(u.hostname)) return null;
  try {
    const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (Cap Fashion product photo)' } });
    if (!res.ok || !String(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
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
