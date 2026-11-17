import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Check, Columns2, Download, Heart, History, ImagePlus, Loader2, Maximize2, Play, Plus, RotateCcw, Save, Sparkles, TriangleAlert, X,
} from 'lucide-react';
import type { DB, Job, Look, Result, ReworkReason, SlotKey, SlotRef, Slots } from '../api.ts';
import { api, media, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, Img, KindDot, LookCollage, PhotoPicker } from '../components/ui.tsx';
import {
  CATEGORY_LABEL, JOB_LABEL, REASON_LABEL, REF_KIND_LABEL, REVIEW_LABEL, REVIEW_TONE, SLOT_CATEGORIES, SLOT_LABEL, fmtDate, resolveRef, resultsForLook,
} from '../lib.ts';

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
      <h5>
        {title} · v{version}
      </h5>
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
  const options: { ref: SlotRef; title: string; sub: string; photo?: string; kind: CompLine['kind'] }[] = [
    ...db.items.filter((i) => cats.includes(i.category) && i.status !== 'inactive' && match(i.title)).map((i) => ({
      ref: { kind: 'item' as const, id: i.id },
      title: i.title,
      sub: `${i.id} · ${CATEGORY_LABEL[i.category]}`,
      photo: db.photos.find((p) => p.id === i.photoIds[0])?.path,
      kind: (i.status === 'confirmed' ? 'owned' : 'candidate') as CompLine['kind'],
    })),
    ...db.products.filter((p) => p.status !== 'purchased' && cats.includes(db.needs.find((n) => n.id === p.needId)?.category ?? 'tees') && match(`${p.brand} ${p.model}`)).map((p) => ({
      ref: { kind: 'product' as const, id: p.id },
      title: `${p.brand} ${p.model}`,
      sub: `${p.store}${p.price ? ` · ${p.price} ${p.currency ?? ''}` : ''}`,
      photo: p.photoId ? db.photos.find((x) => x.id === p.photoId)?.path : undefined,
      kind: 'product' as const,
    })),
    ...db.needs.filter((n) => n.status === 'open' && cats.includes(n.category) && match(n.title)).map((n) => ({
      ref: { kind: 'need' as const, id: n.id },
      title: n.title,
      sub: `Бажаний тип · ${n.priority === 'core' ? 'основна потреба' : 'опційно'}`,
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
  const style = { left: Math.min(anchor.left, window.innerWidth - 350), bottom: window.innerHeight - anchor.top + 8 };
  return (
    <div className="popover" ref={ref} style={style}>
      <div className="ph">
        <b style={{ flex: 1 }}>{SLOT_LABEL[slot]}</b>
        {current.length > 0 && (
          <button className="btn sm ghost" onClick={() => void apply([]).then(onClose)}>
            Прибрати
          </button>
        )}
      </div>
      <div className="ph" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <input className="input" autoFocus placeholder="Пошук речі чи потреби" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="pl">
        {options.length === 0 && <div className="small muted" style={{ padding: 10 }}>Нічого не знайдено.</div>}
        {options.map((o) => (
          <button key={`${o.ref.kind}-${o.ref.id}`} className={`option${isOn(o.ref) ? ' on' : ''}`} onClick={() => toggle(o.ref)}>
            {o.photo ? <img src={thumb(o.photo, 120)} alt="" /> : <span className="ph-img"><KindDot kind={o.kind} /></span>}
            <span className="ot">
              <b>{o.title}</b>
              <span>
                {REF_KIND_LABEL[o.kind]} · {o.sub}
              </span>
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
          {result.reviewReason && <span className="small">{REASON_LABEL[result.reviewReason]}</span>}
          {result.reviewNote && <span className="small muted">— {result.reviewNote}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn sm ghost" onClick={() => void act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'pending' }))}>
            Змінити рішення
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="review-bar">
      {mode === 'idle' ? (
        <div className="row wrap">
          <span className="small" style={{ flex: 1, minWidth: 160 }}>
            <b>Перевір:</b> обличчя, пропорції, річ, фон. Схожість приймаєш тільки ти.
          </span>
          <button className="btn sm" onClick={() => setMode('rework')}>
            <RotateCcw size={13} /> Переробити
          </button>
          <button className="btn sm primary" onClick={() => void act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'accepted' }), 'Прийнято')}>
            <Check size={13} /> Прийняти
          </button>
        </div>
      ) : (
        <>
          <div className="chips">
            {(Object.keys(REASON_LABEL) as ReworkReason[]).map((r) => (
              <button key={r} className={`chip${reason === r ? ' active' : ''}`} style={{ height: 28 }} onClick={() => setReason(r)}>
                {REASON_LABEL[r]}
              </button>
            ))}
          </div>
          <input className="input" placeholder="Що саме не так? (необовʼязково)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn sm ghost" onClick={() => setMode('idle')}>Скасувати</button>
            <button
              className="btn sm"
              disabled={!reason}
              onClick={async () => {
                const ok = await act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'rework', reason, note }), 'Позначено «Переробити», нова спроба в черзі');
                if (ok) setMode('idle');
              }}
            >
              У чергу
            </button>
            <button
              className="btn sm primary"
              disabled={!reason}
              onClick={async () => {
                const ok = await act(() => api('POST', `/api/results/${result.id}/review`, { decision: 'rework', reason, note, run: true }), 'Нова спроба запущена');
                if (ok) setMode('idle');
              }}
            >
              <Play size={13} /> Переробити зараз
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ResultCard({ result, look }: { result: Result | undefined; look: Look }) {
  const db = useDb();
  const { act } = useApp();
  const running = db.jobs.find((j) => j.lookId === look.id && (j.state === 'running' || j.state === 'queued'));
  if (!result) {
    return (
      <div className="studio-card">
        <LookCollage slots={look.slots} />
        <div className="studio-empty">
          {running ? <Loader2 size={26} className="spin" /> : <Sparkles size={26} />}
          <b>{running ? JOB_LABEL[running.state] : 'Примірка ще не створена'}</b>
          <span className="small">{running ? running.stateNote ?? 'Codex генерує зображення…' : 'Перевір склад унизу й натисни «Запустити». Генерація йде через локальний Codex без чату.'}</span>
        </div>
      </div>
    );
  }
  const stale = result.lookVersion !== look.version;
  return (
    <div className="studio-card">
      <img src={media(result.imagePath)} alt={look.name} />
      <div className="tl">
        <Badge tone={REVIEW_TONE[result.review]}>{REVIEW_LABEL[result.review]}</Badge>
        <Badge>v{result.lookVersion}</Badge>
        {stale && (
          <Badge tone="warn">
            <TriangleAlert size={11} /> склад уже змінено (зараз v{look.version})
          </Badge>
        )}
        {!result.usedItemPhotos && <Badge tone="info">концепт за описом</Badge>}
      </div>
      <div className="tr">
        <button className={`icon-btn${result.favorite ? ' on' : ''}`} aria-label="Обране" onClick={() => void act(() => api('PATCH', `/api/results/${result.id}`, { favorite: !result.favorite }))}>
          <Heart size={15} fill={result.favorite ? 'currentColor' : 'none'} />
        </button>
        <a className="icon-btn" href={media(result.imagePath)} target="_blank" rel="noreferrer" aria-label="Відкрити повністю">
          <Maximize2 size={14} />
        </a>
        <a className="icon-btn" href={media(result.imagePath)} download aria-label="Завантажити">
          <Download size={14} />
        </a>
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
  const col = (r: Result | undefined, label: string) => {
    if (!r) return <div className="compare-col"><div className="studio-card"><div className="studio-empty">Немає другого результату для порівняння</div></div></div>;
    const look = db.looks.find((l) => l.id === r.lookId)!;
    const comp = compositionFor(db, r, look);
    return (
      <div className="compare-col">
        <div className="row small muted">
          <b style={{ color: 'var(--ink)' }}>{label}</b> {look.name} · {fmtDate(r.createdAt)}
        </div>
        <ResultCard result={r} look={look} />
        <Composition lines={comp.lines} version={comp.version} title="Склад цієї версії" />
      </div>
    );
  };
  return (
    <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <button className="btn sm ghost" onClick={onClose}>
          <X size={14} /> Закрити порівняння
        </button>
        <span style={{ flex: 1 }} />
        <select className="select" style={{ width: 'auto' }} value={rightId} onChange={(e) => setRightId(e.target.value)}>
          {others.map((r) => (
            <option key={r.id} value={r.id}>
              {db.looks.find((l) => l.id === r.lookId)?.name} · v{r.lookVersion} · {fmtDate(r.createdAt)}
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 260 }} placeholder="Нотатка до порівняння" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn primary sm" disabled={!right} onClick={() => void act(() => api('POST', '/api/comparisons', { resultA: left.id, resultB: rightId, note, favorite: true }), 'Порівняння збережено в обране')}>
          <Save size={13} /> Зберегти
        </button>
      </div>
      <div className="compare">
        {col(left, 'A')}
        {col(right, 'B')}
      </div>
      {db.comparisons.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="section-title">Збережені порівняння</div>
          <div className="chips">
            {db.comparisons.map((c) => (
              <button key={c.id} className="chip" onClick={() => setRightId(c.resultA === left.id ? c.resultB : c.resultA)} title={c.note}>
                {c.favorite && <Heart size={12} fill="currentColor" />} {fmtDate(c.createdAt)} {c.note ? `· ${c.note}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function StudioPage({ lookId, resultId }: { lookId?: string; resultId?: string }) {
  const db = useDb();
  const { act, state, toast } = useApp();
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
  const comp = compositionFor(db, result, look);
  const baseIds = baseOverride ?? db.profile.basePhotoIds;
  const basePhotos = baseIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as DB['photos'];
  const capsule = db.capsules.find((c) => c.id === look.capsuleId);
  const lastProblem = jobs.find((j) => j.state === 'needs_data' || j.state === 'error');

  const queue = async (run: boolean) => {
    const job = await act(() => api<Job>('POST', '/api/jobs', { lookId: look.id, basePhotoIds: baseIds, instructions, run }));
    if (!job) return;
    if (job.state === 'needs_data') {
      toast(`Потрібні дані: ${job.stateNote ?? ''}`, true);
      return;
    }
    toast(run ? 'Запущено — Codex генерує' : 'Додано в чергу примірок');
    setInstructions('');
  };

  const saveAsNew = async () => {
    const created = await act(() => api<Look>('POST', '/api/looks', { name: `${look.name} — мій варіант`, slots: look.slots, capsuleId: null }), 'Збережено як новий образ');
    if (created) go(`/studio?look=${created.id}`);
  };

  return (
    <div className="studio">
      {comparing && result ? (
        <CompareView left={result} onClose={() => setComparing(false)} />
      ) : (
        <div className="studio-stage">
          <div className="studio-left">
            <button className="btn ghost sm" onClick={() => go(capsule ? `/capsules/${capsule.id}` : '/capsules')}>
              <ArrowLeft size={14} /> {capsule ? capsule.name : 'Капсули'}
            </button>
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
                  {db.looks.filter((l) => !l.capsuleId).map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <div>
              <div className="label">Базові фото</div>
              <div className="input-thumbs">
                {basePhotos.map((p) => (
                  <div key={p.id} className="input-thumb" title={p.meetsStandard === false ? 'Не відповідає стандарту базового фото' : p.originalName}>
                    <Img path={p.path} w={200} />
                    {p.meetsStandard === false && <span className="warn"><TriangleAlert size={10} /></span>}
                  </div>
                ))}
                <button className="input-thumb add" onClick={() => setBasePicker(true)} aria-label="Вибрати базові фото">
                  <ImagePlus size={18} />
                </button>
              </div>
              {basePhotos.length === 0 && <p className="small muted" style={{ textAlign: 'center', marginTop: 6 }}>Додай фото в Профілі</p>}
            </div>
            <Composition lines={comp.lines} version={comp.version} title={result ? 'Склад цього рендера' : 'Склад образу'} />
          </div>

          <div className="studio-center">
            <ResultCard result={result} look={look} />
            {result && <ReviewBar result={result} />}
          </div>

          <div className="studio-right">
            <div className="label">
              Історія <History size={13} />
            </div>
            {jobs.map((j) => (
              <a key={j.id} className="hist job" href="#/queue" title={`${JOB_LABEL[j.state]}: ${j.stateNote ?? ''}`}>
                {j.state === 'running' || j.state === 'queued' ? <Loader2 size={18} className={j.state === 'running' ? 'spin' : ''} /> : <TriangleAlert size={18} color={j.state === 'error' ? 'var(--bad)' : 'var(--warn)'} />}
              </a>
            ))}
            {results.map((r) => (
              <button key={r.id} className={`hist${r.id === result?.id ? ' active' : ''}`} onClick={() => setSelected(r.id)} title={`${REVIEW_LABEL[r.review]} · ${fmtDate(r.createdAt)}`}>
                <img src={thumb(r.imagePath, 200)} alt="" />
                <span className="v">v{r.lookVersion}</span>
                <span className={`st ${r.review}`} />
              </button>
            ))}
            {results.length === 0 && jobs.length === 0 && <span className="small faint">Порожньо</span>}
          </div>
        </div>
      )}

      <div className="dock">
        {lastProblem && (
          <div className="note warn small" style={{ maxWidth: 920, width: '100%' }}>
            <b>{JOB_LABEL[lastProblem.state]}:</b> {lastProblem.stateNote} <a href="#/queue" style={{ textDecoration: 'underline' }}>Черга</a>
          </div>
        )}
        <div className="dock-tools">
          {SLOTS.map((slot) => {
            const refs = look.slots[slot];
            const label = refs.map((r) => resolveRef(db, r).title).join(', ');
            return (
              <button
                key={slot}
                className={`chip${picker?.slot === slot ? ' active' : ''}`}
                onClick={(e) => setPicker(picker?.slot === slot ? null : { slot, rect: e.currentTarget.getBoundingClientRect() })}
                title={label || 'Порожньо'}
              >
                <span className="k">{SLOT_LABEL[slot]}</span>
                <span style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label || '—'}</span>
              </button>
            );
          })}
          <button className="chip" onClick={() => void saveAsNew()} title="Зберегти поточну комбінацію окремим образом">
            <Plus size={14} /> Новий образ
          </button>
          {result && (
            <button className={`chip${comparing ? ' active' : ''}`} onClick={() => setComparing((v) => !v)}>
              <Columns2 size={14} /> Порівняти
            </button>
          )}
        </div>
        <div className="prompt-box">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Що врахувати в цій примірці? Напр.: сорочку навипуск, рукави закочені"
            rows={2}
          />
          <div className="bar">
            <button className="btn sm" onClick={() => setBasePicker(true)}>
              <ImagePlus size={13} /> Базові фото · {basePhotos.length}
            </button>
            <span className="tag" title={state?.runner.codexBin ?? ''}>
              {db.settings.codexModel} · {db.settings.reasoningEffort}
            </span>
            <span className="grow" />
            <button className="btn sm" onClick={() => void queue(false)}>
              Додати в чергу примірок
            </button>
            <button className="btn sm primary" onClick={() => void queue(true)}>
              <Play size={13} /> Запустити
            </button>
          </div>
        </div>
      </div>

      {picker && <SlotPicker look={look} slot={picker.slot} anchor={picker.rect} onClose={() => setPicker(null)} />}
      {basePicker && (
        <PhotoPicker
          title="Базові фото для цієї примірки"
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
