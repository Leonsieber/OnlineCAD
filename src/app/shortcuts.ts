import { useStore } from '../store/store';
import { isSketching, sketchRedo, sketchUndo } from '../sketch/sketchUi';
import { toggleMeasure } from '../viewport/Measure';
import { viewApi } from '../viewport/viewApi';
import {
  deleteSelection,
  dropToPlate,
  duplicateSelection,
  nudgeSelection,
  groupSelection,
  hideSelection,
  importFile,
  saveNow,
  selectAll,
  selectedParts,
  showAllParts,
  ungroupSelection,
} from './actions';

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
      if (key === ',') {
        e.preventDefault();
        s.setModal('settings');
      } else if (key === 'k') {
        e.preventDefault();
        s.setPanel(s.panel === 'ai' ? null : 'ai');
      } else if (key === 's') {
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
        if (isSketching()) sketchUndo();
        else s.undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        if (isSketching()) sketchRedo();
        else s.redo();
      } else if (key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
      } else if (key === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Ctrl+Up/Down lifts and lowers, as in Tinkercad.
        e.preventDefault();
        nudgeSelection(0, 0, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      }
      return;
    }
    if (typing || s.modal || e.altKey) return;
    // The sketch editor has its own keys (tools, constraints, Esc); only Enter (finish) passes through.
    if (isSketching() && e.key !== 'Enter') return;

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
      case 'q':
        s.setGizmo('handles');
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
      case 'd':
      case 'D':
        dropToPlate();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const k = e.shiftKey ? 10 : 1;
        nudgeSelection(e.key === 'ArrowRight' ? k : e.key === 'ArrowLeft' ? -k : 0, e.key === 'ArrowUp' ? k : e.key === 'ArrowDown' ? -k : 0);
        break;
      }
      case 'PageUp':
      case 'PageDown':
        e.preventDefault();
        nudgeSelection(0, 0, (e.key === 'PageUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
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
      case 'm':
      case 'M':
        if (!s.draft) toggleMeasure();
        break;
    }
  });
}
