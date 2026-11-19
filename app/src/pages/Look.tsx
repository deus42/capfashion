import { Fragment, useEffect, useState } from 'react';
import { ArrowLeftRight, ImageOff, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { DB, Job, Look, SlotKey, SlotRef } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { Badge, CategoryIcon, Empty, LookArt, Missing, Modal, RateButtons } from '../components/ui.tsx';
import type { ResolvedRef } from '../lib.ts';
import { SLOT_CATEGORIES, SLOT_LABEL, capsuleLooks, coverForLook, distinctLooks, lookRating, lookVariants, resolveRef, scoreLabel } from '../lib.ts';
import { hiddenLookIds } from '../rating.ts';
import { rendersPaused } from '../render-need.ts';
import { EditLook } from './Capsules.tsx';
import { InfoMark, TermInfo } from './Glossary.tsx';

const SLOTS: SlotKey[] = ['layer', 'top', 'bottom', 'shoes', 'accessories'];
const same = (a: SlotRef, b: SlotRef) => a.kind === b.kind && a.id === b.id;

/** Kind of accessory from its title; glasses are never suggested (owner wears none). */
const ACCESSORY_KINDS: [string, RegExp][] = [
  ['bag', /сумк|рюкзак/i],
  ['watch', /годинник/i],
  ['cap', /кепк|шапк|панам/i],
  ['glasses', /окуляр/i],
  ['belt', /ремін(?!ц)|ремен(?!ц)|пояс/i],
];
const accessoryKind = (title: string) => ACCESSORY_KINDS.find(([, re]) => re.test(title))?.[0];

/**
 * Other accessories of the same kind the owner has, offered as one-tap swaps.
 * One different piece keeps it the same look (owner rule), so the rating stays.
 */
const COLOURS = ['коричнев', 'чорн', 'бежев', 'сір', 'синь', 'синій', 'біл', 'зелен', 'олив', 'taupe', 'коньяч', 'кремов', 'молочн', 'бордов', 'червон', 'brown', 'black', 'tan'];

function accessoryOptions(db: DB, look: Look) {
  const inLook = new Set(look.slots.accessories.map((r) => `${r.kind}:${r.id}`));
  return look.slots.accessories
    .map((current) => {
      const title = resolveRef(db, current).title;
      const kind = accessoryKind(title);
      if (!kind || kind === 'glasses') return null;
      // Closest first: shared words (colour, material), then owner-confirmed.
      const stems = (t: string) => new Set(t.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 5).map((w) => w.slice(0, 6)));
      const mine = stems(title);
      const close = (t: string) => [...stems(t)].filter((w) => mine.has(w)).length;
      // A belt keeps the colour of the one it replaces (it goes with the shoes): no black belt under brown suede.
      const colours = (t: string) => COLOURS.filter((c) => t.toLowerCase().includes(c));
      const mineColours = colours(title);
      const sameColour = (t: string) => kind !== 'belt' || !mineColours.length || colours(t).some((c) => mineColours.includes(c));
      const options = db.items
        .filter((i) => i.category === 'accessories' && i.status !== 'inactive' && !i.mergedInto && !inLook.has(`item:${i.id}`) && accessoryKind(i.title) === kind && sameColour(i.title))
        .sort((a, b) => close(b.title) - close(a.title) || Number(b.status === 'confirmed') - Number(a.status === 'confirmed'))
        .slice(0, 3);
      return options.length ? { current, title, options } : null;
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

/**
 * The one screen of a look (owner, 17.11): its best picture, the owner's
 * "Це я?" check, its pieces (tap one to swap it), accessory options and the
 * other looks of the capsule. A look is its set of pieces; the rating
 * survives a new picture or a swapped piece, and a changed composition gets
 * a new try-on by itself.
 */
export function LookPage({ id }: { id: string }) {
  const db = useDb();
  const { act, toast } = useApp();
  const [editing, setEditing] = useState(false);
  const [swap, setSwap] = useState<{ slot?: SlotKey; current?: SlotRef } | null>(null);
  const [keptNow, setKeptNow] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  // The picture the owner asked for: one quiet word if it could not be made (the slider simply stops otherwise).
  const askedJob = asked ? db.jobs.find((j) => j.id === asked) : undefined;
  const askedState = askedJob?.state;
  useEffect(() => {
    if (askedState === 'error') toast(askedJob?.stateNote ?? 'Не вдалося оновити картинку', true);
    if (askedState === 'error' || askedState === 'done' || askedState === 'needs_data') setAsked(null);
  }, [askedState, askedJob?.stateNote, toast]);
  const look = db.looks.find((l) => l.id === id);
  if (!look) return <div className="page"><Empty icon={<ImageOff />} title="Образ не знайдено" /></div>;
  const capsule = db.capsules.find((c) => c.id === look.capsuleId);
  const isSelection = capsule?.kind === 'selection';
  const cover = coverForLook(db, look);
  const stale = cover && cover.lookVersion !== look.version;
  const hidden = hiddenLookIds(db).has(look.id);
  const variants = lookVariants(db, look);
  const siblings = capsule ? distinctLooks(db, capsuleLooks(db, capsule.lookIds)).filter((l) => l.id !== look.id && !variants.some((v) => v.id === l.id)) : [];
  // The owner asked for a new picture: the slider runs until it arrives (queued or being made).
  const lookJobs = db.jobs.filter((j) => (j.kind ?? 'tryon') === 'tryon' && j.lookId === look.id);
  const busy = lookJobs.some((j) => j.state === 'queued' || j.state === 'running');
  const latest = lookJobs.filter((j) => j.lookVersion === look.version).at(-1);
  const missingPhotos = latest?.state === 'needs_data' && latest.stateNote?.startsWith('Потрібні окремі фото речей:') ? latest.stateNote : undefined;
  const paused = rendersPaused(db);
  const kept = look.keptVersion === look.version;
  // After pieces change, ask once whether to update the picture (owner, 17.11): never automatic.
  const askUpdate = Boolean(stale) && !busy && !paused && !kept && keptNow !== `${look.id}:${look.version}`;
  const options = accessoryOptions(db, look);
  // The advisor's one better owned piece for this version of the look.
  const sw = look.advice?.version === look.version ? look.advice.swap : undefined;
  const active = (id?: string) => db.items.find((i) => i.id === id && i.status !== 'inactive' && !i.mergedInto);
  const swapAdvice = sw && active(sw.from) && active(sw.to) ? { from: active(sw.from)!, to: active(sw.to)! } : null;

  const update = async () => {
    // The server uses the pinned identity reference when there is one.
    const job = await act(() => api<Job>('POST', '/api/jobs', { lookId: look.id, basePhotoIds: db.profile.basePhotoIds, instructions: '', run: true }));
    if (job?.state === 'needs_data') toast(job.stateNote ?? 'Зараз не вийде', true);
    else if (job) setAsked(job.id);
  };
  const keep = () => {
    setKeptNow(`${look.id}:${look.version}`);
    void act(() => api('PATCH', `/api/looks/${look.id}`, { rev: look.rev, keptVersion: look.version }));
  };
  const swapAccessory = (current: SlotRef, id: string) =>
    act(() => api('PATCH', `/api/looks/${look.id}`, { rev: look.rev, slots: { ...look.slots, accessories: look.slots.accessories.map((r) => (same(r, current) ? { kind: 'item', id } : r)) } }));

  const pieces = SLOTS.flatMap((slot) => look.slots[slot].map((ref) => ({ slot, r: resolveRef(db, ref) })));
  const own = pieces.filter((p) => p.r.kind === 'owned' || p.r.kind === 'candidate');
  const buy = pieces.filter((p) => p.r.kind === 'need' || p.r.kind === 'product');
  // A piece opens its own page (wardrobe item or the purchase); swapping is the small icon on its picture.
  const pieceHref = (r: ResolvedRef) => r.ref.kind === 'item' ? `/wardrobe/${r.ref.id}` : `/shopping?need=${r.ref.kind === 'need' ? r.ref.id : (db.products.find((p) => p.id === r.ref.id)?.needId ?? '')}`;
  const tile = ({ slot, r }: { slot: SlotKey; r: ResolvedRef }) => (
    <a key={`${slot}-${r.ref.kind}-${r.ref.id}`} className="wtile" href={pieceHref(r)}>
      <span className="img">
        {r.art || r.photo ? <img src={thumb((r.art ?? r.photo)!, 480)} alt={r.title} loading="lazy" /> : <span className="render-ph"><CategoryIcon category={r.category} size={22} /></span>}
        {r.inactive && <span className="tl"><Badge tone="glass">неактуальна</Badge></span>}
        <button className="swap-btn" aria-label={`Замінити: ${r.title}`} title="Замінити" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSwap({ slot, current: r.ref }); }}>
          <ArrowLeftRight size={14} />
        </button>
      </span>
      <span className="nm">{r.title}<TermInfo texts={[r.title]} /></span>
    </a>
  );

  return (
    <div className="page">
      <div className="crumb">
        <a href={isSelection ? '/capsules?tab=selections' : '/capsules'}>{isSelection ? 'Підбірки' : 'Капсули'}</a>
        {capsule && <><span>›</span><a href={`/capsules/${capsule.id}`}>{capsule.name}</a></>}
      </div>
      <div className="page-head">
        <div>
          <h1>{look.name}</h1>
          {lookRating(look) !== null && <p className="item-verdict">{scoreLabel(lookRating(look)!)}{look.advice!.why && <InfoMark title={scoreLabel(lookRating(look)!)} text={look.advice!.why} />}</p>}
          {hidden && <div className="row wrap" style={{ marginTop: 12 }}><Badge>{look.disliked ? 'приховано' : capsule?.disliked ? 'капсулу приховано' : 'схожий на прихований'}</Badge></div>}
        </div>
        <div className="actions">
          <RateButtons kind="look" target={look} />
          <button className="icon-btn" aria-label="Редагувати образ" onClick={() => setEditing(true)}><Pencil size={14} /></button>
        </div>
      </div>

      <div className="look-page">
        <div className="look-hero">
          <div className="hero-pic">
            <a className="cover" href={cover ? media(cover.imagePath) : undefined} target={cover ? '_blank' : undefined} rel="noreferrer">
              <LookArt look={look} w={960} busy={busy} label />
            </a>
            {!paused && (
              <button className="refresh-btn" disabled={busy} onClick={() => void update()} aria-label="Оновити картинку" title="Оновити картинку">
                <RefreshCw size={15} />
              </button>
            )}
          </div>
          {!busy && missingPhotos && <p className="miss" role="status" style={{ marginTop: 8 }}>{missingPhotos}</p>}
          {askUpdate && (
            <div className="update-ask">
              <span>Речі змінено</span>
              <button className="btn sm" onClick={keep}>Ні</button>
              <button className="btn sm primary" onClick={() => void update()}>Оновити</button>
            </div>
          )}
          {swapAdvice && (
            <div className="update-ask">
              <span>Порада: {swapAdvice.from.title} → {swapAdvice.to.title}</span>
              <button className="btn sm" onClick={() => void act(() => api('POST', `/api/looks/${look.id}/advice`, { accept: false }))}>Ні</button>
              <button className="btn sm primary" onClick={() => void act(() => api('POST', `/api/looks/${look.id}/advice`, { accept: true }))}>Так</button>
            </div>
          )}
        </div>
        <div className="look-side">
          <div className="section-head"><h2 className="h2">Речі образу <span className="count">{own.length}</span></h2></div>
          <div className="ward-grid">
            {own.map(tile)}
            <button className="wtile add" onClick={() => setSwap({})}>
              <span className="img"><Plus size={22} /></span>
              <span className="nm">Додати річ</span>
            </button>
          </div>
          {buy.length > 0 && <>
            <div className="section-head"><h2 className="h2">Докупити <span className="count">{buy.length}</span></h2><a href="/shopping">Покупки</a></div>
            <div className="ward-grid">{buy.map(tile)}</div>
          </>}
          {options.map((o) => (
            <Fragment key={`${o.current.kind}-${o.current.id}`}>
              <div className="section-head"><h2 className="h2">Або замість «{o.title}»</h2></div>
              <div className="ward-grid">
                {o.options.map((i) => {
                  const r = resolveRef(db, { kind: 'item', id: i.id });
                  return (
                    <button key={i.id} className="wtile" onClick={() => void swapAccessory(o.current, i.id)}>
                      <span className="img">{r.art || r.photo ? <img src={thumb((r.art ?? r.photo)!, 480)} alt={i.title} loading="lazy" /> : null}</span>
                      <span className="nm">{i.title}</span>
                    </button>
                  );
                })}
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {variants.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">Варіанти <span className="count">{variants.length}</span></h2></div>
          <div className="sib-strip">
            {variants.map((l) => <SiblingCard key={l.id} look={l} />)}
          </div>
        </>
      )}
      {siblings.length > 0 && (
        <>
          <div className="section-head"><h2 className="h2">{isSelection ? 'Ще в підбірці' : 'Ще в капсулі'} <span className="count">{siblings.length}</span></h2>{capsule && <a href={`/capsules/${capsule.id}`}>{isSelection ? 'Уся підбірка' : 'Уся капсула'}</a>}</div>
          <div className="sib-strip">
            {siblings.map((l) => <SiblingCard key={l.id} look={l} />)}
          </div>
        </>
      )}
      {editing && <EditLook look={look} onClose={() => setEditing(false)} />}
      {swap && <SwapModal look={look} slot={swap.slot} current={swap.current} onClose={() => setSwap(null)} />}
    </div>
  );
}

/** Swap a piece for another of the same kind, remove it, or add a piece. The look re-renders by itself. */
function SwapModal({ look, slot, current, onClose }: { look: Look; slot?: SlotKey; current?: SlotRef; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const art = (id?: string) => (id ? db.photos.find((p) => p.id === id)?.path : undefined);
  // Adding: each piece once, under its natural place (a jumper under «Верх», a jacket under «Шар»).
  const NATURAL: Record<string, SlotKey> = { outerwear: 'layer', knitwear: 'top', shirts: 'top', tees: 'top', trousers: 'bottom', shorts: 'bottom', shoes: 'shoes', accessories: 'accessories' };
  const optionsFor = (s: SlotKey) => {
    const cats = slot ? SLOT_CATEGORIES[s] : SLOT_CATEGORIES[s].filter((c) => NATURAL[c] === s);
    const own = current?.kind === 'item' ? db.items.find((i) => i.id === current.id)?.category : current?.kind === 'need' ? db.needs.find((n) => n.id === current.id)?.category : undefined;
    return [
      ...db.items.filter((i) => cats.includes(i.category) && i.status !== 'inactive' && !i.mergedInto && accessoryKind(i.title) !== 'glasses').sort((a, b) => Number(b.category === own) - Number(a.category === own)).map((i) => ({ ref: { kind: 'item' as const, id: i.id }, title: i.title, photo: art(i.packshotId) ?? art(i.photoIds[0]) })),
      ...db.needs.filter((n) => n.status === 'open' && cats.includes(n.category)).map((n) => ({ ref: { kind: 'need' as const, id: n.id }, title: `${n.title} · докупити`, photo: art(n.conceptPhotoId) })),
    ];
  };
  const save = async (s: SlotKey, next: SlotRef[]) => {
    const ok = await act(() => api('PATCH', `/api/looks/${look.id}`, { rev: look.rev, slots: { ...look.slots, [s]: next } }));
    if (ok) onClose();
  };
  const choose = (s: SlotKey, ref: SlotRef) => {
    const list = look.slots[s];
    if (current) return save(s, list.map((r) => (same(r, current) ? ref : r)).filter((r, i, a) => a.findIndex((x) => same(x, r)) === i));
    if (list.some((r) => same(r, ref))) return onClose();
    return save(s, [...list, ref]);
  };
  const slots = slot ? [slot] : SLOTS;
  return (
    <Modal
      title={current ? <a href={current.kind === 'item' ? `/wardrobe/${current.id}` : `/shopping?need=${current.kind === 'need' ? current.id : (db.products.find((p) => p.id === current.id)?.needId ?? '')}`} onClick={onClose}>{resolveRef(db, current).title}</a> : 'Додати річ'}
      onClose={onClose}
      wide
    >
      {current && slot && (
        <button className="btn sm ghost danger" style={{ marginBottom: 14 }} onClick={() => void save(slot, look.slots[slot].filter((r) => !same(r, current)))}>
          <Trash2 size={13} /> Прибрати з образу
        </button>
      )}
      {slots.map((s) => (
        <div key={s} style={{ marginBottom: 18 }}>
          {!slot && <div className="section-head" style={{ marginTop: 0 }}><h2 className="h2">{SLOT_LABEL[s]}</h2></div>}
          <div className="own-picks">
            {optionsFor(s).map((o) => (
              <button key={`${o.ref.kind}-${o.ref.id}`} className={`own-pick${look.slots[s].some((r) => same(r, o.ref)) ? ' on' : ''}`} onClick={() => void choose(s, o.ref)}>
                <span className="img">{o.photo ? <img src={thumb(o.photo, 320)} alt={o.title} loading="lazy" /> : null}</span>
                <span>{o.title}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}

function SiblingCard({ look }: { look: Look }) {
  return (
    <a className="sib" href={`/looks/${look.id}`}>
      <span className="img"><LookArt look={look} w={480} /></span>
      <span className="nm">{look.favorite && <b className="liked-dot" aria-label="Подобається" />}{look.name}</span>
      <Missing look={look} />
    </a>
  );
}
