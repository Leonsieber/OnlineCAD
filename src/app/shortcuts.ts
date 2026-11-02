import { useStore } from '../store/store';
import { viewApi } from '../viewport/viewApi';
import { deleteSelection, duplicateSelection, hideSelection, importFile, saveNow, selectAll, selectedParts, showAllParts } from './actions';

let installed = false;

export function installShortcuts() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const s = useStore.getState();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod) {
      if (key === 's') {
        e.preventDefault();
        void saveNow();
      } else if (key === 'o') {
        e.preventDefault();
        s.setModal('documents');
      } else if (key === 'i') {
        e.preventDefault();
        void importFile();
      } else if (typing) {
        return; // let inputs keep their own undo, select-all, and copy
      } else if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        s.redo();
      } else if (key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (key === 'a') {
        e.preventDefault();
        selectAll();
      }
      return;
    }
    if (typing || s.modal || e.altKey) return;

    switch (e.key) {
      case 'Escape':
        if (s.ctxMenu) s.setCtxMenu(null);
        else if (s.draft) s.cancelDraft();
        else s.select(null);
        break;
      case 'Enter':
        if (s.draft) {
          e.preventDefault();
          s.confirmDraft();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (!s.draft) deleteSelection();
        break;
      case 'f':
      case 'F': {
        const ids = selectedParts();
        viewApi.fitAll(true, ids.length ? ids : undefined);
        break;
      }
      case 'g':
        s.setPref('grid', !s.prefs.grid);
        break;
      case 'w':
        s.setGizmo('translate');
        break;
      case 'e':
        s.setGizmo('rotate');
        break;
      case 'h':
        hideSelection(true);
        break;
      case 'H':
        showAllParts();
        break;
      case '1':
        if (!s.draft) s.setFilter('part');
        break;
      case '2':
        if (!s.draft) s.setFilter('face');
        break;
      case '3':
        if (!s.draft) s.setFilter('edge');
        break;
      case '?':
        s.setModal('shortcuts');
        break;
    }
  });
}
