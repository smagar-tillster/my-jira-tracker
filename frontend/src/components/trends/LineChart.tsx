import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Series, niceAxis, monthLabel, labelPlan, plotLayout, linePath, LINE_DASH, MARKERS, LAST_SEGMENT_DASH } from '../../utils/trendsChart';

// Chart chrome: the ink and line colors of the dataviz palette on a light surface.
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb', hover: '#f1f0eb' };

const H = 320;
const M = { left: 40, right: 16, top: 20, bottom: 42 };

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

export interface LineSeries { series: Series; counts: number[]; position: number }

const Marker: React.FC<{ shape: (typeof MARKERS)[number]; x: number; y: number; r: number; color: string }> = ({ shape, x, y, r, color }) => {
  const common = { fill: color, stroke: INK.surface, strokeWidth: 2 };
  if (shape === 'square') return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...common} />;
  if (shape === 'triangle') return <path d={`M${x},${y - r - 1}L${x + r + 1},${y + r}L${x - r - 1},${y + r}Z`} {...common} />;
  if (shape === 'diamond') return <path d={`M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}Z`} {...common} />;
  return <circle cx={x} cy={y} r={r} {...common} />;
};

/**
 * One line per series over the months: 2px straight segments, 8px markers with a surface ring, the month in progress (the last) drawn dashed.
 * With several lines each also has its own dash and marker so it can be told apart without color. Hover or focus a month for every value in it.
 * A single line gets a light area under it.
 */
const LineChart: React.FC<{ months: string[]; data: LineSeries[]; dimmed?: boolean; ariaLabel: string }> = ({ months, data, dimmed, ariaLabel }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [active, setActive] = useState<number | null>(null);

  const max = useMemo(() => Math.max(0, ...data.flatMap(d => d.counts)), [data]);
  const axis = useMemo(() => niceAxis(max), [max]);
  const lay = plotLayout(width, months.length, M.left, M.right);
  const ph = H - M.top - M.bottom;
  const baseY = M.top + ph;
  const y = (v: number) => baseY - (v / axis.max) * ph;
  const xs = months.map((_, i) => lay.x(i));
  const plan = labelPlan(months, lay.band);
  const single = data.length === 1;

  const summary = (i: number) => `${monthLabel(months[i]).full}: ${data.map(d => `${d.series.label} ${d.counts[i] || 0}`).join(', ')}${i === months.length - 1 ? ' (month in progress)' : ''}`;

  return (
    <div ref={ref} className="relative" style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity 150ms' }}>
      <svg width={width} height={H} role="group" aria-label={ariaLabel} style={{ display: 'block', background: INK.surface }}>
        {axis.ticks.map(t => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? INK.axis : INK.grid} strokeWidth={1} />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{t}</text>
          </g>
        ))}

        {active !== null && <line x1={xs[active]} x2={xs[active]} y1={M.top} y2={baseY} stroke={INK.axis} strokeWidth={1} />}

        {/* lines under the markers; the last segment (the month in progress) is dashed */}
        {data.map(d => {
          const ys = d.counts.map(y);
          const n = xs.length;
          const head = n > 1 ? linePath(xs.slice(0, n - 1), ys.slice(0, n - 1)) : '';
          const solid = { fill: 'none', stroke: d.series.color, strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
          const dash = LINE_DASH[d.position] || undefined;
          return (
            <g key={d.series.id}>
              {single && n > 0 && <path d={`${linePath(xs, ys)}L${xs[n - 1]},${baseY}L${xs[0]},${baseY}Z`} fill={d.series.color} opacity={0.1} />}
              {n > 2 && <path d={head} {...solid} strokeDasharray={dash} />}
              {n > 1 && <path d={linePath(xs.slice(n - 2), ys.slice(n - 2))} {...solid} strokeDasharray={LAST_SEGMENT_DASH} />}
            </g>
          );
        })}

        {months.map((m, i) => {
          const p = plan[i];
          const on = active === i;
          return (
            <g key={m} tabIndex={0} role="img" aria-label={summary(i)} style={{ outline: 'none' }}
              onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
              {/* the hit area is the whole month slot, much bigger than a marker */}
              <rect x={M.left + i * lay.band} y={M.top} width={lay.band} height={ph + M.bottom - 6} fill="transparent" />
              {data.map(d => <Marker key={d.series.id} shape={MARKERS[d.position]} x={xs[i]} y={y(d.counts[i] || 0)} r={on ? 5 : 4} color={d.series.color} />)}
              {single && (data[0].counts[i] || 0) > 0 && <text x={xs[i]} y={y(data[0].counts[i]) - 10} textAnchor="middle" fontSize={11} fill={INK.secondary} style={{ fontVariantNumeric: 'tabular-nums' }}>{data[0].counts[i]}</text>}
              {p.show && <text x={xs[i]} y={baseY + 16} textAnchor="middle" fontSize={11} fill={on ? INK.primary : INK.secondary}>{monthLabel(m).short}</text>}
              {p.show && p.showYear && <text x={xs[i]} y={baseY + 30} textAnchor="middle" fontSize={10} fill={INK.muted}>{monthLabel(m).year}</text>}
            </g>
          );
        })}
      </svg>

      {/* one tooltip, every line in that month: the value leads, the name follows */}
      {active !== null && (
        <div role="tooltip" className="absolute pointer-events-none rounded-md bg-white shadow-lg border border-gray-200 px-3 py-2 text-xs z-10"
          style={{ top: M.top, minWidth: 170, ...(xs[active] > width * 0.6 ? { right: width - xs[active] + 10 } : { left: xs[active] + 10 }) }}>
          <div className="font-semibold text-gray-900 mb-1">{monthLabel(months[active]).full}{active === months.length - 1 && <span className="font-normal text-gray-500"> · so far</span>}</div>
          {[...data].sort((a, b) => (b.counts[active] || 0) - (a.counts[active] || 0)).map(d => (
            <div key={d.series.id} className="flex items-center gap-2 py-0.5">
              <span aria-hidden className="inline-block rounded-sm" style={{ width: 10, height: 3, background: d.series.color }} />
              <span className="font-semibold text-gray-900 tabular-nums w-8 text-right">{d.counts[active] || 0}</span>
              <span className="text-gray-600">{d.series.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LineChart;
