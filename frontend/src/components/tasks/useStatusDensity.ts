import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StatusDensity, nextDensity } from '../../utils/taskFilters';

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * Keeps the status buttons on the first line. After every render it checks whether the group has dropped below the first item of the line and, if so,
 * moves to the next smaller size; when the width of the line changes it starts again from full size. Attach `lineRef` to the line and `statusRef`
 * to the status group. `active` is false while the toolbar is hidden (full screen).
 */
export const useStatusDensity = (active: boolean) => {
  const lineRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<StatusDensity>(0);
  const lastWidth = useRef(0);

  useIsoLayoutEffect(() => {
    const line = lineRef.current; const group = statusRef.current;
    const first = line?.firstElementChild as HTMLElement | null | undefined;
    if (!active || !line || !group || !first) return;
    const wrapped = group.offsetTop >= first.offsetTop + first.offsetHeight;      // it starts below the bottom of the first item: it is on a second line
    const next = nextDensity(density, wrapped);
    if (next !== density) setDensity(next);
  });

  // when the toolbar is shown again (full screen left, the filters expanded) start again from full size: the window may have changed meanwhile
  useEffect(() => { if (active) setDensity(0); }, [active]);

  useEffect(() => {
    const line = lineRef.current;
    if (!active || !line || typeof ResizeObserver === 'undefined') return undefined;
    lastWidth.current = line.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = line.clientWidth;
      if (Math.abs(w - lastWidth.current) > 1) { lastWidth.current = w; setDensity(0); }       // only the width: wrapping changes the height, not the width
    });
    ro.observe(line);
    return () => ro.disconnect();
  }, [active]);

  return { lineRef, statusRef, density };
};
