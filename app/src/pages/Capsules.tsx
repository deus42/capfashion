import { useMemo, useState } from 'react';
import { ArrowLeft, Heart, ImageOff, Pencil, Plus, Search, ShoppingBag, Sparkles } from 'lucide-react';
import type { Capsule, Look, Season, SlotKey } from '../api.ts';
import { api, thumb } from '../api.ts';
import { go, useApp, useDb } from '../store.tsx';
import { Badge, Empty, KindDot, KindLegend, Modal } from '../components/ui.tsx';
import { REVIEW_LABEL, REVIEW_TONE, SEASON_LABEL, SLOT_LABEL, capsuleCover, coverForLook, looksUsing, resolveRef } from '../lib.ts';

const SEASON_FILTERS: (Season | 'any')[] = ['any', 'all', 'warm', 'transitional', 'cold'];

export function CapsulesPage() {
  const db = useDb();
  const { act } = useApp();
  const [q, setQ] = useState('');
  const [season, setSeason] = useState<Season | 'any'>('any');
  const [favOnly, setFavOnly] = useState(false);
  const list = db.capsules.filter(
    (c) => (season === 'any' || c.season === season) && (!favOnly || c.favorite) && c.name.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const openNeeds = db.needs.filter((n) => n.status === 'open' && looksUsing(db, 'need', n.id).length > 0).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Капсули</h1>
          <p>Набори сумісних речей із кількома образами. Відкрий капсулу, щоб побачити себе в образах, склад і що докупити.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => go('/shopping')}>
            <ShoppingBag size={15} /> Список покупок {openNeeds > 0 && <Badge>{openNeeds}</Badge>}
          </button>
          <button className="btn primary" onClick={() => go('/studio')}>
            <Sparkles size={15} /> Примірка
          </button>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 18 }}>
        <label className="search">
          <Search size={15} />
          <input className="input" placeholder="Пошук за назвою" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="chips">
          {SEASON_FILTERS.map((s) => (
            <button key={s} className={`chip${season === s ? ' active' : ''}`} onClick={() => setSeason(s)}>
              {s === 'any' ? 'Будь-який сезон' : SEASON_LABEL[s]}
            </button>
          ))}
          <button className={`chip${favOnly ? ' active' : ''}`} onClick={() => setFavOnly((v) => !v)}>
            <Heart size={14} /> Обрані
          </button>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty icon={<Search />} title="Нічого не знайдено">Зміни пошук або фільтри.</Empty>
      ) : (
        <div className="capsule-grid">
          {list.map((c) => {
            const cover = capsuleCover(db, c.lookIds);
            return (
              <a key={c.id} href={`#/capsules/${c.id}`} className="card capsule-card">
                <div className="cover">
                  {cover ? (
                    <img src={thumb(cover.imagePath, 900)} alt={c.name} />
                  ) : (
                    <div className="empty-cover">
                      <ImageOff size={28} />
                      Примірка ще не створена
                    </div>
                  )}
                  {cover && (
                    <div className="corner">
                      <Badge tone={REVIEW_TONE[cover.review]}>{REVIEW_LABEL[cover.review]}</Badge>
                    </div>
                  )}
                  <div className="corner-r">
                    <button
                      className={`icon-btn${c.favorite ? ' on' : ''}`}
                      aria-label={c.favorite ? 'Прибрати з обраних' : 'В обрані'}
                      onClick={(e) => {
                        e.preventDefault();
                        void act(() => api('PATCH', `/api/capsules/${c.id}`, { favorite: !c.favorite }));
                      }}
                    >
                      <Heart size={15} fill={c.favorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                </div>
                <div className="body">
                  <h3>{c.name}</h3>
                  <div className="row small muted">
                    <span>{SEASON_LABEL[c.season]}</span>·<span>{c.lookIds.length} образів</span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LookCard({ look }: { look: Look }) {
  const db = useDb();
  const cover = coverForLook(db, look);
  const stale = cover && cover.lookVersion !== look.version;
  return (
    <div className="card look-card" style={{ overflow: 'hidden' }}>
      <a className="cover" href={`#/studio?look=${look.id}`}>
        {cover ? (
          <img src={thumb(cover.imagePath, 700)} alt={look.name} />
        ) : (
          <div className="empty-cover">
            <ImageOff size={24} />
            Примірка ще не створена
          </div>
        )}
        <div className="corner">
          {cover && <Badge tone={REVIEW_TONE[cover.review]}>{REVIEW_LABEL[cover.review]}</Badge>}
          {stale && <Badge tone="warn">для версії {cover.lookVersion}</Badge>}
        </div>
      </a>
      <div className="body">
        <div className="row">
          <h4 style={{ flex: 1 }}>{look.name}</h4>
          {look.origin === 'agent' && <Badge tone="info">пропозиція агента</Badge>}
        </div>
        <div className="slot-list">
          {(Object.keys(SLOT_LABEL) as SlotKey[]).flatMap((k) =>
            look.slots[k].map((ref) => {
              const r = resolveRef(db, ref);
              return (
                <div className="slot-line" key={`${k}-${ref.id}`}>
                  <span className="s">{SLOT_LABEL[k]}</span>
                  <KindDot kind={r.kind} />
                  <span className="t" title={r.title}>
                    {r.title}
                  </span>
                </div>
              );
            }),
          )}
        </div>
        {look.note && <div className="small muted">{look.note}</div>}
        <a className="btn sm" href={`#/studio?look=${look.id}`}>
          <Sparkles size={13} /> Відкрити в примірці
        </a>
      </div>
    </div>
  );
}

function EditCapsule({ capsule, onClose }: { capsule: Capsule; onClose: () => void }) {
  const { act } = useApp();
  const [name, setName] = useState(capsule.name);
  const [description, setDescription] = useState(capsule.description);
  const [season, setSeason] = useState<Season>(capsule.season);
  const [situations, setSituations] = useState(capsule.situations.join('\n'));
  const save = async () => {
    const ok = await act(
      () => api('PATCH', `/api/capsules/${capsule.id}`, { rev: capsule.rev, name, description, season, situations: situations.split('\n') }),
      'Капсулу збережено',
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title="Редагувати капсулу"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Скасувати</button>
          <button className="btn primary" onClick={() => void save()}>Зберегти</button>
        </>
      }
    >
      <div className="grid-form">
        <label className="field full">
          <span>Назва</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field full">
          <span>Опис</span>
          <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field">
          <span>Сезон</span>
          <select className="select" value={season} onChange={(e) => setSeason(e.target.value as Season)}>
            {(['all', 'warm', 'transitional', 'cold'] as Season[]).map((s) => (
              <option key={s} value={s}>{SEASON_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className="field full">
          <span>Ситуації (по одній на рядок)</span>
          <textarea className="textarea" value={situations} onChange={(e) => setSituations(e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}

export function CapsuleDetail({ id }: { id: string }) {
  const db = useDb();
  const { act } = useApp();
  const [editing, setEditing] = useState(false);
  const capsule = db.capsules.find((c) => c.id === id);
  const looks = useMemo(() => (capsule?.lookIds ?? []).map((l) => db.looks.find((x) => x.id === l)).filter((l): l is Look => Boolean(l)), [capsule, db.looks]);

  if (!capsule) return <div className="page"><Empty icon={<ImageOff />} title="Капсулу не знайдено" /></div>;

  const refs = new Map<string, ReturnType<typeof resolveRef>>();
  for (const l of looks) for (const list of Object.values(l.slots)) for (const ref of list) refs.set(`${ref.kind}:${ref.id}`, resolveRef(db, ref));
  const all = [...refs.values()];
  const owned = all.filter((r) => r.kind === 'owned' || r.kind === 'candidate');
  const needs = all.filter((r) => r.kind === 'need' || r.kind === 'product');

  const addLook = async () => {
    const look = await act(() => api<Look>('POST', '/api/looks', { capsuleId: capsule.id, name: `Новий образ ${looks.length + 1}`, slots: {} }), 'Образ додано');
    if (look) go(`/studio?look=${look.id}`);
  };

  return (
    <div className="page">
      <a href="#/capsules" className="btn ghost sm" style={{ marginBottom: 12 }}>
        <ArrowLeft size={14} /> Капсули
      </a>
      <div className="page-head">
        <div>
          <div className="row">
            <h1>{capsule.name}</h1>
            <Badge>{SEASON_LABEL[capsule.season]}</Badge>
          </div>
          <p>{capsule.description}</p>
          {capsule.situations.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              {capsule.situations.map((s) => (
                <span key={s} className="badge">{s}</span>
              ))}
            </div>
          )}
        </div>
        <div className="actions">
          <button className={`icon-btn${capsule.favorite ? ' on' : ''}`} aria-label="Обране" onClick={() => void act(() => api('PATCH', `/api/capsules/${capsule.id}`, { favorite: !capsule.favorite }))}>
            <Heart size={15} fill={capsule.favorite ? 'currentColor' : 'none'} />
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Редагувати
          </button>
          <button className="btn primary" onClick={() => void addLook()}>
            <Plus size={15} /> Новий образ
          </button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
        <div className="section-title" style={{ margin: 0 }}>
          Образи <span className="count">{looks.length}</span>
        </div>
        <KindLegend />
      </div>
      <div className="look-grid">
        {looks.map((l) => (
          <LookCard key={l.id} look={l} />
        ))}
      </div>

      <div className="sep" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div className="card pad">
          <div className="section-title">
            Наявне в гардеробі <span className="count">{owned.length}</span>
          </div>
          <div className="slot-list">
            {owned.length === 0 && <span className="muted small">Жодної власної речі в образах.</span>}
            {owned.map((r) => (
              <a key={r.ref.id} href={`#/wardrobe/${r.ref.id}`} className="slot-line">
                <KindDot kind={r.kind} />
                <span className="t">{r.title}</span>
                <Badge tone={r.kind === 'owned' ? 'ok' : 'warn'}>{r.kind === 'owned' ? 'підтверджено' : 'звірити'}</Badge>
              </a>
            ))}
          </div>
        </div>
        <div className="card pad">
          <div className="section-title">
            Потрібно докупити <span className="count">{needs.length}</span>
          </div>
          <div className="slot-list">
            {needs.length === 0 && <span className="muted small">Усе є.</span>}
            {needs.map((r) => (
              <a key={r.ref.id} href={`#/shopping?need=${r.ref.id}`} className="slot-line">
                <KindDot kind={r.kind} />
                <span className="t">{r.title}</span>
                <span className="small muted">{db.products.filter((p) => p.needId === r.ref.id).length || 'без'} товарів</span>
              </a>
            ))}
          </div>
        </div>
      </div>
      <p className="small faint" style={{ marginTop: 14 }}>
        Джерело: {capsule.sourceNote ?? 'власник'}. Архівна капсула — вподобаний напрям, а не доказ покупки.
      </p>
      {editing && <EditCapsule capsule={capsule} onClose={() => setEditing(false)} />}
    </div>
  );
}
