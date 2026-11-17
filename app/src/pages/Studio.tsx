import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Columns2, Download, Heart, ImagePlus, Loader2, Maximize2, Play, Plus, RotateCcw, Save, Sparkles, TriangleAlert, X } from 'lucide-react';
import type { DB, Job, Look, Result, ReworkReason, SlotKey, SlotRef, Slots } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, CategoryIcon, Img, KindDot, LookCollage, PhotoPicker } from '../components/ui.tsx';
import { useIntake } from './Home.tsx';
import { CATEGORY_LABEL, JOB_LABEL, REASON_LABEL, REF_KIND_LABEL, REVIEW_LABEL, REVIEW_TONE, SLOT_CATEGORIES, SLOT_LABEL, fmtDate, resolveRef, resultsForLook } from '../lib.ts';

const SLOTS = Object.keys(SLOT_LABEL) as SlotKey[];

interface CompLine {
  slot: SlotKey;
  title: string;
  kind: ReturnType<typeof resolveRef>['kind'];
}

/** Composition of exactly the version a result was rendered for. */
export function compositionFor(db: DB, result: Result | undefined, look: Look): { lines: CompLine[]; version: number } {
  if (result) {
    const job = db.jobs.find((j) => j.id === result.jobId);
    if (job?.snapshot.slots.length) {
      return { version: result.lookVersion, lines: job.snapshot.slots.map((s) => ({ slot: s.slot, title: s.title, kind: s.kind === 'item' ? (s.owned ? 'owned' : 'candidate') : s.kind })) };
    }
    const v = look.versions.find((x) => x.version === result.lookVersion);
    if (v) return { version: v.version, lines: linesFromSlots(db, v.slots) };
  }
  return { version: look.version, lines: linesFromSlots(db, look.slots) };
}

function linesFromSlots(db: DB, slots: Slots): CompLine[] {
  return SLOTS.flatMap((slot) => slots[slot].map((ref) => {
    const r = resolveRef(db, ref);
    return { slot, title: r.title, kind: r.kind };
  }));
}

export function Composition({ lines, version, title = 'Склад' }: { lines: CompLine[]; version: number; title?: string }) {
  return (
    <div className="composition">
      <h5>{title} · v{version}</h5>
      <div className="slot-list">
        {lines.length === 0 && <span className="small muted">Порожньо</span>}
        {lines.map((l, i) => (
          <div className="slot-line" key={i}>
            <span className="s">{SLOT_LABEL[l.slot]}</span>
            <KindDot kind={l.kind} />
            <span className="t" title={`${l.title} — ${REF_KIND_LABEL[l.kind]}`}>{l.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotPicker({ look, slot, anchor, onClose }: { look: Look; slot: SlotKey; anchor: DOMRect; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const t = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const cats = SLOT_CATEGORIES[slot];
  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const art = (id?: string) => (id ? db.photos.find((p) => p.id === id)?.path : undefined);
  const options: { ref: SlotRef; title: string; sub: string; photo?: string; kind: CompLine['kind'] }[] = [
    ...db.items.filter((i) => cats.includes(i.category) && i.status !== 'inactive' && !i.mergedInto && match(i.title)).map((i) => ({
      ref: { kind: 'item' as const, id: i.id },
      title: i.title,
      sub: CATEGORY_LABEL[i.category],
      photo: art(i.packshotId) ?? art(i.photoIds[0]),
      kind: (i.status === 'confirmed' ? 'owned' : 'candidate') as CompLine['kind'],
    })),
    ...db.products.filter((p) => p.status !== 'purchased' && cats.includes(db.needs.find((n) => n.id === p.needId)?.category ?? 'tees') && match(`${p.brand} ${p.model}`)).map((p) => ({
      ref: { kind: 'product' as const, id: p.id },
      title: `${p.brand} ${p.model}`,
      sub: p.store,
      photo: art(p.photoId),
      kind: 'product' as const,
    })),
    ...db.needs.filter((n) => n.status === 'open' && cats.includes(n.category) && match(n.title)).map((n) => ({
      ref: { kind: 'need' as const, id: n.id },
      title: n.title,
      sub: 'докупити',
      photo: art(n.conceptPhotoId),
      kind: 'need' as const,
    })),
  ];
  const current = look.slots[slot];
  const isOn = (r: SlotRef) => current.some((c) => c.kind === r.kind && c.id === r.id);
  const multi = slot === 'accessories';
  const apply = (next: SlotRef[]) => act(() => api('PATCH', `/api/looks/${look.id}`, { rev: look.rev, slots: { ...look.slots, [slot]: next } }));
  const toggle = (r: SlotRef) => {
    if (isOn(r)) void apply(current.filter((c) => !(c.kind === r.kind && c.id === r.id)));
    else void apply(multi ? [...current, r] : [r]);
    if (!multi) onClose();
  };
  const style = { left: Math.max(8, Math.min(anchor.left, window.innerWidth - 370)), bottom: window.innerHeight - anchor.top + 8 };
  return (
    <div className="popover" ref={ref} style={style}>
      <div className="ph">
        <input className="input sm" autoFocus placeholder={`${SLOT_LABEL[slot]}: пошук`} value={q} onChange={(e) => setQ(e.target.value)} />
        {current.length > 0 && <button className="btn sm ghost" onClick={() => void apply([]).then(onClose)}>Прибрати</button>}
      </div>
      <div className="pl">
        {options.length === 0 && <div className="small muted" style={{ padding: 12 }}>Нічого не знайдено</div>}
        {options.map((o) => (
          <button key={`${o.ref.kind}-${o.ref.id}`} className={`option${isOn(o.ref) ? ' on' : ''}`} onClick={() => toggle(o.ref)}>
            {o.photo ? <img src={thumb(o.photo, 120)} alt="" /> : <span className="ph-img"><KindDot kind={o.kind} /></span>}
            <span className="ot">
              <b>{o.title}</b>
              <span>{REF_KIND_LABEL[o.kind]} · {o.sub}</span>
            </span>
            {isOn(o.ref) && <Check size={15} />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ReviewBar({ result }: { result: Result }) {
  const { act } = useApp();
  const [mode, setMode] = useState<'idle' | 'rework'>('idle');
  const [reason, setReason] = useState<ReworkReason | null>(null);
  const [note, setNote] = useState('');
  if (result.review !== 'pending' && mode === 'idle') {
    return (
      <div className="review-bar">
        <div className="row">
          <Badge tone={REVIEW_TONE[result.review]}>{REVIEW_LABEL[result.review]}</Badge>
          {result.reviewReason && <span className="small muted">{REASON_LABEL[result.reviewReason]}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={() => void act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'pending' }))}>Змінити</button>
        </div>
      </div>
    );
  }
  if (mode === 'idle') {
    return (
      <div className="review-bar">
        <div className="row">
          <button className="btn" style={{ flex: 1 }} onClick={() => setMode('rework')}><RotateCcw size={15} /> Переробити</button>
          <button className="btn primary" style={{ flex: 1 }} onClick={() => void act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'accepted' }), 'Прийнято')}><Check size={15} /> Схоже, приймаю</button>
        </div>
      </div>
    );
  }
  return (
    <div className="review-bar">
      <div className="chips">
        {(Object.keys(REASON_LABEL) as ReworkReason[]).map((r) => (
          <button key={r} className={`chip${reason === r ? ' active' : ''}`} onClick={() => setReason(r)}>{REASON_LABEL[r]}</button>
        ))}
      </div>
      <input className="input sm" placeholder="Що не так? (необовʼязково)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn sm ghost" onClick={() => setMode('idle')}>Скасувати</button>
        <button
          className="btn sm primary"
          disabled={!reason}
          onClick={async () => {
            const ok = await act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'rework', reason, note, run: true }), 'Нова спроба запущена');
            if (ok) setMode('idle');
          }}
        >
          <Play size={13} /> Переробити
        </button>
      </div>
    </div>
  );
}

function ResultCard({ result, look, onRun, canRun }: { result: Result | undefined; look: Look; onRun?: () => void; canRun?: boolean }) {
  const db = useDb();
  const { act } = useApp();
  const intake = useIntake();
  const running = db.jobs.find((j) => j.lookId === look.id && (j.state === 'running' || j.state === 'queued'));
  if (!result) {
    return (
      <div className="studio-card plain">
        <LookCollage slots={look.slots} />
        <div className="studio-cta">
          {running ? (
            <span className="btn lg" style={{ pointerEvents: 'none' }}><Loader2 size={17} className="spin" /> {JOB_LABEL[running.state]}…</span>
          ) : canRun ? (
            <button className="btn lg primary" onClick={onRun}><Sparkles size={17} /> Приміряти на мені</button>
          ) : (
            <>
              {intake.field}
              <button className="btn lg primary" onClick={intake.pick} disabled={intake.busy}>{intake.busy ? <Loader2 size={17} className="spin" /> : <ImagePlus size={17} />} Додати своє фото</button>
            </>
          )}
        </div>
      </div>
    );
  }
  const stale = result.lookVersion !== look.version;
  return (
    <div className="studio-card">
      <img src={media(result.imagePath)} alt={look.name} />
      <div className="tl">
        <Badge tone={`${REVIEW_TONE[result.review]} glass`}>{REVIEW_LABEL[result.review]}</Badge>
        {stale && <Badge tone="warn"><TriangleAlert size={11} /> склад змінено</Badge>}
      </div>
      <div className="tr">
        <button className={`icon-btn${result.favorite ? ' on' : ''}`} aria-label="Обране" onClick={() => void act(() => api('PATCH', `/api/results/${result.id}`, { favorite: !result.favorite }))}>
          <Heart size={15} fill={result.favorite ? 'currentColor' : 'none'} />
        </button>
        <a className="icon-btn" href={media(result.imagePath)} target="_blank" rel="noreferrer" aria-label="Відкрити повністю"><Maximize2 size={14} /></a>
        <a className="icon-btn" href={media(result.imagePath)} download aria-label="Завантажити"><Download size={14} /></a>
      </div>
    </div>
  );
}

function CompareView({ left, onClose }: { left: Result; onClose: () => void }) {
  const db = useDb();
  const { act } = useApp();
  const others = db.results.filter((r) => r.id !== left.id);
  const [rightId, setRightId] = useState(others[0]?.id ?? '');
  const [note, setNote] = useState('');
  const right = db.results.find((r) => r.id === rightId);
  const col = (r: Result | undefined) => {
    if (!r) return <div className="compare-col"><div className="studio-card"><div className="studio-empty">Немає другого результату</div></div></div>;
    const look = db.looks.find((l) => l.id === r.lookId)!;
    const comp = compositionFor(db, r, look);
    return (
      <div className="compare-col">
        <ResultCard result={r} look={look} />
        <Composition lines={comp.lines} version={comp.version} title={look.name} />
      </div>
    );
  };
  return (
    <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        <button className="btn sm ghost" onClick={onClose}><X size={14} /> Закрити</button>
        <span style={{ flex: 1 }} />
        <select className="select sm" style={{ width: 'auto' }} value={rightId} onChange={(e) => setRightId(e.target.value)}>
          {others.map((r) => <option key={r.id} value={r.id}>{db.looks.find((l) => l.id === r.lookId)?.name} · {fmtDate(r.createdAt)}</option>)}
        </select>
        <input className="input sm" style={{ width: 220 }} placeholder="Нотатка" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary sm" disabled={!right} onClick={() => void act(() => api('POST', '/api/comparisons', { resultA: left.id, resultB: rightId, note, favorite: true }), 'Збережено')}>
          <Save size={13} /> Зберегти
        </button>
      </div>
      <div className="compare">{col(left)}{col(right)}</div>
    </div>
  );
}

export function StudioPage({ lookId, resultId }: { lookId?: string; resultId?: string }) {
  const db = useDb();
  const { act, toast } = useApp();
  const look = db.looks.find((l) => l.id === lookId) ?? db.looks.find((l) => l.id === 'L-urban-1') ?? db.looks[0];
  const results = useMemo(() => (look ? resultsForLook(db, look.id) : []), [db, look]);
  const retried = new Set(db.jobs.map((j) => j.retryOf).filter(Boolean));
  const jobs = db.jobs.filter((j) => j.lookId === look?.id && !j.resultId && !retried.has(j.id) && ['queued', 'running', 'needs_data', 'error'].includes(j.state));
  const [selected, setSelected] = useState<string | undefined>(resultId);
  const [baseOverride, setBaseOverride] = useState<string[] | null>(null);
  const [instructions, setInstructions] = useState('');
  const [picker, setPicker] = useState<{ slot: SlotKey; rect: DOMRect } | null>(null);
  const [basePicker, setBasePicker] = useState(false);
  const [comparing, setComparing] = useState(false);
  useEffect(() => {
    setSelected(resultId);
    setComparing(false);
  }, [look?.id, resultId]);

  if (!look) return <div className="page">Образів ще немає.</div>;
  const result = results.find((r) => r.id === selected) ?? results[0];
  const baseIds = baseOverride ?? db.profile.basePhotoIds;
  const basePhotos = baseIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as DB['photos'];
  const capsule = db.capsules.find((c) => c.id === look.capsuleId);
  const problem = jobs.find((j) => j.state === 'needs_data' || j.state === 'error');

  const queue = async (run: boolean) => {
    const job = await act(() => api<Job>('POST', '/api/jobs', { lookId: look.id, basePhotoIds: baseIds, instructions, run }));
    if (!job) return;
    if (job.state === 'needs_data') {
      toast(job.stateNote ?? 'Потрібні дані', true);
      return;
    }
    toast(run ? 'Приміряю — це займе хвилину-дві' : 'Додано в чергу');
    setInstructions('');
  };

  const saveAsNew = async () => {
    const created = await act(() => api<Look>('POST', '/api/looks', { name: `${look.name} · мій`, slots: look.slots, capsuleId: null }), 'Збережено як новий образ');
    if (created) go(`/studio?look=${created.id}`);
  };

  return (
    <div className="studio">
      {comparing && result ? (
        <CompareView left={result} onClose={() => setComparing(false)} />
      ) : (
        <div className="studio-stage">
          <div className="studio-left">
            <select className="select" value={look.id} onChange={(e) => go(`/studio?look=${e.target.value}`)} aria-label="Образ">
              {db.capsules.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.lookIds.map((lid) => {
                    const l = db.looks.find((x) => x.id === lid);
                    return l ? <option key={l.id} value={l.id}>{l.name}</option> : null;
                  })}
                </optgroup>
              ))}
              {db.looks.some((l) => !l.capsuleId) && (
                <optgroup label="Мої комбінації">
                  {db.looks.filter((l) => !l.capsuleId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </optgroup>
              )}
            </select>
            {capsule && <a className="small muted" href={`#/capsules/${capsule.id}`} style={{ paddingLeft: 4 }}>← {capsule.name}</a>}
            <div>
              <div className="label">Моє фото</div>
              <div className="input-thumbs">
                {basePhotos.map((p) => (
                  <div key={p.id} className="input-thumb" title={p.meetsStandard === false ? 'Не за стандартом' : p.originalName}>
                    <Img path={p.path} w={200} />
                    {p.meetsStandard === false && <span className="warn"><TriangleAlert size={10} /></span>}
                  </div>
                ))}
                <button className="input-thumb add" onClick={() => setBasePicker(true)} aria-label="Вибрати фото"><ImagePlus size={18} /></button>
              </div>
            </div>
          </div>

          <div className="studio-center">
            <ResultCard result={result} look={look} onRun={() => void queue(true)} canRun={basePhotos.length > 0} />
            {result && <ReviewBar result={result} />}
          </div>

          <div className="studio-right">
            {jobs.map((j) => (
              <a key={j.id} className="hist job" href="#/queue" title={`${JOB_LABEL[j.state]}: ${j.stateNote ?? ''}`}>
                {j.state === 'running' || j.state === 'queued' ? <Loader2 size={18} className={j.state === 'running' ? 'spin' : ''} /> : <TriangleAlert size={18} color={j.state === 'error' ? 'var(--bad)' : 'var(--warn)'} />}
              </a>
            ))}
            {results.map((r) => (
              <button key={r.id} className={`hist${r.id === result?.id ? ' active' : ''}`} onClick={() => setSelected(r.id)} title={`${REVIEW_LABEL[r.review]} · ${fmtDate(r.createdAt)}`}>
                <img src={thumb(r.imagePath, 200)} alt="" />
                <span className={`st ${r.review}`} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="dock">
        {problem && <div className="note warn small" style={{ maxWidth: 940, width: '100%' }}>{problem.stateNote}</div>}
        <div className="dock-tools">
          {SLOTS.map((slot) => {
            const refs = look.slots[slot].map((r) => resolveRef(db, r));
            const first = refs[0];
            return (
              <button
                key={slot}
                className={`slot-chip${picker?.slot === slot ? ' active' : ''}${refs.length ? '' : ' empty'}`}
                onClick={(e) => setPicker(picker?.slot === slot ? null : { slot, rect: e.currentTarget.getBoundingClientRect() })}
                title={refs.map((r) => r.title).join(', ') || 'Порожньо'}
              >
                <span className="sc-img">
                  {first?.art ? <img src={thumb(first.art, 120)} alt="" /> : first ? <CategoryIcon category={first.category} size={16} /> : <Plus size={15} />}
                </span>
                {SLOT_LABEL[slot]}
                {refs.length > 1 && <span className="faint">+{refs.length - 1}</span>}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <button className="chip" onClick={() => void saveAsNew()} title="Зберегти як мій образ"><Save size={14} /></button>
          {result && <button className={`chip${comparing ? ' active' : ''}`} onClick={() => setComparing((v) => !v)} title="Порівняти"><Columns2 size={14} /></button>}
        </div>
        <div className="prompt-box">
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Побажання (необовʼязково)" rows={1} />
          <div className="bar">
            <button className="btn sm ghost" onClick={() => setBasePicker(true)}><ImagePlus size={14} /> Фото · {basePhotos.length}</button>
            <span className="grow" />
            <button className="btn sm" onClick={() => void queue(false)}>В чергу</button>
            <button className="btn sm primary" onClick={() => void queue(true)}><Play size={13} /> Запустити</button>
          </div>
        </div>
      </div>

      {picker && <SlotPicker look={look} slot={picker.slot} anchor={picker.rect} onClose={() => setPicker(null)} />}
      {basePicker && (
        <PhotoPicker
          title="Моє фото для примірки"
          selected={baseIds}
          filter={(p) => p.kind === 'base' || p.kind === 'source'}
          onClose={() => setBasePicker(false)}
          onSave={(ids) => {
            setBaseOverride(ids);
            setBasePicker(false);
          }}
        />
      )}
    </div>
  );
}
