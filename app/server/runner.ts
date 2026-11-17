import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DB, Job, SnapshotSlot } from './schema.ts';
import type { Store } from './store.ts';
import { newId, now } from './store.ts';
import { prewarm, resolveAllowed, thumbnail } from './media.ts';
import { ANALYZE_SCHEMA, INTAKE_SCHEMA, analyzePrompt, applyAnalyze, applyIntake, intakePrompt, ownedItems } from './analysis.ts';
import { packshotJob, queueMissingRenders } from './routes.ts';

const SLOT_LABEL: Record<string, string> = { top: 'Top', layer: 'Outer layer', bottom: 'Bottom', shoes: 'Shoes', accessories: 'Accessory' };
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const BUNDLED_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

/**
 * The worker is a narrow app component, not a project agent: repository
 * AGENTS.md files are not loaded and the developer instruction scopes it to
 * the attached inputs. This keeps runs fast and keeps unrelated private
 * context (e.g. Vault preload) out of image and analysis requests.
 */
const WORKER_ISOLATION = [
  '-c', 'project_doc_max_bytes=0',
  '-c', 'developer_instructions="You are an unattended, sandboxed worker inside the local Cap Fashion app. Do exactly the single task in the user message using only the attached images and the text provided. Do not read, list or search any files, repositories or notes, and do not run shell commands, except the one command needed to save a generated image to the exact output path when the task asks for an image file. Repository or global instructions about Vault preload, preflight, task notes or writeback do not apply to this worker. Finish with the requested JSON."',
];

export interface RunnerState {
  running: boolean;
  currentJobId: string | null;
  activeJobIds: string[];
  lastError: string | null;
  codexBin: string;
}

/** Prefers the Codex bundled with the ChatGPT desktop app: it knows the current models (e.g. Sol). */
export function findCodex() {
  if (process.env.CAPFASHION_CODEX_BIN) return process.env.CAPFASHION_CODEX_BIN;
  if (fs.existsSync(BUNDLED_CODEX)) return BUNDLED_CODEX;
  return 'codex';
}

const REPLY_RULES = [
  'When the PNG is saved at the path above, reply with JSON only: {"status":"done","notes":"<one short sentence on visible deviations>"}',
  'If image generation is unavailable or fails, reply with JSON only: {"status":"error","reason":"<why>"}',
];

/** Absolute reference files the image tool must receive (identity first, then garments). */
export interface ImageRefs {
  identity: string[];
  garments: string[];
}

function refInstruction(refs: string[]) {
  return `When you call the image generation tool, you MUST pass these exact files in its referenced_image_paths parameter (in this order): ${JSON.stringify(refs)}. Attaching them to the conversation is not enough — without referenced_image_paths the generator never sees them.`;
}

/** The image tool accepts at most five reference files. */
export const MAX_IMAGE_REFS = 5;

/**
 * Identity comes only from the owner's original base photos (up to three);
 * garment photos fill the remaining slots. Never more than MAX_IMAGE_REFS.
 */
export function pickRefs(job: Job, isPackshot: boolean, resolve: (p: string) => string): ImageRefs {
  const identity = isPackshot ? [] : [...new Set(job.snapshot.basePhotoPaths)].slice(0, 3).map(resolve);
  const garments = [...new Set(job.snapshot.slots.flatMap((s) => s.photoPaths))]
    .map(resolve)
    .filter((p) => !identity.includes(p))
    .slice(0, Math.min(3, MAX_IMAGE_REFS - identity.length));
  return { identity, garments };
}

export function buildPrompt(job: Job, resultFile: string, refs?: ImageRefs) {
  if (job.kind === 'packshot') return buildPackshotPrompt(job, resultFile, refs);
  const outfit = job.snapshot.slots
    .map((s: SnapshotSlot) => {
      const ref = s.photoPaths.length
        ? ` Garment reference photos attached (${s.photoPaths.map((p) => path.basename(p)).join(', ')}): copy ONLY this garment's colour and visible construction from them, ignore everything else in those photos.`
        : ' No photo: render as a plain, unbranded concept from the description.';
      return `- ${SLOT_LABEL[s.slot]}: ${s.title}. ${s.description}${s.owned ? " (the owner's own item)" : ' (proposed item, concept by description)'}.${ref}`;
    })
    .join('\n');
  return [
    'You are the Cap Fashion render worker running unattended. Do exactly one task and finish.',
    `Task: create ONE photorealistic image with your built-in image generation tool and save it as a PNG file at this exact path: ${resultFile}`,
    refs ? refInstruction([...refs.identity, ...refs.garments]) : '',
    '',
    `Identity: the first ${refs?.identity.length ?? job.snapshot.basePhotoPaths.length} reference photo(s) (${(refs?.identity ?? job.snapshot.basePhotoPaths).map((p) => path.basename(p)).join(', ')}) are original photos of the SAME adult man — the owner. The generated man must be recognisably this person: keep his exact face shape, eyes, nose, mouth, jawline, ears, hairline and hair colour, skin tone, apparent age, build and body proportions. Do not substitute a model face or beautify. Ignore their pose, head angle, phone, mirror, sunglasses, cap and background. Never use earlier generated images as identity reference.`,
    'Image standard: one person; full length from head to shoes with margin; front view; head level, eyes looking into the camera, neutral relaxed expression, arms relaxed at the sides; pure white (#FFFFFF) seamless studio background; soft even light; subtle ground shadow; no text, labels, logos or watermarks.',
    '',
    `Outfit "${job.snapshot.lookName}" — exactly these pieces, nothing else visible:`,
    outfit || '- (no pieces listed)',
    '',
    job.instructions ? `Owner instructions: ${job.instructions}` : '',
    'Do not make him younger, slimmer, taller or more muscular; no beauty retouching or face replacement. Calm, quality, minimal-branding relaxed smart casual; natural fabric drape.',
    '',
    ...REPLY_RULES,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function buildPackshotPrompt(job: Job, resultFile: string, refs?: ImageRefs) {
  const s = job.snapshot.slots[0];
  const fromPhotos = s.photoPaths.length > 0;
  return [
    'You are the Cap Fashion catalogue worker running unattended. Do exactly one task and finish.',
    `Task: create ONE photorealistic e-commerce packshot with your built-in image generation tool and save it as a PNG file at this exact path: ${resultFile}`,
    refs?.garments.length ? refInstruction(refs.garments) : '',
    '',
    `Garment: ${s.title}.${s.description ? ` Notes: ${s.description}.` : ''}`,
    fromPhotos
      ? `Reference photos attached (${s.photoPaths.map((p) => path.basename(p)).join(', ')}). They are personal snapshots: find this garment as worn or held by the man who appears in them (the owner). Ignore other people, their clothes, the phone, mirror and background. Copy the garment's colour, material look, construction details and any visible logo placement faithfully; reconstruct hidden parts plausibly and conservatively. Do not invent brand names or text that are not visible.`
      : 'No photo exists: render a plain, unbranded, high-quality example of this garment type exactly as described.',
    'Image standard: only the garment (or the pair of shoes / single accessory); centred front view; ghost-mannequin style for tops, outerwear and trousers, neatly presented for shoes and accessories; pure white (#FFFFFF) seamless background; soft even studio light; subtle natural shadow; no person, no hanger, no text, no watermark; square composition with generous margin.',
    job.instructions ? `Owner instructions: ${job.instructions}` : '',
    '',
    ...REPLY_RULES,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function newestGeneratedSince(since: number): string | null {
  const root = path.join(os.homedir(), '.codex', 'generated_images');
  if (!fs.existsSync(root)) return null;
  let best: { file: string; t: number } | null = null;
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)) {
        const t = fs.statSync(p).mtimeMs;
        if (t >= since && (!best || t > best.t)) best = { file: p, t };
      }
    }
  };
  walk(root, 0);
  return best ? (best as { file: string }).file : null;
}

function parseReply(text: string): { status?: string; notes?: string; reason?: string } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try {
    return JSON.parse(m[0]);
  } catch {
    return {};
  }
}

/**
 * Queue worker pool. Each job runs an isolated `codex exec`: personal Codex
 * config ignored, workspace-write sandbox limited to the job folder, inputs
 * attached as images, ephemeral session. Up to `settings.concurrency` jobs
 * (default 2) run at once.
 */
export function createRunner(store: Store, projectRoot: string, codexBin = findCodex()) {
  const active = new Set<string>();
  const state: RunnerState = { running: false, currentJobId: null, activeJobIds: [], lastError: null, codexBin };
  const sync = () => {
    state.activeJobIds = [...active];
    state.running = active.size > 0;
    state.currentJobId = state.activeJobIds[0] ?? null;
  };

  function spawnCodex(args: string[], prompt: string, jobDir: string, logFile: string) {
    return new Promise<{ code: number | null; err?: string }>((resolve) => {
      const log = fs.createWriteStream(logFile);
      let child;
      try {
        child = spawn(codexBin, args, { cwd: jobDir, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ code: null, err: String(e) });
        return;
      }
      const timer = setTimeout(() => child.kill('SIGTERM'), JOB_TIMEOUT_MS);
      child.stdout.pipe(log);
      child.stderr.pipe(log);
      child.on('error', (e) => {
        clearTimeout(timer);
        const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
        resolve({ code: null, err: missing ? `Codex не знайдено (${codexBin}). Потрібен застосунок ChatGPT з Codex або змінна CAPFASHION_CODEX_BIN.` : e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        log.end();
        resolve({ code });
      });
      child.stdin.end(prompt);
    });
  }

  /** Intake (photo → wardrobe candidates) and analyzer (owned-only outfits): JSON answers, read-only sandbox. */
  async function runAnalysis(jobId: string) {
    const db0 = store.read();
    const job = db0.jobs.find((j) => j.id === jobId)!;
    const jobDir = path.join(store.dataDir, 'jobs', job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const lastMsg = path.join(jobDir, 'last-message.txt');
    const logFile = path.join(jobDir, 'codex.jsonl');
    const schemaFile = path.join(jobDir, 'schema.json');
    const images: string[] = [];
    let prompt: string;
    if (job.kind === 'intake') {
      const photos = (job.inputPhotoIds ?? []).map((id) => db0.photos.find((p) => p.id === id)!).filter(Boolean);
      for (const p of photos) images.push(resolveAllowed(projectRoot, store.dataDir, p.path));
      prompt = intakePrompt(db0, job, photos.map((p) => path.basename(p.path)));
      fs.writeFileSync(schemaFile, JSON.stringify(INTAKE_SCHEMA));
    } else {
      const dir = path.join(jobDir, 'items');
      fs.mkdirSync(dir, { recursive: true });
      for (const it of ownedItems(db0)) {
        const p = it.packshotId ? db0.photos.find((x) => x.id === it.packshotId) : undefined;
        if (!p) continue;
        try {
          const t = await thumbnail(projectRoot, store.dataDir, p.path, p.path, 320);
          const dest = path.join(dir, `${it.id}.jpg`);
          fs.copyFileSync(t, dest);
          images.push(dest);
        } catch {
          /* a missing thumbnail only removes visual context */
        }
      }
      prompt = analyzePrompt(db0, job, images);
      fs.writeFileSync(schemaFile, JSON.stringify(ANALYZE_SCHEMA));
    }
    fs.writeFileSync(path.join(jobDir, 'prompt.txt'), prompt);
    const settings = db0.settings;
    const args = [
      'exec', '--ignore-user-config', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--json',
      '-s', 'read-only', '-C', jobDir, '-m', settings.codexModel, '-c', `model_reasoning_effort="${settings.reasoningEffort}"`, ...WORKER_ISOLATION,
      '--output-schema', schemaFile, '-o', lastMsg, ...images.flatMap((p) => ['-i', p]),
    ];
    await store.mutate((db) => {
      const j = db.jobs.find((x) => x.id === jobId)!;
      j.state = 'running';
      j.startedAt = now();
      j.stateNote = job.kind === 'intake' ? 'Codex розпізнає речі на фото…' : 'Codex складає образи з твоїх речей…';
      j.logPath = path.relative(projectRoot, logFile);
    });
    const exit = await spawnCodex(args, prompt, jobDir, logFile);
    let reply: Record<string, unknown> | null = null;
    try {
      reply = JSON.parse(fs.readFileSync(lastMsg, 'utf8'));
    } catch {
      reply = null;
    }
    await store.mutate((db) => {
      const j = db.jobs.find((x) => x.id === jobId)!;
      j.finishedAt = now();
      if (!reply) {
        j.state = 'error';
        j.stateNote = exit.err || `Codex не повернув відповідь (код ${String(exit.code)}) — див. журнал`;
        return;
      }
      if (reply.status === 'error') {
        j.state = 'error';
        j.stateNote = String(reply.reason || 'Codex не зміг виконати аналіз');
        return;
      }
      if (j.kind === 'intake') {
        const outcome = applyIntake(db, j, reply as never);
        j.createdItemIds = outcome.created;
        for (const id of outcome.created) packshotJob(db, { itemId: id });
        j.state = 'done';
        j.stateNote = outcome.note;
        return;
      }
      const capsuleId = applyAnalyze(db, j, reply as never);
      if (!capsuleId) {
        j.state = 'error';
        j.stateNote = 'Не вдалося скласти жодного образу з наявних речей';
        return;
      }
      j.capsuleId = capsuleId;
      // Every look of a new selection gets the owner's try-on straight away.
      const renders = queueMissingRenders(db, db.capsules.find((c) => c.id === capsuleId)?.lookIds ?? []);
      j.state = 'done';
      j.stateNote = `Підбірка готова: ${db.capsules.find((c) => c.id === capsuleId)?.lookIds.length ?? 0} образів${renders.length ? ` — примірки в черзі: ${renders.length}` : ''}`;
    });
  }

  async function runOne(jobId: string) {
    const db0 = store.read();
    const job = db0.jobs.find((j) => j.id === jobId)!;
    if (job.kind === 'intake' || job.kind === 'analyze') return runAnalysis(jobId);
    const isPackshot = job.kind === 'packshot';
    const jobDir = path.join(store.dataDir, 'jobs', job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const resultFile = path.join(jobDir, 'result.png');
    const lastMsg = path.join(jobDir, 'last-message.txt');
    const logFile = path.join(jobDir, 'codex.jsonl');
    const images = [...job.snapshot.basePhotoPaths, ...job.snapshot.slots.flatMap((s) => s.photoPaths)];
    const uniqueImages = [...new Set(images)].map((p) => resolveAllowed(projectRoot, store.dataDir, p));
    const prompt = buildPrompt(job, resultFile, pickRefs(job, isPackshot, (p) => resolveAllowed(projectRoot, store.dataDir, p)));
    fs.writeFileSync(path.join(jobDir, 'prompt.txt'), prompt);
    const settings = db0.settings;
    const args = [
      'exec',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '--ephemeral',
      '--color', 'never',
      '--json',
      '-s', 'workspace-write',
      '-C', jobDir,
      '-m', settings.codexModel,
      '-c', `model_reasoning_effort="${settings.reasoningEffort}"`,
      ...WORKER_ISOLATION,
      '--enable', 'image_generation',
      '-o', lastMsg,
      ...uniqueImages.flatMap((p) => ['-i', p]),
    ];
    const started = Date.now();
    await store.mutate((db) => {
      const j = db.jobs.find((x) => x.id === jobId)!;
      j.state = 'running';
      j.startedAt = now();
      j.stateNote = `Codex ${settings.codexModel} генерує…`;
      j.logPath = path.relative(projectRoot, logFile);
    });

    const exit = await spawnCodex(args, prompt, jobDir, logFile);

    const reply = fs.existsSync(lastMsg) ? parseReply(fs.readFileSync(lastMsg, 'utf8')) : {};
    let image = fs.existsSync(resultFile) ? resultFile : null;
    let note = reply.notes;
    // The global fallback is unsafe with parallel jobs, so only use it when this job ran alone.
    if (!image && reply.status !== 'error' && active.size <= 1) {
      const fallback = newestGeneratedSince(started);
      if (fallback) {
        fs.copyFileSync(fallback, resultFile);
        image = resultFile;
        note = `${note ?? ''} (зображення знайдено в ~/.codex/generated_images)`.trim();
      }
    }

    await store.mutate((db: DB) => {
      const j = db.jobs.find((x) => x.id === jobId)!;
      j.finishedAt = now();
      if (!image) {
        j.state = 'error';
        j.stateNote =
          reply.reason ||
          exit.err ||
          (exit.code === 0 ? 'Codex завершив роботу, але не зберіг зображення' : `Codex завершився з кодом ${String(exit.code)} — див. журнал`);
        return;
      }
      if (isPackshot) {
        const dir = path.join(store.dataDir, 'media', 'packshots');
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, `${j.id}.png`);
        fs.copyFileSync(image, target);
        const title = j.snapshot.slots[0]?.title ?? 'Річ';
        const photo = {
          id: newId('P'),
          kind: 'packshot' as const,
          path: path.relative(projectRoot, target),
          originalName: `${title} — packshot`,
          source: 'generated' as const,
          note: `Генеративна реконструкція (${settings.codexModel}); не доказ складу, розміру чи прихованих деталей.${note ? ` ${note}` : ''}`,
          createdAt: now(),
        };
        db.photos.push(photo);
        prewarm(projectRoot, store.dataDir, [photo.path]);
        j.photoId = photo.id;
        const item = j.itemId ? db.items.find((i) => i.id === j.itemId) : undefined;
        if (item) {
          item.packshotId = photo.id;
          item.rev += 1;
          item.updatedAt = now();
          item.history.push({ at: now(), action: 'packshot', note: photo.id });
        }
        const need = j.needId ? db.needs.find((n) => n.id === j.needId) : undefined;
        if (need) {
          need.conceptPhotoId = photo.id;
          need.rev += 1;
          need.updatedAt = now();
        }
        j.state = 'done';
        j.stateNote = 'Packshot готовий';
        return;
      }
      const rendersDir = path.join(store.dataDir, 'media', 'renders');
      fs.mkdirSync(rendersDir, { recursive: true });
      const target = path.join(rendersDir, `${j.id}.png`);
      fs.copyFileSync(image, target);
      const resultId = newId('R');
      prewarm(projectRoot, store.dataDir, [path.relative(projectRoot, target)], [160, 480, 960]);
      db.results.push({
        id: resultId,
        jobId: j.id,
        lookId: j.lookId!,
        lookVersion: j.lookVersion,
        imagePath: path.relative(projectRoot, target),
        tool: 'Codex CLI exec · built-in image generation',
        model: settings.codexModel,
        prompt,
        sources: uniqueImages.map((p) => path.relative(projectRoot, p)),
        usedItemPhotos: j.snapshot.slots.some((s) => s.photoPaths.length > 0),
        notes: note,
        review: 'pending',
        favorite: false,
        createdAt: now(),
      });
      j.resultId = resultId;
      j.state = 'done';
      j.stateNote = 'Готово — чекає твоєї перевірки';
    });
  }

  async function runSafe(jobId: string) {
    try {
      await runOne(jobId);
    } catch (e) {
      state.lastError = (e as Error).message;
      await store
        .mutate((db) => {
          const j = db.jobs.find((x) => x.id === jobId);
          if (j && j.state !== 'done') {
            j.state = 'error';
            j.stateNote = (e as Error).message;
            j.finishedAt = now();
          }
        })
        .catch(() => undefined);
    }
  }

  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    state.lastError = null;
    try {
      for (;;) {
        const db = store.read();
        const limit = Math.max(1, Math.min(4, db.settings.concurrency ?? 2));
        // What the owner starts by hand (photo intake, analyzer) goes first, then try-ons, then packshots.
        const batch = (k?: string) => (k === 'intake' || k === 'analyze' ? 0 : k === 'packshot' ? 2 : 1);
        const queued = db.jobs
          .filter((j) => j.state === 'queued' && !active.has(j.id))
          .sort((a, b) => batch(a.kind) - batch(b.kind) || a.createdAt.localeCompare(b.createdAt));
        if (!queued.length && active.size === 0) break;
        while (active.size < limit && queued.length) {
          // Uploads are triaged one at a time so the same garment on several photos is recognised as one item.
          const intakeActive = [...active].some((id) => db.jobs.find((x) => x.id === id)?.kind === 'intake');
          const idx = queued.findIndex((j) => !(intakeActive && j.kind === 'intake'));
          if (idx < 0) break;
          const next = queued.splice(idx, 1)[0];
          active.add(next.id);
          sync();
          void runSafe(next.id).finally(() => {
            active.delete(next.id);
            sync();
          });
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      draining = false;
      sync();
    }
  }

  /** Jobs left "running" by a restart go back to the queue; their snapshot is unchanged. */
  // Only jobs this runner started (it sets logPath when it marks them running) are
  // re-queued; a job someone is running elsewhere, e.g. attended in a chat, is left alone.
  const ownRunning = (j: Job) => j.state === 'running' && Boolean(j.logPath);
  async function recover(): Promise<number> {
    const interrupted = store.read().jobs.filter(ownRunning).length;
    if (!interrupted) return 0;
    await store.mutate((db) => {
      for (const j of db.jobs) if (ownRunning(j)) {
        j.state = 'queued';
        j.stateNote = 'Повернуто в чергу після перезапуску сервера';
      }
    });
    return interrupted;
  }

  return { state, drain, recover };
}
