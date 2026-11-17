import type { ReactNode } from 'react';
import { BookOpen, Inbox, LayoutGrid, Loader2, Shirt, ShoppingBag, Sparkles, TriangleAlert, User } from 'lucide-react';
import { useApp, useRoute, go } from './store.tsx';
import { UploadButton } from './components/ui.tsx';
import { CapsuleDetail, CapsulesPage } from './pages/Capsules.tsx';
import { WardrobePage } from './pages/Wardrobe.tsx';
import { StudioPage } from './pages/Studio.tsx';
import { QueuePage } from './pages/Queue.tsx';
import { ShoppingPage } from './pages/Shopping.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { GlossaryPage } from './pages/Glossary.tsx';

function RailItem({ to, icon, label, active, dot, desk }: { to: string; icon: ReactNode; label: string; active: boolean; dot?: boolean; desk?: boolean }) {
  return (
    <a href={`#/${to}`} className={`rail-item${active ? ' active' : ''}${desk ? ' desk' : ''}`} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
      {dot && <span className="dot" />}
    </a>
  );
}

export default function App() {
  const { state, error } = useApp();
  const { parts, query } = useRoute();
  const section = parts[0] ?? 'capsules';

  if (!state) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
        {error ? (
          <div className="stack" style={{ alignItems: 'center' }}>
            <TriangleAlert />
            <b>Сервер недоступний</b>
            <span className="small">{error}</span>
          </div>
        ) : (
          <Loader2 className="spin" />
        )}
      </div>
    );
  }

  const { db, runner } = state;
  const pendingReview = db.results.filter((r) => r.review === 'pending').length;
  const activeJobs = db.jobs.filter((j) => j.state === 'queued' || j.state === 'running').length;
  const ic = 18;

  let page: ReactNode;
  if (section === 'capsules' && parts[1]) page = <CapsuleDetail id={parts[1]} />;
  else if (section === 'capsules') page = <CapsulesPage />;
  else if (section === 'wardrobe') page = <WardrobePage openId={parts[1]} />;
  else if (section === 'studio') page = <StudioPage lookId={query.get('look') ?? undefined} resultId={query.get('result') ?? undefined} />;
  else if (section === 'queue') page = <QueuePage />;
  else if (section === 'shopping') page = <ShoppingPage focus={query.get('need') ?? undefined} />;
  else if (section === 'profile') page = <ProfilePage />;
  else if (section === 'glossary') page = <GlossaryPage focus={query.get('term') ?? undefined} />;
  else page = <CapsulesPage />;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Розділи">
        <a href="#/capsules" className="rail-logo" aria-label="Cap Fashion">
          <Shirt size={18} />
        </a>
        <RailItem to="capsules" icon={<LayoutGrid size={ic} />} label="Капсули" active={section === 'capsules'} />
        <RailItem to="wardrobe" icon={<Shirt size={ic} />} label="Гардероб" active={section === 'wardrobe'} />
        <RailItem to="studio" icon={<Sparkles size={ic} />} label="Примірка" active={section === 'studio'} dot={pendingReview > 0} />
        <RailItem to="shopping" icon={<ShoppingBag size={ic} />} label="Покупки" active={section === 'shopping'} />
        <RailItem to="profile" icon={<User size={ic} />} label="Профіль" active={section === 'profile'} />
        <div className="rail-spacer" />
        <RailItem to="queue" icon={<Inbox size={ic} />} label="Черга" active={section === 'queue'} dot={activeJobs > 0} />
        <RailItem to="glossary" icon={<BookOpen size={ic} />} label="Довідка" active={section === 'glossary'} desk />
      </nav>
      <div className="frame">
        <header className="topbar">
          <div className="org-pill">
            <small>Гардероб</small>
            <b>Cap Fashion</b>
          </div>
          <div className="grow" />
          <span className="tag">Local</span>
          <button className="meta btn ghost sm" onClick={() => go('/queue')} title="Черга примірок">
            {runner.running ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            Codex · {db.settings.codexModel.replace(/^gpt-/, '')}
            {activeJobs > 0 && <b> · {activeJobs} в черзі</b>}
          </button>
          <UploadButton kind="item" className="btn primary sm" label="Додати фото" onDone={() => go('/wardrobe')} />
        </header>
        {state.recovered && (
          <div className="banner warn">
            <TriangleAlert size={16} /> Основний файл даних був пошкоджений — відкрито останню валідну копію. Наступне збереження відновить файл.
          </div>
        )}
        <main className="main">{page}</main>
      </div>
    </div>
  );
}

