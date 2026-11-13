import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Series, niceAxis, monthLabel, labelPlan, columnLayout, stackSegments, roundedTopPath,
} from '../../utils/trendsChart';

// Chart chrome: the ink and line colors of the dataviz palette on a light surface.
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb', hover: '#f1f0eb' };

const H = 340;
const M = { left: 40, right: 12, top: 28, bottom: 42 };

/** The width of an element, kept up to date. 960 until it is measured (and on the server). */
const useWidth = (ref: React.RefObject<HTMLElement>) => {
  const [w, setW] = useState(960);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth || 960);
    const ro = new ResizeObserver(entries => setW(Math.round(entries[0].contentRect.width) || 960));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
};

export interface ColumnSeries { series: Series; counts: number[] }

/**
 * Stacked columns, one per month: the series stacked from the baseline up, a 2px surface gap between segments, 4px rounded tops, columns at most
 * 24px thick. Hover or focus a column for every series in that month; the total sits on top of the column where there is room.
 */
const StackedColumns: React.FC<{ months: string[]; data: ColumnSeries[]; dimmed?: boolean }> = ({ months, data, dimmed }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [active, setActive] = useState<number | null>(null);

  const totals = useMemo(() => months.map((_, i) => data.reduce((n, d) => n + (d.counts[i] || 0), 0)), [months, data]);
  const axis = useMemo(() => niceAxis(Math.max(0, ...totals)), [totals]);
  const lay = columnLayout(width, months.length, M.left, M.right);
  const ph = H - M.top - M.bottom;
  const baseY = M.top + ph;
  const px = (v: number) => (v / axis.max) * ph;
  const plan = labelPlan(months, lay.band);
  const peak = totals.indexOf(Math.max(...totals));
  const showAllTotals = lay.band >= 30;

  const summary = (i: number) => {
    const parts = data.filter(d => d.counts[i] > 0).map(d => `${d.series.label} ${d.counts[i]}`);
    return `${monthLabel(months[i]).full}: ${totals[i]} ticket${totals[i] === 1 ? '' : 's'}${parts.length ? `. ${parts.join(', ')}` : ''}`;
  };

  return (
    <div ref={ref} className="relative" style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity 150ms' }}>
      <svg width={width} height={H} role="group" aria-label="Tickets per month, stacked by type" style={{ display: 'block', background: INK.surface }}>
        {/* grid and y axis: recessive */}
        {axis.ticks.map(t => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={baseY - px(t)} y2={baseY - px(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth={1} />
            <text x={M.left - 8} y={baseY - px(t) + 4} textAnchor="end" fontSize={11} fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{t}</text>
          </g>
        ))}

        {months.map((m, i) => {
          const segs = stackSegments(data.map(d => d.counts[i] || 0), baseY, px);
          const x = lay.x(i);
          const on = active === i;
          const p = plan[i];
          return (
            <g key={m} tabIndex={0} role="img" aria-label={summary(i)} style={{ outline: 'none', cursor: 'default' }}
              onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
              {/* the hit area is the whole slot, much bigger than the bar */}
              <rect x={M.left + i * lay.band} y={M.top} width={lay.band} height={ph + M.bottom - 6} fill={on ? INK.hover : 'transparent'} />
              {segs.map(s => {
                const color = data[s.index].series.color;
                return s.top
                  ? <path key={s.index} d={roundedTopPath(x, s.y, lay.bar, s.h)} fill={color} />
                  : <rect key={s.index} x={x} y={s.y} width={lay.bar} height={s.h} fill={color} />;
              })}
              {totals[i] > 0 && (showAllTotals || i === peak || i === months.length - 1) && (
                <text x={lay.center(i)} y={baseY - px(totals[i]) - 6} textAnchor="middle" fontSize={11} fill={INK.secondary} style={{ fontVariantNumeric: 'tabular-nums' }}>{totals[i]}</text>
              )}
              {p.show && <text x={lay.center(i)} y={baseY + 16} textAnchor="middle" fontSize={11} fill={on ? INK.primary : INK.secondary}>{monthLabel(m).short}</text>}
              {p.show && p.showYear && <text x={lay.center(i)} y={baseY + 30} textAnchor="middle" fontSize={10} fill={INK.muted}>{monthLabel(m).year}</text>}
            </g>
          );
        })}
      </svg>

      {/* one tooltip, every series in that month: the value leads, the name follows */}
      {active !== null && (
        <div role="tooltip" className="absolute pointer-events-none rounded-md bg-white shadow-lg border border-gray-200 px-3 py-2 text-xs z-10"
          style={{ top: M.top - 8, minWidth: 170, ...(lay.center(active) > width * 0.6 ? { right: width - lay.center(active) + lay.band / 2 + 4 } : { left: lay.center(active) + lay.band / 2 + 4 }) }}>
          <div className="font-semibold text-gray-900 mb-1">{monthLabel(months[active]).full}</div>
          {data.filter(d => d.counts[active] > 0).length === 0 && <div className="text-gray-500">No tickets</div>}
          {data.filter(d => d.counts[active] > 0).reverse().map(d => (
            <div key={d.series.id} className="flex items-center gap-2 py-0.5">
              <span aria-hidden className="inline-block rounded-sm" style={{ width: 10, height: 3, background: d.series.color }} />
              <span className="font-semibold text-gray-900 tabular-nums w-7 text-right">{d.counts[active]}</span>
              <span className="text-gray-600">{d.series.label}</span>
            </div>
          ))}
          {totals[active] > 0 && (
            <div className="flex items-center gap-2 pt-1 mt-1 border-t border-gray-100">
              <span aria-hidden className="inline-block" style={{ width: 10, height: 3 }} />
              <span className="font-semibold text-gray-900 tabular-nums w-7 text-right">{totals[active]}</span>
              <span className="text-gray-500">Total</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default StackedColumns;
