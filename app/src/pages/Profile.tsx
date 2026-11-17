import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Camera, Check, CircleCheck, Heart, KeyRound, Loader2, Plus, Ruler, Tag, Trash2, TriangleAlert, X } from 'lucide-react';
import type { Category, KnownSize, MeasureKey } from '../api.ts';
import { api, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, PageHead, PhotoPicker, SubNav } from '../components/ui.tsx';
import { useIntake } from './Home.tsx';
import { CATEGORY_LABEL, MEASURES, fmtDay } from '../lib.ts';

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
  { key: 'preferences', label: 'Побажання', icon: <Heart size={17} /> },
  { key: 'access', label: 'Генерація і доступ', icon: <KeyRound size={17} /> },
];

function Section({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card lg">
      <div className="row" style={{ alignItems: 'flex-start', marginBottom: 22, gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h2 className="display" style={{ fontSize: 28 }}>{title}</h2>
          {sub && <p className="muted" style={{ marginTop: 6, maxWidth: 560 }}>{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
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
  const base = (prof.identity ? [prof.identity.sourcePhotoId] : prof.basePhotoIds).map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as typeof db.photos;
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
          <a className="btn" href="#/gallery?type=original">Усі мої оригінали й референси</a>
          <a className="btn" href="#/gallery?type=face">Референси обличчя · {db.photos.filter((p) => p.referenceRole === 'face').length}</a>
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
      title="Мірки"
      actions={<button className="btn primary" onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, measurements: Object.fromEntries(MEASURES.map((m) => [m.key, { value: values[m.key] }])) }), 'Мірки збережено')}>Зберегти мірки</button>}
    >
      <div className="measure-grid">
        {MEASURES.map((m) => {
          const saved = prof.measurements[m.key];
          return (
            <label key={m.key} className="field">
              <span className="row" style={{ justifyContent: 'space-between' }}>
                {m.label}
                <span className="small faint" style={{ fontWeight: 400 }}>{saved.value === null ? 'ще не заповнено' : fmtDay(saved.date)}</span>
              </span>
              <div style={{ position: 'relative' }}>
                <input className="input" inputMode="decimal" value={values[m.key]} onChange={(e) => setValues((x) => ({ ...x, [m.key]: e.target.value }))} placeholder="—" style={{ paddingRight: 44 }} />
                <span className="faint small" style={{ position: 'absolute', right: 14, top: 13 }}>см</span>
              </div>
              <span className="hint">{m.how}</span>
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
  return (
    <Section
      title="Розміри брендів"
      actions={
        <>
          <button className="btn" onClick={() => setSizes((s) => [...s, { id: '', brand: '', category: 'trousers', size: '' }])}><Plus size={15} /> Додати</button>
          <button className="btn primary" onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, knownSizes: sizes }), 'Розміри збережено')}>Зберегти</button>
        </>
      }
    >
      {sizes.length === 0 ? (
        <div className="dropzone" style={{ padding: 26 }}>
          <Tag size={20} style={{ margin: '0 auto' }} />
          <b>Ще немає жодного розміру</b>
          Додай, наприклад, «Levi's · Штани · W32 L32» або «Adidas · Взуття · EU 43».
        </div>
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
    <Section title="Побажання" actions={<button className="btn primary" onClick={() => void act(() => api('PATCH', '/api/profile', { rev: prof.rev, preferences: prefs }), 'Побажання збережено')}>Зберегти</button>}>
      <div className="grid-form">
        {fields.map(([k, label, hint]) => (
          <label key={k} className="field">
            <span>{label}</span>
            <textarea className="textarea" value={prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.value }))} />
            <span className="hint">{hint}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

function Access() {
  const db = useDb();
  const { act, state } = useApp();
  const [s, setS] = useState(db.settings);
  const key = JSON.stringify(db.settings);
  useEffect(() => setS(db.settings), [key]);
  return (
    <Section title="Генерація і доступ" actions={<button className="btn primary" onClick={() => void act(() => api('PATCH', '/api/settings', s), 'Налаштування збережено')}>Зберегти</button>}>
      <div className="grid-form">
        <label className="field">
          <span>Модель Codex</span>
          <input className="input" value={s.codexModel} onChange={(e) => setS((x) => ({ ...x, codexModel: e.target.value }))} />
          <span className="hint">Sol = gpt-6.1-sol. Бінарник: {state?.runner.codexBin ?? '—'}</span>
        </label>
        <label className="field">
          <span>Глибина міркувань</span>
          <select className="select" value={s.reasoningEffort} onChange={(e) => setS((x) => ({ ...x, reasoningEffort: e.target.value as typeof x.reasoningEffort }))}>
            {['low', 'medium', 'high', 'xhigh'].map((x) => <option key={x}>{x}</option>)}
          </select>
          <span className="hint">medium достатньо для генерації зображень.</span>
        </label>
        <label className="field">
          <span>Одночасних генерацій</span>
          <select className="select" value={String(s.concurrency ?? 2)} onChange={(e) => setS((x) => ({ ...x, concurrency: Number(e.target.value) }))}>
            {[1, 2, 3, 4].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Tailscale-логін власника</span>
          <input className="input" value={s.tailscaleLogin} onChange={(e) => setS((x) => ({ ...x, tailscaleLogin: e.target.value }))} placeholder="порожньо — віддалений доступ вимкнено" />
          <span className="hint">Лише цей логін пропускається через tailscale serve.</span>
        </label>
      </div>
      <div className="note" style={{ marginTop: 22 }}>
        Запуск ізольований: без особистого конфігу Codex, запис лише в каталог завдання. Сервер слухає тільки 127.0.0.1; телефон відкриває <b>https://…ts.net:10443</b> у межах tailnet.
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
          {current === 'preferences' && <Preferences />}
          {current === 'access' && <Access />}
        </div>
      </div>
    </div>
  );
}
