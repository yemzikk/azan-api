/** Shared, dependency-free data helpers for the static prayer dashboard. */
export const TIME_ZONE = 'Asia/Kolkata';
export const REQUEST_TIMEOUT_MS = 10_000;

export const PRAYERS = Object.freeze([
  { key: 'subh', label: 'Fajr', shortLabel: 'Fajr', kind: 'prayer' },
  { key: 'sunrise', label: 'Sunrise', shortLabel: 'Sunrise', kind: 'sunrise' },
  { key: 'duhr', label: 'Dhuhr', shortLabel: 'Dhuhr', kind: 'prayer' },
  { key: 'asar', label: 'Asr', shortLabel: 'Asr', kind: 'prayer' },
  { key: 'maghrib', label: 'Maghrib', shortLabel: 'Maghrib', kind: 'prayer' },
  { key: 'isha', label: 'Isha', shortLabel: 'Isha', kind: 'prayer' },
].map(Object.freeze));

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** An India calendar date, irrespective of the visitor's device timezone. */
export function getDateKey(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Accept ISO or the source's DD-MM-YYYY dates, rejecting impossible dates. */
export function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    const source = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
    if (!source) return null;
    match = [source[0], source[3], source[2], source[1]];
  }
  const [, year, month, day] = match;
  const timestamp = Date.parse(`${year}-${month}-${day}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
}

export function addDays(dateKey, count) {
  const validDate = normalizeDate(dateKey);
  if (!validDate || !Number.isInteger(count)) return null;
  const date = new Date(`${validDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function formatDate(dateKey, options = {}) {
  const validDate = normalizeDate(dateKey);
  if (!validDate) return 'Date unavailable';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    ...options, timeZone: TIME_ZONE,
  }).format(new Date(`${validDate}T12:00:00+05:30`));
}

/** Minutes after midnight; never use browser-dependent free-form Date parsing. */
export function parseTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):([0-5]\d)\s*(?:([ap])\.?m\.?)?$/i.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  if (match[3]) {
    if (hours < 1 || hours > 12) return null;
    hours = hours % 12 + (match[3].toLowerCase() === 'p' ? 12 : 0);
  } else if (hours > 23) return null;
  return hours * 60 + Number(match[2]);
}

export function formatTime(value, use24Hour = false) {
  const minutes = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1440
    ? value : parseTime(value);
  if (minutes === null) return '—';
  const hours = Math.floor(minutes / 60);
  const minutePart = String(minutes % 60).padStart(2, '0');
  return use24Hour
    ? `${String(hours).padStart(2, '0')}:${minutePart}`
    : `${hours % 12 || 12}:${minutePart} ${hours >= 12 ? 'PM' : 'AM'}`;
}

export function prayerTimestamp(dateKey, time) {
  const validDate = normalizeDate(dateKey);
  const minutes = parseTime(time);
  if (!validDate || minutes === null) return null;
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return Date.parse(`${validDate}T${hours}:${String(minutes % 60).padStart(2, '0')}:00+05:30`);
}

export function normalizeSchedule(rows, locationId = '', source = '') {
  if (!Array.isArray(rows)) throw new Error('The timetable must contain a list of dates.');
  const byDate = new Map();
  const issues = [];
  for (const row of rows) {
    const date = normalizeDate(row?.date);
    if (!date) {
      issues.push({ date: row?.date ?? null, code: 'invalid-date' });
      continue;
    }
    if (byDate.has(date)) throw new Error(`The timetable contains a duplicate date: ${date}.`);
    const normalized = { date };
    for (const { key } of PRAYERS) {
      const time = row[key];
      normalized[key] = parseTime(time) === null ? null : time.trim();
      if (normalized[key] === null) issues.push({ date, key, code: 'missing-time' });
    }
    byDate.set(date, Object.freeze(normalized));
  }
  if (!byDate.size) throw new Error('No valid dated timetable entries are available.');
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    locationId, source, days, byDate, issues,
    firstDate: days[0].date, lastDate: days.at(-1).date,
    years: [...new Set(days.map(({ date }) => date.slice(0, 4)))],
  };
}

export function getDay(schedule, dateKey = getDateKey()) {
  const validDate = normalizeDate(dateKey);
  if (!validDate || !schedule) return null;
  return schedule.byDate?.get(validDate)
    ?? schedule.days?.find(({ date }) => date === validDate) ?? null;
}

export function getMonthRows(schedule, monthKey = getDateKey()?.slice(0, 7)) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey ?? '')) return [];
  return schedule?.days?.filter(({ date }) => date.startsWith(`${monthKey}-`)) ?? [];
}

/** Tomorrow uses tomorrow's row; missing dates never borrow another year's times. */
export function getNextPrayer(schedule, now = new Date()) {
  const nowTimestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const today = getDateKey(now);
  if (!today || !Number.isFinite(nowTimestamp)) return null;
  for (const dateKey of [today, addDays(today, 1)]) {
    const day = getDay(schedule, dateKey);
    if (!day) continue;
    for (const prayer of PRAYERS) {
      if (prayer.kind !== 'prayer') continue;
      const timestamp = prayerTimestamp(dateKey, day[prayer.key]);
      if (timestamp !== null && timestamp > nowTimestamp) {
        return {
          ...prayer, time: day[prayer.key], dateKey, timestamp,
          remainingMs: timestamp - nowTimestamp, isTomorrow: dateKey !== today,
        };
      }
    }
  }
  return null;
}

export function getPrayerStates(schedule, dateKey = getDateKey(), now = new Date()) {
  const day = getDay(schedule, dateKey);
  const next = getNextPrayer(schedule, now);
  const nowTimestamp = new Date(now).getTime();
  return PRAYERS.map((prayer) => {
    const time = day?.[prayer.key] ?? null;
    const timestamp = prayerTimestamp(dateKey, time);
    const status = timestamp === null ? 'unavailable'
      : next?.key === prayer.key && next.dateKey === dateKey ? 'next'
      : timestamp <= nowTimestamp ? 'passed' : 'upcoming';
    return { ...prayer, time, timestamp, status };
  });
}

const wordLabels = {
  tvm: 'Thiruvananthapuram', ekm: 'Ernakulam', uk: 'UK', kkpj: 'KKPJ',
  og: 'Original', hanafi: 'Hanafi', shafi: 'Shafi', calicut: 'Kozhikode',
};

export function humanizeLocation(id) {
  return String(id).replace(/_Assembly_Constituency/gi, '')
    .replace(/(?:^|_)(?:19|20)\d{2}(?=_|$)/g, '')
    .replace(/_+/g, ' ').trim().split(/\s+/)
    .map((word) => wordLabels[word.toLowerCase()]
      ?? (/^[A-Z]+$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word))
    .join(' ').replace(/\s+-\s*/g, ' · ');
}

function validLocationId(id) {
  return typeof id === 'string' && id.length > 0 && id.length < 200
    && !/[\\/\u0000-\u001f]/.test(id) && id !== '.' && id !== '..';
}

async function fetchJSON(url, { fetcher, signal, timeoutMs = REQUEST_TIMEOUT_MS }) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Loading cancelled.', 'AbortError');
  const controller = new AbortController();
  const timeoutError = new Error('The timetable request timed out. Please try again.');
  timeoutError.name = 'TimeoutError';
  let timer;
  const cancel = () => controller.abort(signal.reason ?? new DOMException('Loading cancelled.', 'AbortError'));
  try {
    const cancelled = new Promise((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => controller.abort(timeoutError),
        Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : REQUEST_TIMEOUT_MS);
    });
    const request = (async () => {
      const response = await fetcher(url, { signal: controller.signal, cache: 'no-cache' });
      if (!response.ok) throw new Error(`Timetable request failed (${response.status}).`);
      return response.json();
    })();
    // The race also bounds a stuck JSON body or a fetch implementation ignoring abort.
    return await Promise.race([request, cancelled]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function loadLocations({ fetcher = globalThis.fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const [idsResult, districtsResult] = await Promise.allSettled([
    fetchJSON('/v1/timesheets/index.json', { fetcher, signal, timeoutMs }),
    fetchJSON('/districts.json', { fetcher, signal, timeoutMs }),
  ]);
  if (idsResult.status === 'rejected') throw idsResult.reason;
  if (signal?.aborted) throw signal.reason ?? new Error('Loading cancelled.');
  if (!Array.isArray(idsResult.value)) throw new Error('The location index is unavailable.');
  const districts = districtsResult.status === 'fulfilled' ? districtsResult.value : {};
  const districtFor = new Map();
  for (const [district, data] of Object.entries(districts ?? {})) {
    for (const id of Array.isArray(data?.locations) ? data.locations : []) districtFor.set(id, district);
  }
  // Unlisted source names with explicit city names can still be grouped safely.
  districtFor.set('Chandrika_Calicut_2011', 'Kozhikode');
  districtFor.set('SAMASTHA_PALAKKAD_2022', 'Palakkad');
  // These constituency IDs were filed under the wrong district in legacy metadata.
  districtFor.set('Azhikode_Assembly_Constituency', 'Kannur');
  districtFor.set('Manalur_Assembly_Constituency', 'Thrissur');
  districtFor.set('Thiruvambady_Assembly_Constituency', 'Kozhikode');
  return [...new Set(idsResult.value.filter(validLocationId))].map((id) => {
    const label = humanizeLocation(id);
    const district = districtFor.get(id) ?? 'Other locations';
    const sourceYear = /(?:^|_)((?:19|20)\d{2})(?=_|$)/.exec(id)?.[1];
    const detail = [
      /_Assembly_Constituency/i.test(id) ? 'Assembly constituency' : '',
      sourceYear ? `Source: ${sourceYear}` : '',
    ].filter(Boolean).join(' · ');
    return { id, label, district, detail, searchText: `${label} ${district} ${id}`.toLowerCase() };
  }).sort((a, b) => a.label.localeCompare(b.label, 'en-IN'));
}

export async function loadSchedule(locationId, { fetcher = globalThis.fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  if (!validLocationId(locationId)) throw new Error('Choose a valid timetable location.');
  let lastError;
  for (const file of ['year.json', 'all.json']) {
    const source = `/v1/timesheets/${encodeURIComponent(locationId)}/${file}`;
    try {
      return normalizeSchedule(await fetchJSON(source, { fetcher, signal, timeoutMs }), locationId, source);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  if (lastError?.name === 'TimeoutError') throw lastError;
  throw new Error('This timetable could not be loaded. Please try again.', { cause: lastError });
}

export function getStored(key, fallback = null) {
  try {
    const value = globalThis.localStorage?.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch { return fallback; }
}

export function setStored(key, value) {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || !globalThis.localStorage) return false;
    globalThis.localStorage.setItem(key, serialized);
    return true;
  } catch { return false; }
}
