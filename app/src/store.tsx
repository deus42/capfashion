import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppState } from './api.ts';
import { ApiError, getState } from './api.ts';

interface Ctx {
  state: AppState | null;
  error: string | null;
  refresh: () => Promise<void>;
  /** Runs a mutation, refreshes state and reports errors as a toast. */
  act: <T>(fn: () => Promise<T>, okMessage?: string) => Promise<T | undefined>;
  toast: (msg: string, bad?: boolean) => void;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToast] = useState<{ msg: string; bad: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const toast = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), bad ? 6000 : 2600);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await getState());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const act = useCallback(
    async <T,>(fn: () => Promise<T>, okMessage?: string) => {
      try {
        const out = await fn();
        await refresh();
        if (okMessage) toast(okMessage);
        return out;
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) await refresh();
        toast((e as Error).message, true);
        return undefined;
      }
    },
    [refresh, toast],
  );

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const busy = Boolean(state?.runner.running || state?.db.jobs.some((j) => j.state === 'running'));
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(id);
  }, [busy, refresh]);

  const value = useMemo(() => ({ state, error, refresh, act, toast }), [state, error, refresh, act, toast]);
  return (
    <AppCtx.Provider value={value}>
      {children}
      {toastMsg && <div className={`toast${toastMsg.bad ? ' bad' : ''}`} role="status">{toastMsg.msg}</div>}
    </AppCtx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error('useApp outside provider');
  return ctx;
}

export function useDb() {
  const { state } = useApp();
  return state!.db;
}

const ROUTE_EVENT = 'capfashion:route';

/**
 * Clean addresses (/capsules/C-1, /looks/L-1). Old #/ links still work: they
 * are rewritten to the clean address on arrival.
 */
function currentRoute() {
  const h = window.location.hash;
  if (h.startsWith('#/')) window.history.replaceState(null, '', h.slice(1));
  const p = window.location.pathname + window.location.search;
  return p === '/' ? '/capsules' : p;
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    window.addEventListener(ROUTE_EVENT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('hashchange', on);
      window.removeEventListener(ROUTE_EVENT, on);
    };
  }, []);
  const [pathPart, query = ''] = route.split('?');
  return { parts: pathPart.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

export function go(path: string, replace = false) {
  const to = path.startsWith('#') ? path.slice(1) : path;
  const from = window.location.pathname;
  if (to === from + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  if (to.split('?')[0] !== from) window.scrollTo(0, 0);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

// In-app links navigate without reloading; files, the API and new tabs are left alone.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  if (!a || a.target || a.hasAttribute('download')) return;
  const href = a.getAttribute('href') ?? '';
  if (!(href.startsWith('#/') || (href.startsWith('/') && !href.startsWith('//') && !/^\/(api|media|thumb|assets)\//.test(href)))) return;
  e.preventDefault();
  go(href);
});
