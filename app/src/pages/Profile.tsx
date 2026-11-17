import { useEffect, useState } from 'react';
import { Check, Plus, Ruler, Settings, Trash2, TriangleAlert, User, X } from 'lucide-react';
import type { Category, KnownSize, MeasureKey } from '../api.ts';
import { api } from '../api.ts';
import { useApp, useDb } from '../store.tsx';
import { Badge, Dropzone, Img, PhotoPicker } from '../components/ui.tsx';
import { CATEGORY_LABEL, MEASURES, fmtDay } from '../lib.ts';

const STANDARD = [
  '2–3 фото на повний зріст спереду',
  'Камера на рівні грудей — не дзеркальне селфі',
  'Без окулярів, кепки й предметів перед тілом',
  'Рівне світло, однотонний фон',
  'Плюс одне крупне фото обличчя спереду',
];

export function ProfilePage() {
  const db = useDb();
  const { act } = useApp();
  const prof = db.profile;
  const [picker, setPicker] = useState(false);
  const [measures, setMeasures] = useState<Record<MeasureKey, string>>(() => Object.fromEntries(MEASURES.map((m) => [m.key, prof.measurements[m.key].value?.toString() ?? ''])) as Record<MeasureKey, string>);
  const [sizes, setSizes] = useState<KnownSize[]>(prof.knownSizes);
  const [prefs, setPrefs] = useState(prof.preferences);
  const [settings, setSettings] = useState(db.settings);
  useEffect(() => {
    setMeasures(Object.fromEntries(MEASURES.map((m) => [m.key, prof.measurements[m.key].value?.toString() ?? ''])) as Record<MeasureKey, string>);
    setSizes(prof.knownSizes);
    setPrefs(prof.preferences);
  }, [prof.rev]);
  const settingsKey = JSON.stringify(db.settings);
  useEffect(() => setSettings(db.settings), [settingsKey]);

  const base = prof.basePhotoIds.map((id) => db.photos.find((p) => p.id === id)).filter(Boolean) as typeof db.photos;
  const okCount = base.filter((p) => p.meetsStandard).length;
  const saveProfile = (body: Record<string, unknown>, msg: string) => act(() => api('PATCH', '/api/profile', { rev: prof.rev, ...body }), msg);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Мій профіль</h1>
          <p>Базові фото для примірки, мірки, відомі розміри й побажання. Усе заповнюється поступово — відсутні дані не блокують сайт.</p>
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0, flex: 1 }}>
            <User size={15} /> Базові фото <span className="count">{base.length}</span>
            {base.length > 0 && <Badge tone={okCount >= 2 ? 'ok' : 'warn'}>{okCount} за стандартом</Badge>}
          </div>
          <button className="btn sm" onClick={() => setPicker(true)}>Вибрати з наявних</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16 }} className="profile-base">
          <div className="stack" style={{ gap: 12 }}>
            {base.length > 0 && (
              <div className="photo-strip">
                {base.map((p) => (
                  <div key={p.id} className="stack" style={{ gap: 6, width: 120, flex: 'none' }}>
                    <div className="p" style={{ width: 120, height: 150 }}>
                      <Img path={p.path} w={360} />
                    </div>
                    <div className="row" style={{ gap: 4 }}>
                      <button
                        className={`btn sm${p.meetsStandard ? ' primary' : ''}`}
                        style={{ flex: 1, padding: 0 }}
                        title="Відповідає стандарту"
                        onClick={() => void act(() => api('PATCH', `/api/photos/${p.id}`, { meetsStandard: !p.meetsStandard }))}
                      >
                        {p.meetsStandard ? <Check size={13} /> : p.meetsStandard === false ? <TriangleAlert size={13} /> : '?'} стандарт
                      </button>
                      <button className="btn sm ghost" title="Прибрати з базових" onClick={() => void saveProfile({ basePhotoIds: prof.basePhotoIds.filter((x) => x !== p.id) }, 'Прибрано')}>
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Dropzone kind="base" text="Перетягни сюди нові базові фото або вибери файли. З iPhone — зніми камерою чи вибери з галереї." />
          </div>
          <div className="note">
            <b className="small">Стандарт базового фото</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }} className="small">
              {STANDARD.map((s) => <li key={s}>{s}</li>)}
            </ul>
            <p className="small muted" style={{ marginTop: 8 }}>Обличчя в кожній примірці береться лише з цих оригіналів, ніколи з попередніх рендерів.</p>
          </div>
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0, flex: 1 }}>
            <Ruler size={15} /> Мірки, см
          </div>
          <button
            className="btn sm primary"
            onClick={() => void saveProfile({ measurements: Object.fromEntries(MEASURES.map((m) => [m.key, { value: measures[m.key] }])) }, 'Мірки збережено')}
          >
            Зберегти мірки
          </button>
        </div>
        <div className="measure-grid">
          {MEASURES.map((m) => {
            const saved = prof.measurements[m.key];
            return (
              <label key={m.key} className="field">
                <span>
                  {m.label} {saved.value === null ? <span className="faint">· ще не заповнено</span> : <span className="faint">· {fmtDay(saved.date)}</span>}
                </span>
                <input className="input" inputMode="decimal" value={measures[m.key]} onChange={(e) => setMeasures((x) => ({ ...x, [m.key]: e.target.value }))} placeholder="см" />
                <span className="hint">{m.how}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0, flex: 1 }}>Відомі розміри за брендом</div>
          <button className="btn sm" onClick={() => setSizes((s) => [...s, { id: '', brand: '', category: 'trousers', size: '' }])}>
            <Plus size={13} /> Рядок
          </button>
          <button className="btn sm primary" onClick={() => void saveProfile({ knownSizes: sizes }, 'Розміри збережено')}>Зберегти</button>
        </div>
        <div className="stack">
          {sizes.length === 0 && <span className="muted small">Ще немає. Розміри зберігаються в оригінальній системі бренду, напр. W32 L32 чи EU 43.</span>}
          {sizes.map((s, i) => (
            <div key={i} className="row wrap">
              <input className="input" style={{ width: 160 }} placeholder="Бренд" value={s.brand} onChange={(e) => setSizes((l) => l.map((x, j) => (j === i ? { ...x, brand: e.target.value } : x)))} />
              <select className="select" style={{ width: 170 }} value={s.category} onChange={(e) => setSizes((l) => l.map((x, j) => (j === i ? { ...x, category: e.target.value as Category } : x)))}>
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
              <input className="input" style={{ width: 120 }} placeholder="Розмір" value={s.size} onChange={(e) => setSizes((l) => l.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))} />
              <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="Примітка" value={s.note ?? ''} onChange={(e) => setSizes((l) => l.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
              <button className="btn sm ghost" aria-label="Видалити" onClick={() => setSizes((l) => l.filter((_, j) => j !== i))}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0, flex: 1 }}>Побажання</div>
          <button className="btn sm primary" onClick={() => void saveProfile({ preferences: prefs }, 'Побажання збережено')}>Зберегти</button>
        </div>
        <div className="grid-form">
          {(
            [
              ['comfort', 'Комфорт'],
              ['materials', 'Матеріали'],
              ['fit', 'Посадка'],
              ['branding', 'Брендування'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="field">
              <span>{label}</span>
              <textarea className="textarea" value={prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
      </div>

      <div className="card pad">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="section-title" style={{ margin: 0, flex: 1 }}>
            <Settings size={15} /> Генерація та доступ
          </div>
          <button className="btn sm primary" onClick={() => void act(() => api('PATCH', '/api/settings', settings), 'Налаштування збережено')}>Зберегти</button>
        </div>
        <div className="grid-form">
          <label className="field">
            <span>Модель Codex</span>
            <input className="input" value={settings.codexModel} onChange={(e) => setSettings((s) => ({ ...s, codexModel: e.target.value }))} />
            <span className="hint">Sol = gpt-6.1-sol. Запуск ізольований: без особистого конфігу Codex, запис лише в каталог завдання.</span>
          </label>
          <label className="field">
            <span>Глибина міркувань</span>
            <select className="select" value={settings.reasoningEffort} onChange={(e) => setSettings((s) => ({ ...s, reasoningEffort: e.target.value as typeof s.reasoningEffort }))}>
              {['low', 'medium', 'high', 'xhigh'].map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="field full">
            <span>Tailscale-логін власника (для доступу з iPhone)</span>
            <input className="input" value={settings.tailscaleLogin} onChange={(e) => setSettings((s) => ({ ...s, tailscaleLogin: e.target.value }))} placeholder="login@example.com" />
            <span className="hint">Порожньо — віддалений доступ вимкнено. Сервер слухає лише 127.0.0.1; телефон заходить через `tailscale serve` у межах tailnet.</span>
          </label>
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
            void saveProfile({ basePhotoIds: ids }, 'Базові фото оновлено');
          }}
        />
      )}
    </div>
  );
}
