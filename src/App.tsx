import { useEffect } from 'react';
import { startKernel } from './kernel/client';
import { lastDocId, loadDoc } from './io/storage';
import { useStore } from './store/store';
import { openSharedLink, saveNow } from './app/actions';
import { initCloud } from './cloud/cloud';
import { installShortcuts } from './app/shortcuts';
import { LeftPanel } from './ui/LeftPanel';
import { MenuBar } from './ui/MenuBar';
import { Modals } from './ui/Modals';
import { Properties } from './ui/Properties';
import { Ribbon } from './ui/Ribbon';
import { Timeline } from './ui/Timeline';
import { resolveTheme } from './ui/themes';
import { Toasts } from './ui/Toasts';
import { Home } from './ui/Home';
import { Viewport } from './viewport/Viewport';
import { viewApi } from './viewport/viewApi';

function useTheme() {
  const pref = useStore((s) => s.prefs.theme);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const t = resolveTheme(pref, mq.matches);
      document.documentElement.dataset.theme = t;
      useStore.setState({ resolvedTheme: t });
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);
}

let booted = false;

/** Restore the last document, start the kernel, and keep saving in the background. */
function boot() {
  if (booted) return;
  booted = true;
  installShortcuts();
  initCloud();
  const shared = new URLSearchParams(location.search).get('share');
  void (async () => {
    try {
      const id = await lastDocId();
      const doc = id ? await loadDoc(id) : undefined;
      if (doc) useStore.getState().loadDoc(doc, { saved: true });
    } catch (e) {
      console.warn('Could not restore the last document', e);
    }
    startKernel();
    if (shared) {
      history.replaceState(null, '', location.pathname);
      void openSharedLink(shared);
    }
  })();

  // Fit the view once, the first time geometry shows up.
  const unsub = useStore.subscribe((s) => {
    if (s.parts.length) {
      unsub();
      setTimeout(() => viewApi.fitAll(false), 50);
    }
  });

  let timer: number | undefined;
  useStore.subscribe((s, prev) => {
    if ((s.doc === prev.doc && s.saveState === prev.saveState) || s.saveState !== 'unsaved' || s.playing) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void saveNow(), 1200);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && useStore.getState().saveState === 'unsaved') void saveNow();
  });
}

export function App() {
  useTheme();
  useEffect(boot, []);
  return (
    <div className="app">
      <MenuBar />
      <Ribbon />
      <LeftPanel />
      <main className="center">
        <Viewport />
      </main>
      <aside className="right">
        <Properties />
      </aside>
      <Timeline />
      <Home />
      <Toasts />
      <Modals />
    </div>
  );
}
