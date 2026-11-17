import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DB, Job, SnapshotSlot } from './schema.ts';
import type { Store } from './store.ts';
import { newId, now } from './store.ts';
import { resolveAllowed } from './media.ts';

const SLOT_LABEL: Record<string, string> = { top: 'Top', layer: 'Outer layer', bottom: 'Bottom', shoes: 'Shoes', accessories: 'Accessory' };
const JOB_TIMEOUT_MS = 15 * 60 * 1000;

export interface RunnerState {
  running: boolean;
  currentJobId: string | null;
  lastError: string | null;
}

export function buildPrompt(job: Job, resultFile: string) {
  const outfit = job.snapshot.slots
    .map((s: SnapshotSlot) => {
      const ref = s.photoPaths.length
        ? ` Garment reference photos attached (${s.photoPaths.map((p) => path.basename(p)).join(', ')}): copy ONLY this garment's colour and visible construction from them, ignore everything else in those photos.`
        : ' No photo: render as a plain, unbranded concept from the description.';
      return `- ${SLOT_LABEL[s.slot]}: ${s.title}. ${s.description}${s.owned ? ' (the owner\'s own item)' : ' (proposed item, concept by description)'}.${ref}`;
    })
    .join('\n');
  return [
    'You are the Cap Fashion render worker running unattended. Do exactly one task and finish.',
    `Task: create ONE photorealistic image with your built-in image generation tool and save it as a PNG file at this exact path: ${resultFile}`,
    '',
    `Identity: the base photos (${job.snapshot.basePhotoPaths.map((p) => path.basename(p)).join(', ')}) show the SAME adult man. Use them only for his face, hair, skin, apparent age, build and body proportions. Do not copy their pose, head angle, phone, mirror, sunglasses, cap or background. Never use earlier generated images as identity reference.`,
    'Image standard: one person; full length from head to shoes with margin; front view; head level, eyes looking into the camera, neutral relaxed expression, arms relaxed at the sides; pure white (#FFFFFF) seamless studio background; soft even light; subtle ground shadow; no text, labels, logos or watermarks.',
    '',
    `Outfit "${job.snapshot.lookName}" — exactly these pieces, nothing else visible:`,
    outfit || '- (no pieces listed)',
    '',
    job.instructions ? `Owner instructions: ${job.instructions}` : '',
    'Do not make him younger, slimmer, taller or more muscular; no beauty retouching or face replacement. Calm, quality, minimal-branding relaxed smart casual; natural fabric drape.',
    '',
    'When the PNG is saved at the path above, reply with JSON only: {"status":"done","notes":"<one short sentence on visible deviations>"}',
    'If image generation is unavailable or fails, reply with JSON only: {"status":"error","reason":"<why>"}',
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
 * Sequential queue worker. Each job runs an isolated `codex exec`: personal
 * Codex config ignored, workspace-write sandbox limited to the job folder,
 * inputs attached as images, ephemeral session.
 */
const BUNDLED_CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';

/** Prefers the Codex bundled with the ChatGPT desktop app: it knows the current models (e.g. Sol). */
export function findCodex() {
  if (process.env.CAPFASHION_CODEX_BIN) return process.env.CAPFASHION_CODEX_BIN;
  if (fs.existsSync(BUNDLED_CODEX)) return BUNDLED_CODEX;
  return 'codex';
}

export function createRunner(store: Store, projectRoot: string, codexBin = findCodex()) {
  const state: RunnerState & { codexBin: string } = { running: false, currentJobId: null, lastError: null, codexBin };

  async function runOne(jobId: string) {
    const db0 = store.read();
    const job = db0.jobs.find((j) => j.id === jobId)!;
    const jobDir = path.join(store.dataDir, 'jobs', job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    const resultFile = path.join(jobDir, 'result.png');
    const lastMsg = path.join(jobDir, 'last-message.txt');
    const logFile = path.join(jobDir, 'codex.jsonl');
    const images = [...job.snapshot.basePhotoPaths, ...job.snapshot.slots.flatMap((s) => s.photoPaths)];
    const uniqueImages = [...new Set(images)].map((p) => resolveAllowed(projectRoot, store.dataDir, p));
    const prompt = buildPrompt(job, resultFile);
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

    const exit = await new Promise<{ code: number | null; err?: string }>((resolve) => {
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
        resolve({ code: null, err: e.message });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        log.end();
        resolve({ code });
      });
      child.stdin.end(prompt);
    });

    const reply = fs.existsSync(lastMsg) ? parseReply(fs.readFileSync(lastMsg, 'utf8')) : {};
    let image = fs.existsSync(resultFile) ? resultFile : null;
    let note = reply.notes;
    if (!image && reply.status !== 'error') {
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
      if (image) {
        const rendersDir = path.join(store.dataDir, 'media', 'renders');
        fs.mkdirSync(rendersDir, { recursive: true });
        const target = path.join(rendersDir, `${j.id}.png`);
        fs.copyFileSync(image, target);
        const resultId = newId('R');
        db.results.push({
          id: resultId,
          jobId: j.id,
          lookId: j.lookId,
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
      } else {
        j.state = 'error';
        j.stateNote =
          reply.reason ||
          exit.err ||
          (exit.code === 0 ? 'Codex завершив роботу, але не зберіг зображення' : `Codex завершився з кодом ${String(exit.code)} — див. журнал`);
      }
    });
  }

  async function drain() {
    if (state.running) return;
    state.running = true;
    state.lastError = null;
    try {
      for (;;) {
        const next = store
          .read()
          .jobs.filter((j) => j.state === 'queued')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (!next) break;
        state.currentJobId = next.id;
        try {
          await runOne(next.id);
        } catch (e) {
          state.lastError = (e as Error).message;
          await store.mutate((db) => {
            const j = db.jobs.find((x) => x.id === next.id);
            if (j && j.state !== 'done') {
              j.state = 'error';
              j.stateNote = (e as Error).message;
              j.finishedAt = now();
            }
          });
        }
      }
    } finally {
      state.running = false;
      state.currentJobId = null;
    }
  }

  /** Jobs left "running" by a crash are surfaced as errors on startup. */
  async function recover() {
    const stuck = store.read().jobs.some((j) => j.state === 'running');
    if (!stuck) return;
    await store.mutate((db) => {
      for (const j of db.jobs) if (j.state === 'running') {
        j.state = 'error';
        j.stateNote = 'Сервер перезапустився під час генерації — спробуй ще раз';
        j.finishedAt = now();
      }
    });
  }

  return { state, drain, recover };
}
