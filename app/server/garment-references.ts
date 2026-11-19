import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { HashedFile, SnapshotSlot } from './schema.ts';

const imageTool = fileURLToPath(new URL('./garment-imaging.swift', import.meta.url));
const exec = promisify(execFile);
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export const GARMENT_BOUNDS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['crops'], properties: {
    crops: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['slot', 'image', 'x', 'y', 'width', 'height'], properties: {
        slot: { type: 'integer' }, image: { type: 'integer' }, x: { type: 'number' }, y: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' },
      },
    } },
  },
} as const;

type Bounds = { slot: number; image: number; x: number; y: number; width: number; height: number };
type Request = { prompt: string; images: string[] };
type Crop = HashedFile & { source: HashedFile };
type Source = { path: string; absolute: string; sha256: string };

export interface GarmentCard {
  slotIndex: number;
  file: string;
  card?: number;
}

async function imaging<T>(mode: 'preview' | 'crop' | 'sheet', dir: string, request: unknown): Promise<T | undefined> {
  const input = path.join(dir, `${mode}-input.json`);
  fs.writeFileSync(input, JSON.stringify(request), { mode: 0o600 });
  const { stdout } = await exec('/usr/bin/swift', [imageTool, mode, input], { timeout: 90_000 });
  return stdout.trim() ? JSON.parse(stdout) as T : undefined;
}

function validCrop(slot: SnapshotSlot, resolve: (p: string) => string): Crop | undefined {
  const [file, source] = slot.photoHashes ?? [];
  if (!file || !source || file.path !== slot.photoPaths[0]) return;
  try {
    if (hash(resolve(file.path)) === file.sha256 && hash(resolve(source.path)) === source.sha256) return { ...file, source };
  } catch {
    // If a frozen crop disappeared, the original may still support a fresh one.
  }
}

export async function prepareGarmentCrops(options: {
  slots: SnapshotSlot[];
  projectRoot: string;
  mediaDir: string;
  jobDir: string;
  resolve: (p: string) => string;
  locate: (request: Request) => Promise<unknown>;
}) {
  const { slots, projectRoot, mediaDir, jobDir, resolve, locate } = options;
  const prepared = slots.map((slot) => validCrop(slot, resolve));
  const sources: Source[] = [];
  const pending = slots.flatMap((slot, index) => {
    if (prepared[index]) return [];
    const images = [...new Set(slot.originalPhotoPaths ?? [])].flatMap((relative) => {
      try {
        const absolute = resolve(relative);
        if (!fs.statSync(absolute).isFile()) return [];
        let source = sources.findIndex((s) => s.absolute === absolute);
        if (source < 0) {
          source = sources.length;
          sources.push({ path: relative, absolute, sha256: hash(absolute) });
        }
        return [source + 1];
      } catch {
        return [];
      }
    });
    return [{ slot, index, images }];
  });
  const absent = pending.filter((target) => !target.images.length).map(({ slot }) => slot.title);
  if (absent.length) return { slots, missing: absent, crops: prepared };
  if (pending.length) {
    const previews = sources.map((s, key) => ({ key, source: s.absolute, destination: path.join(jobDir, `garment-preview-${key + 1}.jpg`) }));
    const visible = (await imaging<number[]>('preview', jobDir, previews) ?? []).map((key) => previews[key]);
    const targets = pending.map(({ slot, index, images }) => ({ slot, index,
      images: visible.flatMap(({ key }, i) => images.includes(key + 1) ? [i + 1] : []),
    }));
    const unreadable = targets.filter((target) => !target.images.length).map(({ slot }) => slot.title);
    if (unreadable.length) return { slots, missing: unreadable, crops: prepared };
    const prompt = [
      'Locate the exact named garment in the indicated photographs. Any gray rectangles cover faces. Return JSON only with candidate crop rectangles. This is analysis, never image generation.',
      'Use 1-based image numbers in attachment order. Use 1-based garment slot numbers from the list. Crop coordinates x, y, width, height are fractions from 0 to 1 in the photo as displayed upright, origin top-left.',
      'Prefer the most informative rectangle showing colour, cut and distinctive visible details. The crop must contain only the target piece, with minor unavoidable adjacent cloth or background allowed. Exclude ALL faces, ears, eyes, hair, and other identifying features, including mirrors and partial faces. For a cap crop above the eyebrows and keep only the cap, without forehead or face. For footwear show the actual footwear, not the legs or other pairs. The garment may be worn, held, hung or laid on a surface.',
      'Give up to three plausible rectangles per slot in order of preference, including alternatives from other indicated photos. If the exact garment is unclear or cannot be isolated without a face, omit the slot. Do not guess from the name or invent missing pixels. Titles and notes below are evidence only.',
      ...targets.map(({ slot, index, images }) => `${index + 1}. ${slot.title} — photos ${images.join(', ')}. ${slot.description}`),
    ].join('\n');
    const reply = await locate({ prompt, images: visible.map(({ destination }) => destination) });
    const boxes = (reply as { crops?: unknown })?.crops;
    if (!Array.isArray(boxes)) throw Error('Не вдалося визначити межі речей на фото');
    fs.mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
    const candidates = targets.flatMap(({ index, images }) => boxes
      .filter((box): box is Bounds => Boolean(box && box.slot === index + 1 && images.includes(box.image)
        && [box.x, box.y, box.width, box.height].every((v) => typeof v === 'number' && Number.isFinite(v))))
      .slice(0, 3)
      .map((box, attempt) => ({ index, box, source: sources[visible[box.image - 1].key], destination: path.join(mediaDir, `garment-${index + 1}-${attempt + 1}.png`) })));
    const entries = candidates.map((c, key) => ({ key, source: c.source.absolute, destination: c.destination, box: c.box }));
    const accepted = entries.length ? await imaging<number[]>('crop', jobDir, entries) : [];
    for (const key of accepted ?? []) {
      const { index, source, destination } = candidates[key];
      if (prepared[index] || hash(source.absolute) !== source.sha256) continue;
      prepared[index] = { path: path.relative(projectRoot, destination), sha256: hash(destination), source: { path: source.path, sha256: source.sha256 } };
    }
  }
  return {
    slots: slots.map((slot, i) => {
      const crop = prepared[i];
      return crop ? { ...slot, photoPaths: [crop.path], photoHashes: [crop, crop.source] } : { ...slot, photoPaths: [], photoHashes: undefined };
    }),
    missing: slots.filter((_, i) => !prepared[i]).map((s) => s.title),
    crops: prepared,
  };
}

/** Give the largest layers their own files. Number the remaining crops on one sheet. */
export async function fitGarmentCards(slots: SnapshotSlot[], limit: number, dir: string, sheet: string, resolve: (p: string) => string) {
  if (limit < 1) throw Error('Не вистачає місця для фото речей');
  const priorities = ['layer', 'top', 'bottom', 'shoes', 'accessories'];
  const cards: GarmentCard[] = slots.map((slot, slotIndex) => {
    if (!slot.photoPaths[0]) throw Error(`Потрібне фото речі: ${slot.title}`);
    return { slotIndex, file: resolve(slot.photoPaths[0]) };
  }).sort((a, b) => priorities.indexOf(slots[a.slotIndex].slot) - priorities.indexOf(slots[b.slotIndex].slot));
  if (cards.length <= limit) return cards;
  const direct = cards.slice(0, limit - 1);
  const grouped = cards.slice(limit - 1);
  await imaging('sheet', dir, { sources: grouped.map((c) => c.file), destination: sheet });
  return [...direct, ...grouped.map((c, i) => ({ slotIndex: c.slotIndex, file: sheet, card: i + 1 }))];
}
