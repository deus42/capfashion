import { useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert, Wand2 } from 'lucide-react';
import type { Capsule, DB, Job } from '../api.ts';
import { api, thumb, uploadFile } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, LookArt, RenderPlaceholder } from '../components/ui.tsx';
import { capsuleLooks, distinctLooks } from '../lib.ts';
import { byRating, isCapsuleHidden } from '../rating.ts';

/** A capsule is a set of looks: its tile shows up to four of them, each with its own try-on. */
export function CapsuleTile({ c }: { c: Capsule }) {
  const db = useDb();
  const looks = c.disliked ? capsuleLooks(db, c.lookIds) : distinctLooks(db, capsuleLooks(db, c.lookIds));
  const shownLooks = looks.slice(0, 4);
  return (
    <a href={`/capsules/${c.id}`} className="capsule-card">
      <div className={`cover mosaic n${Math.max(1, shownLooks.length)}`}>
        {shownLooks.length === 0 ? <RenderPlaceholder lookIds={c.lookIds} /> : shownLooks.map((l) => (
          <span key={l.id} className="cell"><LookArt look={l} w={shownLooks.length === 1 ? 900 : 480} max={shownLooks.length === 1 ? 5 : 3} /></span>
        ))}
        {c.favorite && <span className="corner-r liked-mark" aria-label="Подобається"><ThumbsUp size={14} fill="currentColor" /></span>}
        {c.disliked && <span className="corner-r liked-mark" aria-label="Не подобається"><ThumbsDown size={14} fill="currentColor" /></span>}
      </div>
      <div>
        <h3>{c.name}</h3>
        <div className="meta">{looks.length} {looks.length === 1 ? 'образ' : looks.length >= 2 && looks.length <= 4 ? 'образи' : 'образів'}</div>
      </div>
    </a>
  );
}

/** Starts photo intake: every chosen photo becomes a recognition job. */
export function useIntake() {
  const { act } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = () => input.current?.click();
  const field = (
    <input
      ref={input}
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      hidden
      onChange={async (e) => {
        const files = Array.from(e.target.files ?? []);
        if (!files.length) return;
        setBusy(true);
        await act(async () => {
          for (const f of files) await uploadFile(f, { kind: 'intake' });
        }, files.length > 1 ? `${files.length} фото в обробці — сайт сам розбереться` : 'Фото в обробці — сайт сам розбереться');
        setBusy(false);
        if (input.current) input.current.value = '';
      }}
    />
  );
  return { pick, busy, field };
}

function processing(db: DB) {
  const recent = Date.now() - 15 * 60 * 1000;
  return db.jobs
    .filter(
      (j) =>
        (j.kind === 'intake' || j.kind === 'analyze') &&
        (j.state === 'queued' || j.state === 'running' || (j.state === 'error' && !db.jobs.some((x) => x.retryOf === j.id)) || (j.kind === 'intake' && j.state === 'done' && new Date(j.finishedAt ?? 0).getTime() > recent)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
}

/** Short outcome label for a finished upload. */
function outcome(db: DB, j: Job) {
  const photo = j.inputPhotoIds?.[0] ? db.photos.find((p) => p.id === j.inputPhotoIds![0]) : undefined;
  const parts: string[] = [];
  if (photo?.kind === 'base') parts.push(photo.meetsStandard ? 'Твоє фото ✓' : 'Твоє фото');
  if (photo?.kind === 'label') parts.push('Етикетка');
  const n = j.createdItemIds?.length ?? 0;
  if (n) parts.push(`+${n} ${n === 1 ? 'річ' : n < 5 ? 'речі' : 'речей'}`);
  return parts.join(' · ') || 'Без змін';
}

function ProcCard({ j }: { j: Job }) {
  const db = useDb();
  const photo = j.inputPhotoIds?.[0] ? db.photos.find((p) => p.id === j.inputPhotoIds![0]) : undefined;
  const done = j.state === 'done';
  const href = j.kind === 'analyze' ? '/capsules?tab=selections' : photo?.kind === 'base' ? '/profile/base' : (j.createdItemIds?.[0] ?? j.attachedItemIds?.[0]) ? `/wardrobe/${j.createdItemIds?.[0] ?? j.attachedItemIds![0]}` : '/wardrobe';
  return (
    <a className="proc-card" href={href} title={j.stateNote}>
      <div className="img">
        {photo ? <img src={thumb(photo.path, 300)} alt="" /> : <Wand2 size={26} />}
        <span className="st">
          <Badge tone={j.state === 'error' ? 'bad glass' : done ? 'ok glass' : 'glass'}>
            {j.state === 'error' ? <TriangleAlert size={11} /> : done ? <Check size={11} /> : <Loader2 size={11} className={j.state === 'running' ? 'spin' : ''} />}
            {j.state === 'error' ? 'помилка' : done ? 'готово' : j.state === 'running' ? 'аналіз' : 'черга'}
          </Badge>
        </span>
      </div>
      <span className="t">{done ? (j.kind === 'intake' ? outcome(db, j) : 'Підбірка готова') : j.state === 'error' ? 'Помилка — відкрий чергу' : j.kind === 'analyze' ? 'Підбірка образів' : 'Розбираю фото…'}</span>
    </a>
  );
}

export function HomePage() {
  const db = useDb();
  const { act } = useApp();
  const [text, setText] = useState('');
  const procs = processing(db);
  const shown = db.capsules.filter((c) => !isCapsuleHidden(db, c));
  const selections = byRating(shown.filter((c) => c.kind === 'selection').reverse());
  const capsules = byRating(shown.filter((c) => c.kind !== 'selection'));
  const analyzing = db.jobs.some((j) => j.kind === 'analyze' && (j.state === 'queued' || j.state === 'running'));

  const analyze = async () => {
    const ok = await act(() => api('POST', '/api/analyze', { prompt: text }), 'Аналізатор складає образи з твоїх речей');
    if (ok) setText('');
  };

  return (
    <div className="page">
      <section className="home-hero">
        <h1>Що одягнемо сьогодні?</h1>
        <div className="prompt-box hero-prompt">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !analyzing) {
                e.preventDefault();
                void analyze();
              }
            }}
            rows={2}
            placeholder="Куди йдеш? Напр.: вихідні в місті, вечеря, офіс"
          />
          <div className="bar">
            <span className="grow" />
            <button className="btn primary" onClick={() => void analyze()} disabled={analyzing}>
              {analyzing ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {analyzing ? 'Підбираю…' : 'Підібрати'}
            </button>
          </div>
        </div>
      </section>

      {procs.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">В обробці</h2></div>
          <div className="proc">{procs.map((j) => <ProcCard key={j.id} j={j} />)}</div>
        </>
      )}

      {selections.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">Підбірки з моїх речей</h2><a href="/capsules?tab=selections">Усі <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
          <div className="capsule-grid">{selections.slice(0, 3).map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
        </>
      )}

      <div className="section-head"><h2 className="h2">Капсули</h2><a href="/capsules" onClick={() => go('/capsules')}>Усі <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
      <div className="capsule-grid">{capsules.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
    </div>
  );
}
