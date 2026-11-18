import { useRef, useState } from 'react';
import { ArrowRight, Loader2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, uploadFile } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { JobEta, LookArt, LookCollage, RenderPlaceholder } from '../components/ui.tsx';
import { capsuleLooks, distinctLooks, openSuggestions, rankCapsules, readyLine, wardrobeCapsule, WARDROBE_CAPSULE_ID } from '../lib.ts';
import { isCapsuleHidden, type CapsuleView } from '../rating.ts';
import { NextPurchase } from './Shopping.tsx';

/** A capsule is a set of looks: its tile shows up to four of them, each with its own try-on. */
export function CapsuleTile({ c }: { c: CapsuleView }) {
  const db = useDb();
  // A hidden capsule (👎 or all its looks hidden) still shows its looks, so its tile is never empty.
  const looks = isCapsuleHidden(db, c) ? capsuleLooks(db, c.lookIds) : distinctLooks(db, capsuleLooks(db, c.lookIds));
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
        <div className="meta">{(c.id !== WARDROBE_CAPSULE_ID && readyLine(db, c)) || `${looks.length} ${looks.length === 1 ? 'образ' : looks.length >= 2 && looks.length <= 4 ? 'образи' : 'образів'}`}</div>
      </div>
    </a>
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
  const capsules = [wardrobeCapsule(db), ...rankCapsules(db, shown.filter((c) => c.kind !== 'selection'))];
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

      <div className="section-head"><h2 className="h2">Капсули</h2><a href="/capsules">Усі <ArrowRight size={13} style={{ verticalAlign: '-2px' }} /></a></div>
      <div className="capsule-grid">{capsules.map((c) => <CapsuleTile key={c.id} c={c} />)}</div>
    </div>
  );
}
