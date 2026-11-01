import { PRAYERS, formatDate, formatTime, getDay, getMonthRows, normalizeDate } from './prayer-data.js?v=599ae89ab5cf';

/** Capture an explicit export range independently of the screen's active tab. */
export function createExportSelection({ schedule, location, date, period = 'day', use24Hour = false }) {
  const selectedDate = normalizeDate(date);
  if (!selectedDate) throw new Error('Choose a valid export date.');
  if (!['day', 'month', 'year'].includes(period)) throw new Error('Choose a day, month or year to export.');
  if (!location?.id || !schedule) throw new Error('Choose a published timetable first.');

  const rows = period === 'day'
    ? [getDay(schedule, selectedDate)].filter(Boolean)
    : period === 'month'
      ? getMonthRows(schedule, selectedDate.slice(0, 7))
      : schedule.days.filter((day) => day.date.startsWith(selectedDate.slice(0, 4)));
  if (!rows.length) throw new Error('No timetable is published for this date. Choose another date.');

  const label = formatDate(selectedDate, period === 'day' ? { weekday: 'short' }
    : period === 'month' ? { weekday: undefined, day: undefined, month: 'long', year: 'numeric' }
      : { weekday: undefined, day: undefined, month: undefined, year: 'numeric' });
  return Object.freeze({
    location: Object.freeze({ ...location }), date: selectedDate, period, use24Hour,
    rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
    label, summary: `${rows.length} ${rows.length === 1 ? 'day' : 'days'} · ${label}`,
  });
}

export function createExportCSV(selection) {
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return [
    ['Date (YYYY-MM-DD)', ...PRAYERS.map(({ label }) => `${label} (IST)`)],
    ...selection.rows.map((day) => [day.date, ...PRAYERS.map(({ key }) => formatTime(day[key], selection.use24Hour))]),
  ].map((row) => row.map(cell).join(',')).join('\r\n');
}
