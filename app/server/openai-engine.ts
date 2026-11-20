// OpenAI API engine: the same JSON-schema answers and
// images the local Codex worker produces, through the Responses API (structured outputs, optional web search)
// and the Images API (edits with reference images: identity first, then garments). Models come only from the
// environment — no guessed defaults — and every call is logged without image data.
import fs from 'node:fs';
import path from 'node:path';
import { detectImageType } from './media.ts';

export interface OpenAIConfig {
  apiKey: string;
  textModel: string;
  imageModel: string;
  /** Try-ons use `tryonQuality`, catalogue pictures `packshotQuality`. */
  tryonQuality: string;
  packshotQuality: string;
  baseURL: string;
  /** USD per 1M tokens (search: per call), for the monthly budget; without prices nothing is costed. */
  prices?: Prices;
  fetch?: typeof fetch;
}

export interface Prices { textIn: number; textOut: number; imageIn: number; imageOut: number; searchCall: number }
export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }

const PRICE_KEYS: Record<string, keyof Prices> = { text_in: 'textIn', text_out: 'textOut', image_in: 'imageIn', image_out: 'imageOut', search_call: 'searchCall' };

/** `OPENAI_PRICES=text_in:…,text_out:…,image_in:…,image_out:…,search_call:…` from the official price list (no guessed defaults). */
export function pricesFromEnv(value: string | undefined): Prices | undefined {
  if (!value?.trim()) return undefined;
  const out: Partial<Prices> = {};
  for (const part of value.split(',')) {
    const [k, v] = part.split(':').map((x) => x.trim());
    const key = PRICE_KEYS[k];
    const n = Number(v);
    if (!key || !Number.isFinite(n) || n < 0) throw new Error(`OPENAI_PRICES: cannot read "${part.trim()}"`);
    out[key] = n;
  }
  const missing = Object.entries(PRICE_KEYS).filter(([, key]) => out[key] === undefined).map(([k]) => k);
  if (missing.length) throw new Error(`OPENAI_PRICES is missing ${missing.join(', ')}`);
  return out as Prices;
}

export function openAIConfigFromEnv(env: NodeJS.ProcessEnv): OpenAIConfig | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const textModel = env.OPENAI_TEXT_MODEL?.trim();
  const imageModel = env.OPENAI_IMAGE_MODEL?.trim();
  if (!textModel || !imageModel) throw new Error('Set OPENAI_TEXT_MODEL and OPENAI_IMAGE_MODEL with OPENAI_API_KEY (check the current official model list).');
  return {
    apiKey,
    textModel,
    imageModel,
    tryonQuality: env.OPENAI_TRYON_QUALITY?.trim() || 'high',
    packshotQuality: env.OPENAI_PACKSHOT_QUALITY?.trim() || 'medium',
    baseURL: (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, ''),
    prices: pricesFromEnv(env.OPENAI_PRICES),
  };
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic' };
const mimeOf = (buf: Buffer) => MIME[detectImageType(buf) ?? ''] ?? 'image/jpeg';

function log(file: string | undefined, entry: Record<string, unknown>) {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

/** The text of a Responses API answer: the output_text parts of its message items. */
export function responseText(body: unknown): string {
  const output = (body as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] })?.output ?? [];
  return output
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

/**
 * The image prompt for the API: the Codex worker's instructions (save to a path, pass referenced_image_paths,
 * reply with JSON) are dropped, and the attached files are named in order so the prompt's references resolve.
 */
export function apiImagePrompt(workerPrompt: string, images: string[]): string {
  const lines = workerPrompt.split('\n').filter((l) =>
    !l.startsWith('You are the Capsula') &&
    !l.startsWith('When you call the image generation tool') &&
    !l.startsWith('When the PNG is saved') &&
    !l.startsWith('If image generation is unavailable'));
  const task = lines.findIndex((l) => l.startsWith('Task: create ONE'));
  if (task >= 0) lines[task] = lines[task].replace(/ with your built-in image generation tool and save it as a PNG file at this exact path: .*$/, '.');
  const order = images.length ? `Attached images, in order: ${images.map((p, i) => `${i + 1}) ${path.basename(p)}`).join('; ')}.` : '';
  return [order, ...lines].filter(Boolean).join('\n');
}

export function createOpenAIEngine(cfg: OpenAIConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const headers = { authorization: `Bearer ${cfg.apiKey}` };
  const p = cfg.prices;
  // All image-model input is priced as image input: a little above the real bill, never below it.
  const textCost = (i: number, o: number, searches: number) => (p ? (i * p.textIn + o * p.textOut) / 1e6 + searches * p.searchCall : 0);
  const imageCost = (i: number, o: number) => (p ? (i * p.imageIn + o * p.imageOut) / 1e6 : 0);

  async function failure(res: Response) {
    const text = await res.text().catch(() => '');
    let message = text.slice(0, 300);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      /* not JSON */
    }
    return `OpenAI ${res.status}: ${message || res.statusText}`;
  }

  return {
    label: cfg.textModel,
    imageLabel: cfg.imageModel,

    /** A JSON answer that follows `schema` exactly; images are attached as data URLs. */
    async json(req: { prompt: string; schema: object; images?: string[]; webSearch?: boolean; logFile?: string }): Promise<{ reply: Record<string, unknown> | null; err?: string; usage?: Usage }> {
      const content: Record<string, unknown>[] = [{ type: 'input_text', text: req.prompt }];
      for (const file of req.images ?? []) {
        const buf = fs.readFileSync(file);
        content.push({ type: 'input_image', image_url: `data:${mimeOf(buf)};base64,${buf.toString('base64')}` });
      }
      const body = {
        model: cfg.textModel,
        // Nothing is kept on OpenAI's side for later turns: every call stands alone.
        store: false,
        input: [{ role: 'user', content }],
        text: { format: { type: 'json_schema', name: 'reply', schema: req.schema, strict: true } },
        ...(req.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
      };
      log(req.logFile, { call: 'responses', model: cfg.textModel, images: (req.images ?? []).map((p) => path.basename(p)), webSearch: Boolean(req.webSearch) });
      let res: Response;
      try {
        res = await doFetch(`${cfg.baseURL}/responses`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      } catch (e) {
        log(req.logFile, { error: String(e) });
        return { reply: null, err: `OpenAI недоступний: ${(e as Error).message}` };
      }
      if (!res.ok) {
        const err = await failure(res);
        log(req.logFile, { status: res.status, error: err });
        return { reply: null, err };
      }
      const data = (await res.json()) as { usage?: { input_tokens?: number; output_tokens?: number }; output?: { type?: string }[] };
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;
      const searches = (data.output ?? []).filter((o) => o.type === 'web_search_call').length;
      const usage = { inputTokens, outputTokens, costUsd: textCost(inputTokens, outputTokens, searches) };
      log(req.logFile, { status: res.status, usage });
      try {
        return { reply: JSON.parse(responseText(data)), usage };
      } catch {
        return { reply: null, err: 'OpenAI повернув відповідь не за схемою', usage };
      }
    },

    /** One PNG at `resultFile`: an edit of the reference images, or a fresh generation when there are none. */
    async image(req: { prompt: string; images: string[]; resultFile: string; packshot: boolean; logFile?: string }): Promise<{ ok: boolean; err?: string; usage?: Usage }> {
      const size = req.packshot ? '1024x1024' : '1024x1536';
      const quality = req.packshot ? cfg.packshotQuality : cfg.tryonQuality;
      log(req.logFile, { call: req.images.length ? 'images/edits' : 'images/generations', model: cfg.imageModel, size, quality, images: req.images.map((p) => path.basename(p)) });
      let res: Response;
      try {
        if (req.images.length) {
          const form = new FormData();
          form.set('model', cfg.imageModel);
          form.set('prompt', req.prompt);
          form.set('size', size);
          form.set('quality', quality);
          form.set('n', '1');
          for (const file of req.images) {
            const buf = fs.readFileSync(file);
            form.append('image[]', new Blob([buf], { type: mimeOf(buf) }), path.basename(file));
          }
          res = await doFetch(`${cfg.baseURL}/images/edits`, { method: 'POST', headers, body: form });
        } else {
          res = await doFetch(`${cfg.baseURL}/images/generations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ model: cfg.imageModel, prompt: req.prompt, size, quality, n: 1 }) });
        }
      } catch (e) {
        log(req.logFile, { error: String(e) });
        return { ok: false, err: `OpenAI недоступний: ${(e as Error).message}` };
      }
      if (!res.ok) {
        const err = await failure(res);
        log(req.logFile, { status: res.status, error: err });
        return { ok: false, err };
      }
      const data = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      const inputTokens = data.usage?.input_tokens ?? 0;
      const outputTokens = data.usage?.output_tokens ?? 0;
      const usage = { inputTokens, outputTokens, costUsd: imageCost(inputTokens, outputTokens) };
      const b64 = data.data?.[0]?.b64_json;
      log(req.logFile, { status: res.status, usage, image: Boolean(b64) });
      if (!b64) return { ok: false, err: 'OpenAI не повернув зображення', usage };
      const png = Buffer.from(b64, 'base64');
      if (detectImageType(png) !== 'png') return { ok: false, err: 'OpenAI повернув не PNG', usage };
      fs.writeFileSync(req.resultFile, png);
      return { ok: true, usage };
    },
  };
}

export type OpenAIEngine = ReturnType<typeof createOpenAIEngine>;
