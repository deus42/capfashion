import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, Check, CircleCheck, Heart, Loader2, Plus, Ruler, Store, Tag, Trash2, TriangleAlert, X } from 'lucide-react';
import type { Category, KnownSize, MeasureKey } from '../api.ts';
import { api, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, PageHead, PhotoPicker, SubNav } from '../components/ui.tsx';
import { useIntake } from './Home.tsx';
import { InfoMark } from './Glossary.tsx';
import { CATEGORY_LABEL, MEASURES, fmtDay, shopLocation, wardrobeBrands } from '../lib.ts';

const STANDARD = [
  '2–3 фото на повний зріст спереду',
  'Камера на рівні грудей — не дзеркальне селфі',
  'Без окулярів, кепки й предметів перед тілом',
  'Рівне світло, однотонний фон',
  'Плюс одне крупне фото обличчя спереду',
];

const TABS = [
  { key: 'base', label: 'Базові фото', icon: <Camera size={17} /> },
  { key: 'measurements', label: 'Мірки', icon: <Ruler size={17} /> },
  { key: 'sizes', label: 'Розміри брендів', icon: <Tag size={17} /> },
  { key: 'shops', label: 'Магазини', icon: <Store size={17} /> },
  { key: 'preferences', label: 'Побажання', icon: <Heart size={17} /> },
];

function Section({ title, sub, actions, children }: { title?: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  const head = title || sub || actions;
  return (
    <section className="card lg">
      {head && (
        <div className="row" style={{ alignItems: 'flex-start', marginBottom: 22, gap: 16 }}>
          <div style={{ flex: 1 }}>
            {title && <h2 className="display" style={{ fontSize: 28 }}>{title}</h2>}
            {sub && <p className="muted" style={{ marginTop: 6, maxWidth: 560 }}>{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

function BasePhotos() {
  const db = useDb();
  const { act } = useApp();
  const prof = db.profile;
  const [picker, setPicker] = useState(false);
  const intake = useIntake();
  const busy = db.jobs.filter((j) => j.kind === 'intake' && (j.state === 'queued' || j.state === 'running')).length;
  const originals = (prof.identity ? [prof.identity.sourcePhotoId] : prof.basePhotoIds).map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as typeof db.photos;
  const base = prof.identity?.approvedPortrait ? originals.map((p) => ({ ...p, path: prof.identity!.face.path, originalName: 'Схвалений портрет' })) : originals;
  const ok = base.filter((p) => p.meetsStandard).length;
  return (
    <Section
      title="Базові фото"
      sub={prof.identity?.disabledReason ?? (prof.identity ? `${base[0]?.originalName ?? 'Оригінал'} — опора обличчя. ${prof.identity.preserveHeadAngle ? 'Оригінальний ракурс.' : 'Прямий погляд, голова рівно.'} ${prof.identity.noGlasses ? 'Без окулярів.' : ''} ${prof.identity.hairstyle ?? ''}` : 'Обличчя для примірок береться лише з цих фото.')}
      actions={!prof.identity && <button className="btn" onClick={() => setPicker(true)}>Вибрати з наявних</button>}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 24 }} className="profile-base">
        <div className="stack" style={{ gap: 18 }}>
          {intake.field}
          <a className="btn" href="/gallery?type=original">Усі мої оригінали й референси</a>
          <a className="btn" href="/gallery?type=face">Референси обличчя · {db.photos.filter((p) => p.referenceRole === 'face').length}</a>
          <button className="dropzone" onClick={intake.pick} disabled={intake.busy} style={{ cursor: 'pointer', width: '100%' }}>
            {intake.busy || busy ? <Loader2 size={22} className="spin" style={{ margin: '0 auto' }} /> : <Camera size={22} style={{ margin: '0 auto' }} />}
            <b>{busy ? `Розбираю фото: ${busy}` : 'Додати фото'}</b>
            Сайт сам визначить: твоє фото для примірок, одяг чи етикетка.
          </button>
          {base.length > 0 && (
            <div className="photo-grid">
              {base.map((p) => (
                <div key={p.id} className="ptile">
                  <div className="img">
                    <img src={thumb(p.path, 480)} alt="" />
                    <span className="tl">
                      <Badge tone={`${p.meetsStandard ? 'ok' : p.meetsStandard === false ? 'warn' : ''} glass`}>
                        {p.meetsStandard ? 'за стандартом' : p.meetsStandard === false ? 'не за стандартом' : 'не перевірено'}
                      </Badge>
                    </span>
                    {!prof.identity && <span className="tr">
                      <button className="icon-btn" aria-label="Прибрати з базових" onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, basePhotoIds: prof.basePhotoIds.filter((x) => x !== p.id) }), 'Прибрано')}>
                        <X size={14} />
                      </button>
                    </span>}
                  </div>
                  <button className={`btn sm${p.meetsStandard ? ' primary' : ''}`} onClick={() => void act(() => api('PATCH', `/api/photos/${p.id}`, { meetsStandard: !p.meetsStandard }))}>
                    {p.meetsStandard ? <Check size={13} /> : <TriangleAlert size={13} />} {p.meetsStandard ? 'Відповідає' : 'Позначити як відповідне'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="note" style={{ padding: 18, alignSelf: 'start' }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <b>Стандарт фото</b>
            <span style={{ flex: 1 }} />
            <Badge tone={ok >= 2 ? 'ok' : 'warn'}>{ok}/2 готово</Badge>
          </div>
          <ul className="checklist">
            {STANDARD.map((s) => <li key={s}><CircleCheck size={15} />{s}</li>)}
          </ul>
        </div>
      </div>
      {picker && (
        <PhotoPicker
          title="Базові фото з наявних"
          selected={prof.basePhotoIds}
          filter={(p) => p.kind === 'base' || p.kind === 'source'}
          onClose={() => setPicker(false)}
          onSave={(ids) => {
            setPicker(false);
            void act(() => api('PATCH', '/api/profile', { rev: prof.rev, basePhotoIds: ids }), 'Базові фото оновлено');
          }}
        />
      )}
    </Section>
  );
}

function Measurements() {
  const db = useDb();
  const { act } = useApp();
  const prof = db.profile;
  const load = () => Object.fromEntries(MEASURES.map((m) => [m.key, prof.measurements[m.key].value?.toString() ?? ''])) as Record<MeasureKey, string>;
  const [values, setValues] = useState(load);
  useEffect(() => setValues(load()), [prof.rev]);
  return (
    <Section
      actions={<button className="btn primary" onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, measurements: Object.fromEntries(MEASURES.map((m) => [m.key, { value: values[m.key] }])) }), 'Мірки збережено')}>Зберегти мірки</button>}
    >
      <div className="measure-grid">
        {MEASURES.map((m) => {
          const saved = prof.measurements[m.key];
          return (
            <label key={m.key} className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>
                <span>{m.label}<InfoMark title={m.label} text={m.how} /></span>
                {saved.value !== null && <span className="small faint" style={{ fontWeight: 400 }}>{fmtDay(saved.date)}</span>}
              </span>
              <div style={{ position: 'relative' }}>
                <input className="input" inputMode="decimal" value={values[m.key]} onChange={(e) => setValues((x) => ({ ...x, [m.key]: e.target.value.replace(',', '.') }))} placeholder="—" style={{ paddingRight: 44 }} />
                <span className="faint small" style={{ position: 'absolute', right: 14, top: 13 }}>см</span>
              </div>
            </label>
          );
        })}
      </div>
    </Section>
  );
}

function Sizes() {
  const db = useDb();
  const { act } = useApp();
  const prof = db.profile;
  const [sizes, setSizes] = useState<KnownSize[]>(prof.knownSizes);
  useEffect(() => setSizes(prof.knownSizes), [prof.rev]);
  const upd = (i: number, patch: Partial<KnownSize>) => setSizes((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const add = () => setSizes((s) => [...s, { id: '', brand: '', category: 'trousers', size: '' }]);
  return (
    <Section
      actions={
        sizes.length > 0 || prof.knownSizes.length > 0 ? (
          <>
            <button className="btn" onClick={add}><Plus size={15} /> Додати</button>
            <button className="btn primary" disabled={sizes.some((s) => !s.brand.trim() || !s.size.trim())} onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, knownSizes: sizes }), 'Розміри збережено')}>Зберегти</button>
          </>
        ) : undefined
      }
    >
      {sizes.length === 0 ? (
        <button className="dropzone" style={{ padding: 26, width: '100%' }} onClick={add}>
          <Plus size={20} style={{ margin: '0 auto' }} />
          <b>Додати розмір</b>
        </button>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {sizes.map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr 1.6fr auto', gap: 10 }} className="size-row">
              <input className="input" placeholder="Бренд" value={s.brand} onChange={(e) => upd(i, { brand: e.target.value })} />
              <select className="select" value={s.category} onChange={(e) => upd(i, { category: e.target.value as Category })}>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <input className="input" placeholder="Розмір" value={s.size} onChange={(e) => upd(i, { size: e.target.value })} />
              <input className="input" placeholder="Примітка (модель, як сидить)" value={s.note ?? ''} onChange={(e) => upd(i, { note: e.target.value })} />
              <button className="btn ghost" aria-label="Видалити" onClick={() => setSizes((l) => l.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/** A short list the owner edits: × removes, typing + Enter adds. */
function ChipsField({ label, values: saved, placeholder, onSave }: { label: string; values: string[]; placeholder: string; onSave: (next: string[]) => void }) {
  const [text, setText] = useState('');
  // The list changes at once; quick taps never wait for (or fight) the server.
  const [values, setValues] = useState(saved);
  const savedKey = saved.join('\n');
  useEffect(() => setValues(saved), [savedKey]);
  const change = (next: string[]) => {
    setValues(next);
    onSave(next);
  };
  const add = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) change([...values, v]);
  };
  return (
    <div className="field">
      <span>{label}</span>
      <div className="chips">
        {values.map((v) => (
          <span key={v} className="chip brand">
            {v}
            <button aria-label={`Прибрати ${v}`} onClick={() => change(values.filter((x) => x !== v))}><X size={12} /></button>
          </span>
        ))}
        <form className="brand-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input className="input sm" value={text} onChange={(e) => setText(e.target.value)} onBlur={add} placeholder={placeholder} aria-label={placeholder} />
        </form>
      </div>
    </div>
  );
}

/** «Магазини» (owner, 18.11): where «Знайти» searches — the place, my stores, my brands. */
function Shops() {
  const db = useDb();
  const { act } = useApp();
  const prof = db.profile;
  const [place, setPlace] = useState(shopLocation(db));
  useEffect(() => setPlace(shopLocation(db)), [prof.rev]);
  // No rev: each field saves only itself, so quick changes in a row never conflict.
  const save = (patch: Record<string, unknown>) => void act(() => api('PATCH', '/api/profile', patch));
  return (
    <Section>
      <div className="stack" style={{ gap: 22 }}>
        <label className="field">
          <span>Де шукати</span>
          <input
            className="input"
            value={place}
            placeholder="Лише онлайн"
            onChange={(e) => setPlace(e.target.value)}
            onBlur={() => { if (place.trim() !== shopLocation(db)) save({ location: place.trim() }); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </label>
        <ChipsField label="Мої магазини" values={prof.stores ?? []} placeholder="+ магазин" onSave={(stores) => save({ stores })} />
        <ChipsField label="Мої бренди" values={prof.brands ?? wardrobeBrands(db)} placeholder="+ бренд" onSave={(brands) => save({ brands })} />
      </div>
    </Section>
  );
}

function Preferences() {
  const db = useDb();
  const { act } = useApp();
  const prof = db.profile;
  const [prefs, setPrefs] = useState(prof.preferences);
  useEffect(() => setPrefs(prof.preferences), [prof.rev]);
  const fields = [
    ['comfort', 'Комфорт', 'Як має відчуватися одяг протягом дня.'],
    ['materials', 'Матеріали', 'Тканини, яким віддаєш перевагу або яких уникаєш.'],
    ['fit', 'Посадка', 'Крій штанів, сорочок, верхнього одягу; довжина.'],
    ['branding', 'Брендування', 'Наскільки помітними можуть бути логотипи.'],
  ] as const;
  return (
    <Section actions={<button className="btn primary" onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, preferences: prefs }), 'Побажання збережено')}>Зберегти</button>}>
      <div className="grid-form">
        {fields.map(([k, label]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <textarea className="textarea" value={prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.value }))} />
          </label>
        ))}
      </div>
    </Section>
  );
}

export function ProfilePage({ tab }: { tab?: string }) {
  const current = TABS.some((t) => t.key === tab) ? tab! : 'base';
  return (
    <div className="page">
      <PageHead title="Мій профіль" />
      <div className="split">
        <SubNav value={current} onChange={(k) => go(`/profile/${k}`)} groups={[{ items: TABS }]} />
        <div>
          {current === 'base' && <BasePhotos />}
          {current === 'measurements' && <Measurements />}
          {current === 'sizes' && <Sizes />}
          {current === 'shops' && <Shops />}
          {current === 'preferences' && <Preferences />}
        </div>
      </div>
    </div>
  );
}
