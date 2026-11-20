import { useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  House, Images, LayoutGrid, Loader2, Plus, Shirt, ShoppingBag, TriangleAlert, User,
} from 'lucide-react';
import { useApp, useRoute, go } from './store.tsx';
import { Img, SpanBar } from './components/ui.tsx';
import { HomePage, useIntake } from './pages/Home.tsx';
import { CapsuleDetail, CapsulesPage } from './pages/Capsules.tsx';
import { LookPage } from './pages/Look.tsx';
import { WardrobePage } from './pages/Wardrobe.tsx';
import { GalleryPage } from './pages/Gallery.tsx';
import { ShoppingPage } from './pages/Shopping.tsx';
import { ProfilePage } from './pages/Profile.tsx';

function RailItem({ to, icon, label, active, dot, desk }: { to: string; icon: ReactNode; label: string; active: boolean; dot?: number; desk?: boolean }) {
  return (
    <a href={`/${to}`} className={`rail-item${active ? ' active' : ''}${desk ? ' desk' : ''}`} aria-current={active ? 'page' : undefined}>
      {icon}
      <span>{label}</span>
      {dot ? <span className="dot">{dot > 9 ? '9+' : dot}</span> : null}
    </a>
  );
}

/** The logo (owner, 20.11): a tailor's mannequin silhouette — a dress form on its stand. */
function CapsuleMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="capsule-mark">
      <rect x="14.2" y="2.6" width="3.6" height="2.4" rx="1" fill="currentColor" />
      <path d="M9.6 7.4C11.4 5.7 20.6 5.7 22.4 7.4C23.6 9.4 22.9 12.4 21.2 14.6C20.2 16 21.3 18.3 22 20C18.8 21.7 13.2 21.7 10 20C10.7 18.3 11.8 16 10.8 14.6C9.1 12.4 8.4 9.4 9.6 7.4Z" fill="currentColor" />
      <rect x="15.3" y="21" width="1.4" height="7" fill="currentColor" />
      <path d="M11.5 30.2L16 27.6L20.5 30.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Old addresses (the retired studio) land on their new page. */
function Redirect({ to }: { to: string }) {
  useEffect(() => go(to, true), [to]);
  return null;
}

export default function App() {
  const { state, error } = useApp();
  const { parts, query } = useRoute();
  const intake = useIntake();
  const section = parts[0] ?? 'home';

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

  const { db } = state;
  // The thin bar means work is happening now; queued work waiting for its turn shows nothing.
  // One span over everything running: it fills once from the first start to the last usual end and never jumps back.
  const running = db.jobs.filter((j) => j.state === 'running' && j.startedAt);
  const avatar = db.profile.identity?.approvedPortrait ? db.profile.identity.face : db.profile.basePhotoIds.map((id) => db.photos.find((p) => p.id === id)).find(Boolean);
  const ic = 20;

  let page: ReactNode;
  // «Найкращі» and «З моїх речей» became filters of «Усі образи» (owner, 20.11); old links land there.
  if (section === 'capsules' && parts[1] === 'best') page = <Redirect to="/capsules?tab=looks&best=1" />;
  else if (section === 'capsules' && parts[1] === 'my-wardrobe') page = <Redirect to="/capsules?tab=looks&owned=1" />;
  else if (section === 'capsules' && parts[1]) page = <CapsuleDetail id={parts[1]} />;
  else if (section === 'capsules') page = <CapsulesPage />;
  else if (section === 'looks' && parts[1]) page = <LookPage id={parts[1]} />;
  else if (section === 'wardrobe') page = <WardrobePage openId={parts[1]} />;
  else if (section === 'studio') page = <Redirect to={query.get('look') ? `/looks/${query.get('look')}` : '/capsules'} />;
  else if (section === 'gallery') page = <GalleryPage />;
  else if (section === 'queue') page = <Redirect to="/home" />;
  else if (section === 'shopping') page = <ShoppingPage focus={query.get('need') ?? undefined} />;
  else if (section === 'profile') page = <ProfilePage tab={parts[1]} />;
  else if (section === 'glossary') page = <Redirect to="/home" />;
  else page = <HomePage />;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Розділи">
        <a href="/home" className="rail-logo" aria-label="Capsula">
          <CapsuleMark size={34} />
        </a>
        <RailItem to="home" icon={<House size={ic} />} label="Головна" active={section === 'home'} desk />
        <RailItem to="capsules" icon={<LayoutGrid size={ic} />} label="Капсули" active={section === 'capsules' || section === 'looks'} />
        <RailItem to="gallery" icon={<Images size={ic} />} label="Галерея" active={section === 'gallery'} />
        <button type="button" className="rail-item rail-upload" aria-label="Додати фото" title="Додати фото" onClick={intake.pick} disabled={intake.busy}>
          <span className="upload-icon" aria-hidden="true">
            {intake.busy ? <Loader2 size={ic} className="spin" /> : <Plus size={ic} />}
          </span>
          <span>Додати фото</span>
        </button>
        <RailItem to="wardrobe" icon={<Shirt size={ic} />} label="Гардероб" active={section === 'wardrobe'} />
        <RailItem to="shopping" icon={<ShoppingBag size={ic} />} label="Покупки" active={section === 'shopping'} />
        <div className="rail-spacer" />
        <a href="/profile" className={`rail-avatar${section === 'profile' ? ' active' : ''}`} aria-label="Мій профіль" title="Мій профіль">
          {avatar ? <Img path={avatar.path} w={120} /> : <User size={18} />}
        </a>
      </nav>
      {intake.field}
      <div className="frame">
        {running.length > 0 && <SpanBar jobs={running} className="app-progress" />}
        <header className="topbar">
          <a href="/home" className="wordmark m-only" aria-label="Capsula — Головна" aria-current={section === 'home' ? 'page' : undefined}><CapsuleMark size={22} />Capsula</a>
          <div className="grow" />
          <a href="/profile" className="top-avatar m-only" aria-label="Мій профіль">
            {avatar ? <Img path={avatar.path} w={120} /> : <User size={16} />}
          </a>
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

