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

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash || '#/capsules');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/capsules');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [pathPart, query = ''] = hash.slice(1).split('?');
  return { parts: pathPart.split('/').filter(Boolean), query: new URLSearchParams(query) };
}

export function go(path: string) {
  window.location.hash = path;
}
