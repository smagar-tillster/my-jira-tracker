// ISO weeks (Monday to Sunday) in local calendar days; shared by the weekly status and the defects report.
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (day, n) => { const x = new Date(`${day}T12:00:00`); x.setDate(x.getDate() + n); return ymd(x); };
export const pretty = (day) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const weekOf = (day) => {
  const d = new Date(`${day}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  const mon = addDays(day, -dow);
  const thu = new Date(`${addDays(mon, 3)}T12:00:00`);
  const jan1 = new Date(thu.getFullYear(), 0, 1, 12);
  const wk = Math.floor(Math.round((thu - jan1) / 86400000) / 7) + 1; // round: a daylight-saving shift makes the ms difference 1 hour short
  return { id: `${thu.getFullYear()}-W${String(wk).padStart(2, '0')}`, from: mon, to: addDays(mon, 6) };
};
export const weekById = (id) => {
  const m = String(id).match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`week must look like 2026-W43, got "${id}"`);
  const w1 = weekOf(`${m[1]}-01-04`); // Jan 4 is always in ISO week 1
  const from = addDays(w1.from, (Number(m[2]) - 1) * 7);
  return { id, from, to: addDays(from, 6) };
};
