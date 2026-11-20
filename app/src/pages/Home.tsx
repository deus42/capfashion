import { useRef, useState } from 'react';
import { ShoppingBag, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api, uploadFile } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { Composer, LookArt, Missing, RenderPlaceholder } from '../components/ui.tsx';
import { capsuleLooks, capsuleRating, distinctLooks, isAutoCapsule, lookRating, openSuggestions, periodLine, purchaseRanking, rankCapsules, readyLine, scoreLabel, WARDROBE_CAPSULE_ID } from '../lib.ts';
import type { DB, Look } from '../api.ts';
import { isCapsuleHidden, type CapsuleView } from '../rating.ts';

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
  // Only the fashion capsules, the best rated first, left to right (owner, 20.11); ties keep the current period first.
  // «З моїх речей» and «Найкращі» are filters, not capsules (20.11).
  const capsules = [...rankCapsules(db, shown.filter((c) => c.kind !== 'selection'))].sort((a, b) => (capsuleRating(db, b) ?? -1) - (capsuleRating(db, a) ?? -1));
  const covers = tileCovers(db, capsules);
  const analyzeJob = db.jobs.find((j) => j.kind === 'discover' && j.state === 'running') ?? db.jobs.find((j) => j.kind === 'discover' && j.state === 'queued');
  const analyzing = Boolean(analyzeJob);

  const analyze = async () => {
    // The same search as «Капсули → Нові» (owner, 19.11): results come there as cards «Ні / Додати».
    const ok = await act(() => api('POST', '/api/discover', { prompt: text }), 'Шукаю — нові образи зʼявляться в «Нових»');
    if (ok) setText('');
  };

  const fresh = openSuggestions(db).length;
  const next = purchaseRanking(db)[0];
  // Cap Fashion is about capsules (owner, 20.11): the question and the composer in the centre, two small chips,
  // then the capsules as tiles, the best rated first, left to right — like app.fashn.ai.
  return (
    <div className="page home">
      <section className="home-top">
        <h1 className="home-title">Що одягнемо сьогодні?</h1>
        <Composer className="home-ask" value={text} onChange={setText} onSend={() => void analyze()} busy={analyzing} label="Підібрати" placeholder="Уточни: вечеря, довга прогулянка, буду в приміщенні" />
        {(fresh > 0 || (next && next.looksIn > 0)) && (
          <div className="home-chips">
            {fresh > 0 && <a href="/capsules?tab=new" className="home-chip"><span className="chip-ic"><Sparkles size={14} /></span>Нові образи<span className="chip-n">{fresh}</span></a>}
            {next && next.looksIn > 0 && <a href={`/shopping?need=${next.need.id}`} className="home-chip"><span className="chip-ic"><ShoppingBag size={14} /></span>Наступна покупка</a>}
          </div>
        )}
      </section>
      <div className="home-caps">{capsules.map((c) => <CapsuleTile key={c.id} c={c} cover={covers.get(c.id)} />)}</div>
    </div>
  );
}
