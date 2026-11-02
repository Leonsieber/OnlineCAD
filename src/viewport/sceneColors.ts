import { useMemo } from 'react';
import { useStore } from '../store/store';

export interface SceneColors {
  gridCell: string;
  gridSection: string;
  edge: string;
  accent: string;
  hover: string;
  axisX: string;
  axisY: string;
  axisZ: string;
}

function read(): SceneColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    gridCell: v('--grid-cell', '#22262e'),
    gridSection: v('--grid-section', '#2f3542'),
    edge: v('--edge', '#0b0d11'),
    // Selection in 3D is orange/amber so it reads on any part color (parts default to blue).
    accent: v('--sel-3d', '#ff9a3c'),
    hover: v('--hover-3d', '#ffd166'),
    axisX: v('--axis-x', '#e5534b'),
    axisY: v('--axis-y', '#3fb950'),
    axisZ: v('--axis-z', '#4f86ff'),
  };
}

/** 3D colors come from the same CSS tokens as the UI, so themes stay in sync. */
export function useSceneColors(): SceneColors {
  const theme = useStore((s) => s.resolvedTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(read, [theme]);
}
