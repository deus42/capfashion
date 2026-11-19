import { useRef, useState } from 'react';
import { ArrowRight, Loader2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, uploadFile } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { JobEta, LookArt, LookCollage, Missing, RenderPlaceholder } from '../components/ui.tsx';
import { autoCapsules, capsuleLooks, capsuleRating, distinctLooks, isAutoCapsule, lookRating, openSuggestions, periodLine, rankCapsules, readyLine, scoreLabel, todayLooks, WARDROBE_CAPSULE_ID } from '../lib.ts';
import type { DB, Look } from '../api.ts';
import { isCapsuleHidden, type CapsuleView } from '../rating.ts';
import { NextPurchase } from './Shopping.tsx';

/** A tile's looks: a hidden capsule still shows its looks (never empty); the automatic ones keep their own order. */
const tileLooks = (db: DB, c: CapsuleView) => (isCapsuleHidden(db, c) || isAutoCapsule(c.id) ? capsuleLooks(db, c.lookIds) : distinctLooks(db, capsuleLooks(db, c.lookIds)));

/**
 * Covers for a row of tiles (owner, 19.11): one look that shows the capsule's style — its best scored, liked first —
 * and never a look already on an earlier tile, unless a capsule has nothing else.
 */
export function tileCovers(db: DB, list: CapsuleView[]) {
  const used = new Set<string>();
  return new Map(list.map((c) => {
    const looks = isAutoCapsule(c.id) ? tileLooks(db, c) : [...tileLooks(db, c)].sort((a, b) => (lookRating(b) ?? 0) - (lookRating(a) ?? 0) || Number(b.favorite) - Number(a.favorite));
    const fresh = looks.filter((l) => !used.has(l.id));
    const cover = (fresh.length ? fresh : looks).slice(0, 1);
    for (const l of cover) used.add(l.id);
    return [c.id, cover] as const;
  }));
}

/** A capsule is a set of looks: its tile shows up to four of them, each with its own try-on. */
export function CapsuleTile({ c, cover }: { c: CapsuleView; cover?: Look[] }) {
  const db = useDb();
  const looks = tileLooks(db, c);
  const shownLooks = cover ?? looks.slice(0, 4);
  const score = capsuleRating(db, c);
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
        {c.periods?.length ? <span className="eyebrow-sm tile-period">{periodLine(c)}</span> : null}
        <h3>{c.name}</h3>
        <div className="meta">{(c.id !== WARDROBE_CAPSULE_ID && readyLine(db, c)) || `${looks.length} ${looks.length === 1 ? 'образ' : looks.length >= 2 && looks.length <= 4 ? 'образи' : 'образів'}`}{score !== null && ` · ${scoreLabel(score)}`}</div>
      </div>
    </a>
  );
}

/** Two ready looks for today (owner, 19.11): owned pieces only, the current weather period first. */
function TodayLooks() {
  const db = useDb();
  const looks = todayLooks(db);
  if (!looks.length) return null;
  return (
    <div className="today-grid">
      {looks.map((l) => (
        <div key={l.id} className="look-card">
          <a className="cover" style={{ aspectRatio: '2 / 3' }} href={`/looks/${l.id}`}><LookArt look={l} w={800} /></a>
          <a href={`/looks/${l.id}`}><span className="eyebrow-sm best-mark">{db.capsules.find((c) => c.id === l.capsuleId)?.name}</span><h4>{l.name}</h4><Missing look={l} /></a>
        </div>
      ))}
    </div>
  );
}

/** Advisor proposals (owner, 18.11): a new look or capsule from owned items, added only on «Додати». */
function Advice() {
  const db = useDb();
  const { act } = useApp();
  const list = openSuggestions(db).slice(0, 2);
  if (!list.length) return null;
  const add = async (id: string) => {
    const r = await act(() => api<{ href: string }>('POST', `/api/suggestions/${id}/accept`), 'Додано');
    if (r?.href) go(r.href);
  };
  return (
    <>
      {list.map((s) => (
        <div key={s.id} className="next-buy advice-card">
          <span className="img"><LookCollage slots={s.looks[0].slots} max={4} /></span>
          <span className="txt">
            <span className="eyebrow">{s.kind === 'capsule' ? `Нова капсула · ${s.looks.length} ${s.looks.length < 5 ? 'образи' : 'образів'}` : 'Новий образ'}</span>
            <span className="t">{s.name}</span>
            {s.why && <span className="miss">{s.why}</span>}
            <span className="row" style={{ gap: 8 }}>
              <button className="btn sm" onClick={() => void act(() => api('POST', `/api/suggestions/${s.id}/reject`))}>Ні</button>
              <button className="btn sm primary" onClick={() => void add(s.id)}>Додати</button>
            </span>
          </span>
        </div>
      ))}
    </>
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
        }, files.length > 1 ? `Додано фото: ${files.length}` : 'Фото додано');
        setBusy(false);
        if (input.current) input.current.value = '';
      }}
    />
  );
  return { pick, busy, field };
}

export function HomePage() {
  const db = useDb();
  const { act } = useApp();
  const [text, setText] = useState('');
  const shown = db.capsules.filter((c) => !isCapsuleHidden(db, c));
  const selections = rankCapsules(db, shown.filter((c) => c.kind === 'selection').reverse());
  // Fashion capsules first (the current period leads), the automatic ones after them (owner, 19.11).
  const capsules = [...rankCapsules(db, shown.filter((c) => c.kind !== 'selection')), ...autoCapsules(db)];
  const covers = tileCovers(db, capsules);
  const analyzeJob = db.jobs.find((j) => j.kind === 'analyze' && j.state === 'running') ?? db.jobs.find((j) => j.kind === 'analyze' && j.state === 'queued');
  const analyzing = Boolean(analyzeJob);

  const analyze = async () => {
    const ok = await act(() => api('POST', '/api/analyze', { prompt: text }), 'Аналізатор складає образи з твоїх речей');
    if (ok) setText('');
  };

  return (
    <div className="page">
      <section className="home-hero">
        <h1>Що одягнемо сьогодні?</h1>
        <TodayLooks />
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
            placeholder="Уточни: вечеря, довга прогулянка, буду в приміщенні"
          />
          <div className="bar">
            <span className="grow" />
            <button className="btn primary" onClick={() => void analyze()} disabled={analyzing}>
              {analyzing ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {analyzeJob ? <>Підбираю · <JobEta job={analyzeJob} /></> : 'Підібрати'}
            </button>
          </div>
        </div>
      </section>

      <NextPurchase />
      <Advice />

      {selections.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">Підбірки з моїх речей</h2><a href="/capsules?tab=selections">Усі <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
          <div className="capsule-grid">{selections.slice(0, 3).map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
        </>
      )}

      <div className="section-head"><h2 className="h2">Капсули</h2></div>
      <div className="capsule-grid">{capsules.map((c) => <CapsuleTile key={c.id} c={c} cover={covers.get(c.id)} />)}</div>
    </div>
  );
}
