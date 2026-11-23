// Review page: recompute a timetable in the browser, show every step, and compare it
// with the times AzanTimes publishes.
import {
  IST_OFFSET_MINUTES, PRAYERS, asrAltitude, astronomicalTimes, formatMinutes, horizonDip, hourAngleMinutes,
  julianDay, perpetualBreakdown, perpetualYears, prayerTimes, resolveMethod, sunPosition,
} from './prayer-calc.js?v=6c154cf95166';
import { enhanceAll } from '../js/brand-controls.js?v=6c154cf95166';

const LABEL = { subh: 'Subh', sunrise: 'Sunrise', duhr: 'Dhuhr', asar: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const QUALITY = { exact: 'Fits', close: 'Within a minute', approximate: 'Within two minutes', irregular: 'Does not fit' };
const DEFAULT_LOCATION = 'Kozhikode_North_Assembly_Constituency';
const CONTACT = 'calculation@azantimes.in';
const MINUS = '−';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const state = { id: null, date: null, mode: 'table', month: 'all', onlyDiff: false, elevation: 0 };
let locations = {};
let published = { year: null, byDay: new Map(), rows: [] };

// ---------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------
const clock = (minutes) => formatMinutes(minutes) ?? '—';
function clockSeconds(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const total = ((Math.round(minutes * 60) % 86400) + 86400) % 86400;
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(mins).padStart(2, '0')}:${String(seconds).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}
function duration(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const total = Math.round(Math.abs(minutes) * 60);
  return `${Math.floor(total / 3600)} h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')} min ${String(total % 60).padStart(2, '0')} s`;
}
const number = (value, digits = 3) => (Number.isFinite(value) ? value.toFixed(digits).replace('-', MINUS) : '—');
const degrees = (value, digits = 3) => (Number.isFinite(value) ? `${number(value, digits)}°` : '—');
const signed = (value, digits = 0) => (Number.isFinite(value) ? `${value > 0 ? '+' : value < 0 ? MINUS : ''}${Math.abs(value).toFixed(digits)}` : '—');
const percent = (count, total) => (total ? `${(100 * count / total).toFixed(2)}%` : '—');
const humanize = (id) => id.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const dateLabel = ({ year, month, day }, withYear = true) => `${day} ${MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  const hours = Number(match[1]) % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return hours * 60 + Number(match[2]);
}
function todayInIndia() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function parseDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? { year, month, day } : null;
}

// ---------------------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------------------
// A calendar "follows" a rule when the rule reproduces it; its reference point was then
// recovered from it. Every other calendar is only checked at its town's map position.
const follows = (location) => location.coordinates === 'fitted';
function ruleLabel(location) {
  if (location.method === 'kerala-sunni-hanafi') return 'Kerala Sunni rule, Hanafi Asr';
  if (location.method === 'karachi') return 'Karachi 18°/18°';
  return 'Kerala Sunni rule';
}
function calculate(location, date, mode, extra = {}) {
  return prayerTimes({ ...date, latitude: location.latitude, longitude: location.longitude, method: location.method, perpetual: mode === 'table', ...extra });
}

/** Every intermediate value behind the six times for one date. */
function working(location, date, mode) {
  const method = resolveMethod(location.method);
  const { latitude, longitude } = location;
  const base = { ...date, latitude, longitude, method };
  const out = { method, mode, years: null, envelope: null, sourceYear: {}, prayers: {} };
  let instants;
  const sunFor = {};
  if (mode === 'table') {
    const breakdown = perpetualBreakdown(base);
    Object.assign(out, { years: breakdown.years, envelope: breakdown.envelope, sourceYear: breakdown.sourceYear });
    instants = breakdown.times;
    for (const prayer of PRAYERS) sunFor[prayer] = breakdown.envelope === 'latest' ? breakdown.years.find((entry) => entry.year === breakdown.sourceYear[prayer]) : null;
  } else {
    instants = astronomicalTimes(base);
    const jd = julianDay(date.year, date.month, date.day);
    for (const prayer of PRAYERS) sunFor[prayer] = Number.isFinite(instants[prayer]) ? sunPosition(jd + (instants[prayer] - IST_OFFSET_MINUTES) / 1440) : null;
  }
  const final = prayerTimes({ ...base, perpetual: mode === 'table' });
  for (const prayer of PRAYERS) {
    const sun = sunFor[prayer];
    const row = { instant: instants[prayer], offset: method.offsets[prayer] ?? 0, bias: method.bias ?? 0, final: final[prayer], sun, fixed: method.fixed?.[prayer] };
    if (sun) {
      row.noon = 720 - sun.equationOfTime - 4 * longitude + IST_OFFSET_MINUTES;
      if (prayer === 'subh') row.altitude = -method.fajrAngle;
      else if (prayer === 'sunrise' || prayer === 'maghrib') row.altitude = method.horizon;
      else if (prayer === 'asar') row.altitude = asrAltitude(latitude, sun.declination, method.asrFactor);
      else if (prayer === 'isha') row.altitude = Number.isFinite(method.ishaInterval) ? method.horizon : -method.ishaAngle;
      if (prayer !== 'duhr') row.hourAngle = hourAngleMinutes(latitude, sun.declination, row.altitude);
    }
    out.prayers[prayer] = row;
  }
  return out;
}

/** Compare every published day with the calculation. */
function compareYear(location, mode) {
  const rows = published.rows.map((row) => {
    const calculated = calculate(location, row.date, mode);
    const diff = {};
    for (const prayer of PRAYERS) diff[prayer] = Number.isFinite(row[prayer]) && Number.isFinite(calculated[prayer]) ? calculated[prayer] - row[prayer] : null;
    return { date: row.date, published: row, calculated, diff };
  });
  const stats = Object.fromEntries(PRAYERS.map((prayer) => [prayer, { cells: 0, same: 0, one: 0, more: 0, max: 0, sum: 0 }]));
  for (const row of rows) {
    for (const prayer of PRAYERS) {
      const value = row.diff[prayer];
      if (value === null) continue;
      const entry = stats[prayer];
      entry.cells += 1;
      entry.sum += value;
      if (value === 0) entry.same += 1;
      else if (Math.abs(value) === 1) entry.one += 1;
      else entry.more += 1;
      entry.max = Math.max(entry.max, Math.abs(value));
    }
  }
  const total = { cells: 0, same: 0, one: 0, more: 0, max: 0 };
  for (const entry of Object.values(stats)) {
    for (const key of ['cells', 'same', 'one', 'more']) total[key] += entry[key];
    total.max = Math.max(total.max, entry.max);
  }
  return { rows, stats, total };
}

// ---------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------
function differenceText(value) {
  if (value === null) return { text: 'No published time', className: 'off' };
  if (value === 0) return { text: 'Same minute', className: 'same' };
  const size = Math.abs(value);
  return { text: `Calculated ${size} min ${value > 0 ? 'later' : 'earlier'}`, className: size > 1 ? 'far' : 'off' };
}

function renderVerdict(location, date, comparison) {
  const key = `${date.month}-${date.day}`;
  const row = published.byDay.get(key);
  const calculated = calculate(location, date, state.mode);
  $('verdict-note').textContent = state.mode === 'table'
    ? `${humanize(state.id)}, ${dateLabel(date, false)}. "Calculated" is the table value: the time a perpetual timetable shows on this date every year.`
    : `${humanize(state.id)}, ${dateLabel(date)}. "Calculated" is for this exact date; the published timetable shows the same time every year.`;
  $('verdict-cards').innerHTML = PRAYERS.map((prayer) => {
    const publishedValue = row?.[prayer];
    const diff = Number.isFinite(publishedValue) && Number.isFinite(calculated[prayer]) ? calculated[prayer] - publishedValue : null;
    const verdict = differenceText(diff);
    return `<article class="card"><h3>${LABEL[prayer]}</h3><dl>
      <div><dt>Published</dt><dd>${escapeHtml(clock(publishedValue))}</dd></div>
      <div><dt>Calculated</dt><dd>${escapeHtml(clock(calculated[prayer]))}</dd></div></dl>
      <span class="verdict ${verdict.className}">${verdict.text}</span></article>`;
  }).join('');

  const { stats, total } = comparison;
  const days = comparison.rows.length;
  $('verdict-year').innerHTML = `<h3 style="margin-top:0">Across the whole published year${published.year ? ` (${published.year})` : ''}</h3>
    <dl class="stat-row">
      <div><dt>Times compared</dt><dd>${total.cells.toLocaleString('en-IN')}</dd></div>
      <div><dt>Same minute</dt><dd>${percent(total.same, total.cells)}</dd></div>
      <div><dt>One minute apart</dt><dd>${total.one.toLocaleString('en-IN')}</dd></div>
      <div><dt>More than one minute</dt><dd>${total.more.toLocaleString('en-IN')}</dd></div>
      <div><dt>Largest difference</dt><dd>${total.max} min</dd></div>
    </dl>
    <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Prayer</th><th scope="col" class="num">Days compared</th><th scope="col" class="num">Same minute</th><th scope="col" class="num">One minute apart</th><th scope="col" class="num">More</th><th scope="col" class="num">Largest</th><th scope="col" class="num">Average difference</th></tr></thead><tbody>
    ${PRAYERS.map((prayer) => `<tr><th scope="row">${LABEL[prayer]}</th><td class="num">${stats[prayer].cells}</td><td class="num">${stats[prayer].same} (${percent(stats[prayer].same, stats[prayer].cells)})</td><td class="num">${stats[prayer].one}</td><td class="num">${stats[prayer].more}</td><td class="num">${stats[prayer].max} min</td><td class="num">${stats[prayer].cells ? `${signed(stats[prayer].sum / stats[prayer].cells, 1)} min` : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="caption">${days} days, six times a day. ${state.mode === 'table' ? 'Each day is compared with the table value.' : `Each day is compared with the calculation for that exact date in ${published.year}.`} Average difference is calculated minus published. The day-by-day list is in section 5.</p>`;
}

function renderReference(location) {
  const method = resolveMethod(location.method);
  const fitted = follows(location);
  const noonOffset = (82.5 - location.longitude) * 4;
  const map = `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=12/${location.latitude}/${location.longitude}`;
  $('reference-place').innerHTML = `<h3 style="margin-top:0">Reference point</h3><dl class="kv">
    <dt>Timetable</dt><dd>${escapeHtml(humanize(state.id))}</dd>
    <dt>Latitude</dt><dd>${number(location.latitude, 3)}° N</dd>
    <dt>Longitude</dt><dd>${number(location.longitude, 3)}° E · <a href="${map}" target="_blank" rel="noopener noreferrer">see on a map</a></dd>
    <dt>Where it comes from</dt><dd>${fitted ? `Recovered from the timetable itself: the point at which the rule reproduces the most published times. It lies ${location.distanceFromPlaceKm} km from the map position of ${escapeHtml(location.place)}.` : `The map position of ${escapeHtml(location.place)}. Nothing was adjusted to fit this calendar.`}</dd>
    <dt>West of the IST meridian</dt><dd>${number(82.5 - location.longitude, 3)}°, so the sun is ${number(noonOffset, 1)} min later than at 82.5° E</dd>
    <dt>Agreement over 366 days</dt><dd><span class="pill ${location.quality}">${QUALITY[location.quality]}</span> ${location.fit.exactPercent}% same minute, ${location.fit.within1Percent}% within one minute, largest ${location.fit.maxError} min</dd>
  </dl>`;

  const margins = PRAYERS.map((prayer) => `${LABEL[prayer]} ${signed(method.offsets[prayer] ?? 0, Number.isInteger(method.offsets[prayer] ?? 0) ? 0 : 2)}`).join(' · ');
  const isha = Number.isFinite(method.ishaInterval)
    ? ['Isha', `${method.ishaInterval} min after sunset`, 'A fixed interval instead of a twilight angle.']
    : ['Isha angle', `${method.ishaAngle}° below the horizon`, 'Twilight has gone when the sun is this far down after sunset.'];
  const rows = [
    ['Subh angle', `${method.fajrAngle}° below the horizon`, 'Dawn begins when the sun is this far down before sunrise.'],
    isha,
    ['Asr shadow', `${method.asrFactor} × object length + noon shadow`, method.asrFactor === 2 ? 'Hanafi.' : 'Shafi\'i, Maliki and Hanbali.'],
    ['Sunrise and sunset', `Sun's centre at ${degrees(method.horizon)}`, 'Upper edge of the sun on the horizon, allowing for refraction.'],
    ['Minutes added', margins, 'Precaution added to each astronomical instant.'],
    ['Further allowance', `${signed((method.bias ?? 0) * 60, 0)} s`, 'Measured from the timetables; its origin is not documented.'],
    ['Rounding', method.rounding === 'up' ? 'Up to the next minute' : method.rounding === 'down' ? 'Down to the minute' : 'To the nearest minute', ''],
    ['Table value', method.envelope === 'mean' ? `Average of ${perpetualYears(1, 1, 'mean').join(', ')}` : 'Latest instant in any year, 2021 to 2099', 'How one row serves every year.'],
  ];
  if (method.fixed) rows.push(['Fixed clock time', Object.entries(method.fixed).map(([prayer, value]) => `${LABEL[prayer]} ${clock(value)}`).join(' · '), 'This timetable prints the same time all year.']);
  $('reference-method').innerHTML = `<h3 style="margin-top:0">${fitted ? 'Rule' : 'Rule checked'}: ${escapeHtml(ruleLabel(location))}</h3>
    <div class="table-wrap"><table class="grid plain"><thead><tr><th scope="col">Setting</th><th scope="col">Value</th><th scope="col">Meaning</th></tr></thead><tbody>
    ${rows.map(([name, value, meaning]) => `<tr><th scope="row">${name}</th><td>${escapeHtml(value)}</td><td>${escapeHtml(meaning)}</td></tr>`).join('')}</tbody></table></div>
    ${fitted ? '' : `<p class="caption">This calendar is only checked against the rule; it was not used to derive it. ${location.quality === 'exact' ? 'The rule fits it as it stands.' : 'Where it does not fit, the calendar was made by a different rule, and the average differences in section 1 show by how much.'}</p>`}`;
}

function prayerFormula(prayer, row, location) {
  const { sun } = row;
  if (Number.isFinite(row.fixed)) return `<p>This timetable prints ${LABEL[prayer]} at ${clock(row.fixed)} every day. Nothing is calculated.</p>`;
  if (!sun) return `<p>The table value is the average of the instants in the years listed in step 2: ${clockSeconds(row.instant)}.</p>`;
  const lat = number(location.latitude, 3);
  const dec = number(sun.declination, 4);
  const noonLine = `noon    = 12:00 + 4 × (82.5 ${MINUS} ${number(location.longitude, 3)}) ${MINUS} (${number(sun.equationOfTime, 3)})  min\n        = ${clockSeconds(row.noon)}`;
  if (prayer === 'duhr') return `<pre class="formula">${noonLine}\nDhuhr   = noon = ${clockSeconds(row.instant)}</pre>`;
  const lines = [];
  if (prayer === 'asar') {
    lines.push(`altitude = arccot(${row.method.asrFactor} + tan|${lat} ${MINUS} (${dec})|) = ${degrees(row.altitude, 4)}`);
  }
  const alt = number(row.altitude, 4);
  const before = prayer === 'subh' || prayer === 'sunrise';
  lines.push(`cos H   = (sin(${alt}) ${MINUS} sin(${lat}) × sin(${dec})) / (cos(${lat}) × cos(${dec}))`);
  lines.push(`H       = ${degrees(row.hourAngle / 4, 4)} = ${duration(row.hourAngle)}`);
  lines.push(noonLine);
  if (prayer === 'isha' && Number.isFinite(row.method.ishaInterval)) {
    lines.push(`sunset  = noon + H = ${clockSeconds(row.noon + row.hourAngle)}`);
    lines.push(`Isha    = sunset + ${row.method.ishaInterval} min = ${clockSeconds(row.instant)}`);
  } else {
    lines.push(`${LABEL[prayer].padEnd(7)} = noon ${before ? MINUS : '+'} H = ${clockSeconds(row.instant)}`);
  }
  return `<pre class="formula">${lines.join('\n')}</pre>`;
}

function renderWorking(location, date) {
  const detail = working(location, date, state.mode);
  for (const row of Object.values(detail.prayers)) row.method = detail.method;
  const row = published.byDay.get(`${date.month}-${date.day}`);
  const steps = [];

  // Step 1: the day
  const jd = julianDay(date.year, date.month, date.day);
  steps.push(`<div class="step"><h3><span class="n">1</span>The date</h3>${state.mode === 'table'
    ? `<p>A perpetual timetable gives ${dateLabel(date, false)} the same six times every year. The real instants shift a little from year to year, so the table value is taken across a span of years: ${detail.envelope === 'latest' ? 'the latest instant reached in any of them, so the time has entered whichever year the table is used in' : 'their average'}.</p><p>Years sampled: ${detail.years.map((entry) => entry.year).join(', ')}. ${detail.envelope === 'latest' ? 'Within a century the calendar drifts steadily against the sun, so the extremes of 2021 to 2099 fall in its first and last four years.' : ''}</p>`
    : `<p>${dateLabel(date)}. Astronomers count days continuously as the Julian Day; this date begins (at 00:00 UT) at Julian Day ${jd.toFixed(1)}. Each time below uses the sun's position at the moment of that event.</p>`}</div>`);

  // Step 2: sun position
  if (state.mode === 'table') {
    steps.push(`<div class="step"><h3><span class="n">2</span>The sun's position</h3>
      <p>Two numbers describe the sun: its <strong>declination</strong> (how far north or south of the equator it stands) and the <strong>equation of time</strong> (how many minutes the real sun is ahead of a steady clock). They are taken at 12:00 IST on ${dateLabel(date, false)} in each sampled year. The six columns on the right are the instants that follow from them, before any minutes are added.${detail.envelope === 'latest' ? ' The underlined value in each column is the latest, and is the one used.' : ''}</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Year</th><th scope="col" class="num">Declination</th><th scope="col" class="num">Equation of time</th>${PRAYERS.map((prayer) => `<th scope="col" class="num">${LABEL[prayer]}</th>`).join('')}</tr></thead><tbody>
      ${detail.years.map((entry) => `<tr><th scope="row">${entry.year}</th><td class="num">${degrees(entry.declination, 4)}</td><td class="num">${number(entry.equationOfTime, 3)} min</td>${PRAYERS.map((prayer) => `<td class="num"><span class="${detail.sourceYear[prayer] === entry.year ? 'latest' : ''}">${clockSeconds(entry.events[prayer])}</span></td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`);
  } else {
    steps.push(`<div class="step"><h3><span class="n">2</span>The sun's position</h3>
      <p>Two numbers describe the sun: its <strong>declination</strong> (how far north or south of the equator it stands) and the <strong>equation of time</strong> (how many minutes the real sun is ahead of a steady clock). Both change slowly through the day, so each is taken at the moment of the event.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">At</th><th scope="col" class="num">Declination</th><th scope="col" class="num">Equation of time</th></tr></thead><tbody>
      ${PRAYERS.map((prayer) => `<tr><th scope="row">${LABEL[prayer]}</th><td class="num">${degrees(detail.prayers[prayer].sun?.declination, 4)}</td><td class="num">${number(detail.prayers[prayer].sun?.equationOfTime, 3)} min</td></tr>`).join('')}
      </tbody></table></div></div>`);
  }

  // Step 3: solar noon
  const duhr = detail.prayers.duhr;
  steps.push(`<div class="step"><h3><span class="n">3</span>Solar noon</h3>
    <p>Indian Standard Time is set for longitude 82.5° E. Every degree west of it, the sun crosses overhead 4 minutes later. The equation of time then moves noon a few minutes either way.</p>
    ${duhr.sun ? `<pre class="formula">noon = 12:00 + 4 × (82.5 ${MINUS} longitude) ${MINUS} equation of time
     = 12:00 + 4 × (82.5 ${MINUS} ${number(location.longitude, 3)}) ${MINUS} (${number(duhr.sun.equationOfTime, 3)}) min
     = 12:00 + ${number((82.5 - location.longitude) * 4, 3)} ${MINUS} (${number(duhr.sun.equationOfTime, 3)}) min
     = ${clockSeconds(duhr.noon)}</pre>` : `<p>Average solar noon across the sampled years: ${clockSeconds(duhr.instant)}.</p>`}</div>`);

  // Step 4: each instant
  steps.push(`<div class="step"><h3><span class="n">4</span>From noon to each prayer</h3>
    <p>Every other prayer begins when the sun reaches a particular height. The <strong>hour angle</strong> H is how long before or after noon that happens. It depends on the height sought, the latitude (${number(location.latitude, 3)}°) and the declination.</p>
    <pre class="formula">cos H = (sin(height) ${MINUS} sin(latitude) × sin(declination)) / (cos(latitude) × cos(declination))
time  = noon ${MINUS} H  for Subh and sunrise;   noon + H  for Asr, Maghrib and Isha        (1° of H = 4 minutes)</pre>
    <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Prayer</th>${state.mode === 'table' && detail.envelope === 'latest' ? '<th scope="col" class="num">Year used</th>' : ''}<th scope="col" class="num">Sun's height sought</th><th scope="col" class="num">Hour angle H</th><th scope="col" class="num">H as time</th><th scope="col" class="num">Astronomical instant</th></tr></thead><tbody>
    ${PRAYERS.map((prayer) => { const item = detail.prayers[prayer]; return `<tr><th scope="row">${LABEL[prayer]}</th>${state.mode === 'table' && detail.envelope === 'latest' ? `<td class="num">${detail.sourceYear[prayer] ?? '—'}</td>` : ''}<td class="num">${prayer === 'duhr' ? 'highest point' : degrees(item.altitude, 3)}</td><td class="num">${prayer === 'duhr' ? '0°' : degrees(item.hourAngle / 4, 3)}</td><td class="num">${prayer === 'duhr' ? '—' : duration(item.hourAngle)}</td><td class="num">${clockSeconds(item.instant)}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${PRAYERS.map((prayer) => `<details><summary>${LABEL[prayer]} <small>with the numbers filled in</small></summary>${prayerFormula(prayer, detail.prayers[prayer], location)}</details>`).join('')}</div>`);

  // Step 5: margins and rounding
  steps.push(`<div class="step"><h3><span class="n">5</span>Minutes added, then rounding</h3>
    <p>The timetable does not print the bare instant. It adds the rule's minutes of precaution${detail.method.bias ? `, a further ${signed(detail.method.bias * 60, 0)} seconds,` : ''} and rounds ${detail.method.rounding === 'up' ? 'up to the next minute' : detail.method.rounding === 'down' ? 'down to the minute' : 'to the nearest minute'}.</p>
    <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Prayer</th><th scope="col" class="num">Astronomical instant</th><th scope="col" class="num">Minutes added</th><th scope="col" class="num">Allowance</th><th scope="col" class="num">Before rounding</th><th scope="col" class="num">Calculated</th><th scope="col" class="num">Published</th><th scope="col" class="num">Difference</th></tr></thead><tbody>
    ${PRAYERS.map((prayer) => {
    const item = detail.prayers[prayer];
    const publishedValue = row?.[prayer];
    const diff = Number.isFinite(publishedValue) && Number.isFinite(item.final) ? item.final - publishedValue : null;
    const cell = diff === null ? '' : diff === 0 ? '' : Math.abs(diff) > 1 ? 'far' : 'differ';
    const fixed = Number.isFinite(item.fixed);
    return `<tr><th scope="row">${LABEL[prayer]}</th><td class="num">${fixed ? 'fixed' : clockSeconds(item.instant)}</td><td class="num">${fixed ? '—' : `${signed(item.offset, Number.isInteger(item.offset) ? 0 : 2)} min`}</td><td class="num">${fixed ? '—' : `${signed(item.bias * 60, 0)} s`}</td><td class="num">${fixed ? '—' : clockSeconds(item.instant + item.offset + item.bias)}</td><td class="num"><strong>${clock(item.final)}</strong></td><td class="num">${clock(publishedValue)}</td><td class="num ${cell}">${diff === null ? '—' : diff === 0 ? 'same' : `${signed(diff)} min`}</td></tr>`;
  }).join('')}
    </tbody></table></div></div>`);

  $('working-steps').innerHTML = steps.join('');
  return detail;
}

function renderSunPath(location, date, detail) {
  const sun = detail.prayers.duhr.sun ?? detail.years?.[0];
  if (!sun) { $('sunpath-chart').innerHTML = ''; return; }
  const noon = 720 - sun.equationOfTime - 4 * location.longitude + IST_OFFSET_MINUTES;
  const rad = Math.PI / 180;
  const altitudeAt = (minutes) => Math.asin(Math.sin(location.latitude * rad) * Math.sin(sun.declination * rad)
    + Math.cos(location.latitude * rad) * Math.cos(sun.declination * rad) * Math.cos(((minutes - noon) / 4) * rad)) / rad;
  const width = 1000; const height = 400; const left = 56; const right = 16; const top = 26; const bottom = 44;
  const start = 240; const end = 1260; const low = -36; const high = Math.max(60, Math.ceil(altitudeAt(noon) / 10) * 10 + 8);
  const x = (minutes) => left + ((minutes - start) / (end - start)) * (width - left - right);
  const y = (altitude) => top + ((high - altitude) / (high - low)) * (height - top - bottom);
  const points = [];
  for (let minutes = start; minutes <= end; minutes += 5) points.push(`${x(minutes).toFixed(1)},${y(Math.max(low, altitudeAt(minutes))).toFixed(1)}`);
  const method = detail.method;
  // Dashed lines mark the height each rule looks for. The twilight angles are named on
  // their markers; only the Asr line carries its own label.
  const levels = [[-method.fajrAngle, '']];
  if (!Number.isFinite(method.ishaInterval)) levels.push([-method.ishaAngle, '']);
  const asr = detail.prayers.asar.altitude;
  if (Number.isFinite(asr)) levels.push([asr, `Asr shadow ${number(asr, 1)}°`]);
  const hours = [];
  for (let hour = 4; hour <= 21; hour += 1) hours.push(hour);
  const markers = PRAYERS.filter((prayer) => Number.isFinite(detail.prayers[prayer].instant)).map((prayer) => {
    const instant = detail.prayers[prayer].instant;
    const altitude = altitudeAt(instant);
    // Daytime labels sit above their dot; twilight labels sit below the curve, inside the night band.
    const twilight = prayer === 'subh' || prayer === 'isha';
    const labelY = twilight ? y(altitude) + 20 : prayer === 'duhr' || prayer === 'asar' ? y(altitude) - 30 : y(altitude) - 34;
    const anchor = prayer === 'subh' ? 'start' : prayer === 'isha' ? 'end' : 'middle';
    const dx = prayer === 'subh' ? 12 : prayer === 'isha' ? -12 : 0;
    const name = prayer === 'subh' ? `Subh ${MINUS}${method.fajrAngle}°` : prayer === 'isha' && !Number.isFinite(method.ishaInterval) ? `Isha ${MINUS}${method.ishaAngle}°` : LABEL[prayer];
    return `<line class="chart-drop" x1="${x(instant)}" y1="${y(altitude)}" x2="${x(instant)}" y2="${height - bottom}"/><circle class="chart-dot" cx="${x(instant)}" cy="${y(altitude)}" r="5.5"/><text class="chart-text" text-anchor="${anchor}" x="${x(instant) + dx}" y="${labelY}" font-weight="700">${name}</text><text class="chart-muted" text-anchor="${anchor}" x="${x(instant) + dx}" y="${labelY + 15}">${clockSeconds(instant)}</text>`;
  }).join('');
  $('sunpath-chart').innerHTML = `<div style="overflow-x:auto"><svg viewBox="0 0 ${width} ${height}" style="min-width:720px" role="img" aria-labelledby="sunpath-caption">
    <rect class="chart-night" x="${left}" y="${y(0)}" width="${width - left - right}" height="${height - bottom - y(0)}"/>
    ${[...Array(Math.floor((high - low) / 10) + 1)].map((_, index) => { const value = Math.ceil(low / 10) * 10 + index * 10; return value > high ? '' : `<line class="chart-axis" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/><text class="chart-muted" text-anchor="end" x="${left - 8}" y="${y(value) + 4}">${value === 0 ? '0°' : `${String(value).replace('-', MINUS)}°`}</text>`; }).join('')}
    ${hours.map((hour) => `<text class="chart-muted" text-anchor="middle" x="${x(hour * 60)}" y="${height - bottom + 20}">${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? ' am' : ' pm'}</text>`).join('')}
    ${levels.map(([value, label]) => `<line class="chart-level" x1="${left}" y1="${y(value)}" x2="${width - right}" y2="${y(value)}"/>${label ? `<text class="chart-muted" text-anchor="end" x="${width - right - 6}" y="${y(value) - 5}">${label}</text>` : ''}`).join('')}
    <line class="chart-horizon" x1="${left}" y1="${y(0)}" x2="${width - right}" y2="${y(0)}"/><text class="chart-muted" text-anchor="middle" x="${x(noon) + 70}" y="${y(0) + 17}">Below the horizon</text>
    <polyline class="chart-curve" points="${points.join(' ')}"/>
    ${markers}
  </svg></div>`;
  $('sunpath-caption').textContent = `Sun's height at ${humanize(state.id)} on ${dateLabel(date, state.mode !== 'table')}. It peaks at ${number(altitudeAt(noon), 1)}° at ${clockSeconds(noon)}. The dots are the astronomical instants from step 4, before minutes are added. The shaded band is below the horizon.`;
}

function renderDays(comparison, date) {
  const monthSelect = $('month');
  const selected = state.month;
  const rows = comparison.rows.filter((row) => (selected === 'all' || row.date.month === Number(selected))
    && (!state.onlyDiff || PRAYERS.some((prayer) => row.diff[prayer])));
  const cell = (row, prayer) => {
    const diff = row.diff[prayer];
    if (diff === null) return `<td>${escapeHtml(clock(row.published[prayer]))}${Number.isFinite(row.calculated[prayer]) && !Number.isFinite(row.published[prayer]) ? ` <span class="pair"><b>/ ${clock(row.calculated[prayer])}</b></span>` : ''}</td>`;
    if (diff === 0) return `<td>${clock(row.published[prayer])}</td>`;
    return `<td class="${Math.abs(diff) > 1 ? 'far' : 'differ'}"><span class="pair">${clock(row.published[prayer])} <b>/ ${clock(row.calculated[prayer])}</b></span><span class="delta">${signed(diff)}</span></td>`;
  };
  $('days-table').innerHTML = `<thead><tr><th scope="col">Date</th>${PRAYERS.map((prayer) => `<th scope="col">${LABEL[prayer]}</th>`).join('')}</tr></thead><tbody>
    ${rows.length ? rows.map((row) => `<tr class="${row.date.month === date.month && row.date.day === date.day ? 'current' : ''}"><th scope="row">${row.date.day} ${MONTHS[row.date.month - 1].slice(0, 3)}</th>${PRAYERS.map((prayer) => cell(row, prayer)).join('')}</tr>`).join('') : `<tr><td colspan="7">No day ${selected === 'all' ? 'in the year' : `in ${MONTHS[Number(selected) - 1]}`} differs.</td></tr>`}
    </tbody>`;
  monthSelect.value = selected;

  // A misprint stands out from its own column: its difference from the calculation is far
  // from that column's usual difference, whatever rule the calendar was made by.
  const usual = {};
  for (const prayer of PRAYERS) {
    const values = comparison.rows.map((row) => row.diff[prayer]).filter((value) => value !== null).sort((a, b) => a - b);
    usual[prayer] = values.length ? values[values.length >> 1] : 0;
  }
  const flagged = [];
  comparison.rows.forEach((row, index) => {
    for (const prayer of PRAYERS) {
      if (row.diff[prayer] !== null && Math.abs(row.diff[prayer] - usual[prayer]) >= 5) flagged.push({ row, prayer, before: comparison.rows[index - 1]?.published[prayer], after: comparison.rows[index + 1]?.published[prayer] });
    }
  });
  // A column that is out of line on many days is not misprinted; it follows another rule
  // (a fixed Dhuhr, say), so it is left out.
  const perPrayer = Object.fromEntries(PRAYERS.map((prayer) => [prayer, flagged.filter((entry) => entry.prayer === prayer).length]));
  const suspects = flagged.filter((entry) => perPrayer[entry.prayer] <= 40);
  $('suspects').innerHTML = suspects.length
    ? `<div class="panel" style="margin-top:16px"><h3 style="margin-top:0">Possible misprints in the published data</h3><p class="section-note">Each of these is 5 minutes or more out of line with the rest of its own column. Where the days on either side agree with each other but not with the entry, a typing error is likely. They need checking against the printed original.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th scope="col">Date</th><th scope="col">Prayer</th><th scope="col" class="num">Published</th><th scope="col" class="num">Expected about</th><th scope="col" class="num">Day before</th><th scope="col" class="num">Day after</th></tr></thead><tbody>
      ${suspects.slice(0, 60).map(({ row, prayer, before, after }) => `<tr><th scope="row">${row.date.day} ${MONTHS[row.date.month - 1].slice(0, 3)}</th><td>${LABEL[prayer]}</td><td class="num far">${clock(row.published[prayer])}</td><td class="num">${clock(row.calculated[prayer] - usual[prayer])}</td><td class="num">${clock(before)}</td><td class="num">${clock(after)}</td></tr>`).join('')}
      </tbody></table></div>${suspects.length > 60 ? `<p class="caption">${suspects.length - 60} more not shown; download the comparison for the full list.</p>` : ''}</div>`
    : '';
}

function renderMethods(location, date) {
  const row = published.byDay.get(`${date.month}-${date.day}`);
  const place = { latitude: location.latitude, longitude: location.longitude };
  const exact = (method, extra = {}) => prayerTimes({ ...date, ...place, method, ...extra });
  const entries = [
    ['Published by AzanTimes', row ?? {}, 'The timetable as published.'],
    [`${ruleLabel(location)}: table value`, calculate(location, date, 'table'), 'Valid every year.'],
    [`${ruleLabel(location)}: ${dateLabel(date)}`, calculate(location, date, 'date'), 'This exact date.'],
    ['True 20° and 18°, no minutes added', exact('astronomical'), 'The bare astronomical instants, Shafi\'i Asr.'],
    ['Karachi 18° / 18°', exact('karachi'), 'Default of IslamicFinder and many apps for Kerala.'],
    ['Muslim World League 18° / 17°', exact('mwl'), 'A common app setting.'],
    ['Kerala Sunni rule, Hanafi Asr', exact('kerala-sunni-hanafi'), 'Asr at twice the shadow length.'],
  ];
  if (state.elevation > 0) entries.push([`${ruleLabel(location)}, ${state.elevation} m above the horizon`, calculate(location, date, 'date', { elevation: state.elevation }), `Horizon ${number(horizonDip(state.elevation), 2)}° lower: earlier sunrise, later Maghrib.`]);
  const reference = entries[2][1];
  $('methods-table').innerHTML = `<thead><tr><th scope="col">Rule</th>${PRAYERS.map((prayer) => `<th scope="col">${LABEL[prayer]}</th>`).join('')}</tr></thead><tbody>
    ${entries.map(([name, times, note], index) => `<tr class="${index === 2 ? 'chosen' : ''}"><th scope="row" style="white-space:normal;min-width:210px">${escapeHtml(name)}<br><small style="font-weight:400;color:var(--muted)">${escapeHtml(note)}</small></th>${PRAYERS.map((prayer) => {
    const value = times[prayer];
    const diff = index > 2 && Number.isFinite(value) && Number.isFinite(reference[prayer]) ? value - reference[prayer] : null;
    return `<td>${clock(value)}${diff ? `<span class="delta">${signed(diff)}</span>` : ''}</td>`;
  }).join('')}</tr>`).join('')}</tbody>`;
  $('methods-caption').textContent = `Small numbers are minutes relative to the tinted row (this timetable's rule on ${dateLabel(date)}). Height is not part of any source timetable; enter one to see what it would change. It counts only when the horizon you can see is that far below you.`;
}

/** Fill the figures quoted in the page text from the measured agreement. */
function renderStats() {
  const all = Object.values(locations);
  const rule = all.filter((location) => follows(location) && String(location.method).startsWith('kerala-sunni'));
  const cells = rule.reduce((sum, location) => sum + location.fit.cells, 0);
  const exact = rule.reduce((sum, location) => sum + location.fit.cells * location.fit.exactPercent / 100, 0);
  const outside = rule.reduce((sum, location) => sum + Math.round(location.fit.cells * (100 - location.fit.within1Percent) / 100), 0);
  const set = (name, text) => { for (const node of document.querySelectorAll(`[data-stat="${name}"]`)) node.textContent = text; };
  set('calendar-count', String(all.length));
  set('rule-count', String(rule.length));
  set('rule-cells', cells.toLocaleString('en-GB'));
  set('rule-exact', `${(100 * exact / cells).toFixed(2)}%`);
  set('rule-within1', outside === 0 ? 'none differs' : `${outside.toLocaleString('en-IN')} differ`);
}

function renderAll() {
  renderStats();
  const groups = {};
  for (const location of Object.values(locations)) {
    const group = groups[location.quality] ?? (groups[location.quality] = { count: 0, cells: 0, exact: 0, within1: 0 });
    group.count += 1;
    group.cells += location.fit.cells;
    group.exact += location.fit.cells * location.fit.exactPercent / 100;
    group.within1 += location.fit.cells * location.fit.within1Percent / 100;
  }
  const blurb = {
    exact: 'At least 85% of times identical and 99% within one minute.',
    close: 'At least 97% of times within one minute.',
    approximate: 'At least 97% of times within two minutes.',
    irregular: 'Made by a different rule, or not by calculation.',
  };
  $('all-summary').innerHTML = ['exact', 'close', 'approximate', 'irregular'].filter((key) => groups[key]).map((key) => `<article class="card"><h3>${QUALITY[key]}</h3><dl><div><dt>Timetables</dt><dd>${groups[key].count}</dd></div></dl><p>${percent(groups[key].exact, groups[key].cells)} same minute, ${percent(groups[key].within1, groups[key].cells)} within one. ${blurb[key]}</p></article>`).join('');
  const rank = (location) => (follows(location) ? (location.method === 'karachi' ? 1 : 0) : 2);
  const ids = Object.keys(locations).sort((a, b) => rank(locations[a]) - rank(locations[b])
    || locations[b].fit.exactPercent - locations[a].fit.exactPercent || a.localeCompare(b));
  $('all-table').innerHTML = `<thead><tr><th scope="col">Timetable</th><th scope="col">Rule</th><th scope="col">Point used</th><th scope="col" class="num">Latitude</th><th scope="col" class="num">Longitude</th><th scope="col" class="num">Same minute</th><th scope="col" class="num">Within 1 min</th><th scope="col" class="num">Largest</th><th scope="col">Result</th></tr></thead><tbody>
    ${ids.map((id) => { const location = locations[id]; return `<tr class="pick ${id === state.id ? 'current' : ''}" data-id="${escapeHtml(id)}" tabindex="0"><th scope="row">${escapeHtml(humanize(id))}</th><td>${ruleLabel(location)}</td><td>${follows(location) ? `Recovered, ${location.distanceFromPlaceKm} km from town` : 'Town, not fitted'}</td><td class="num">${number(location.latitude, 3)}</td><td class="num">${number(location.longitude, 3)}</td><td class="num">${location.fit.exactPercent}%</td><td class="num">${location.fit.within1Percent}%</td><td class="num">${location.fit.maxError} min</td><td><span class="pill ${location.quality}">${QUALITY[location.quality]}</span></td></tr>`; }).join('')}
    </tbody>`;
}

function render() {
  const location = locations[state.id];
  const date = parseDate(state.date);
  if (!location || !date) return;
  const comparison = compareYear(location, state.mode);
  renderVerdict(location, date, comparison);
  renderReference(location);
  const detail = renderWorking(location, date);
  renderSunPath(location, date, detail);
  renderDays(comparison, date);
  renderMethods(location, date);
  renderAll();
  render.comparison = comparison;
}

// ---------------------------------------------------------------------------------------
// Data and events
// ---------------------------------------------------------------------------------------
function setStatus(message) {
  $('status').hidden = !message;
  $('status').textContent = message ?? '';
}

async function loadPublished(id) {
  published = { year: null, byDay: new Map(), rows: [] };
  try {
    const response = await fetch(`../v1/timesheets/${encodeURIComponent(id)}/year.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    for (const entry of await response.json()) {
      const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(entry.date ?? '');
      if (!match) continue;
      const date = { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
      const row = { date };
      for (const prayer of PRAYERS) row[prayer] = parseClock(entry[prayer]);
      published.rows.push(row);
      published.byDay.set(`${date.month}-${date.day}`, row);
      published.year = date.year;
    }
    setStatus(published.rows.length ? null : 'The published timetable for this place is empty.');
  } catch (error) {
    setStatus(`The published timetable for this place could not be loaded (${error.message}). The calculation is still shown; the comparison columns are empty.`);
  }
}

/** Point every contact link at an email that already names the view being discussed. */
function updateContactLinks() {
  const date = parseDate(state.date);
  if (!state.id || !date) return;
  const subject = `Prayer time calculation: ${humanize(state.id)}`;
  const body = [
    `Timetable: ${humanize(state.id)}`,
    `Date: ${dateLabel(date)}`,
    `Calculated as: ${state.mode === 'table' ? 'the table value (same every year)' : 'this exact date'}`,
    `Link: ${window.location.href}`,
    '',
    '',
  ].join('\n');
  const href = `mailto:${CONTACT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  for (const link of document.querySelectorAll('a[data-contact]')) link.href = href;
}

function syncUrl() {
  const params = new URLSearchParams({ location: state.id, date: state.date });
  if (state.mode !== 'table') params.set('mode', state.mode);
  history.replaceState(null, '', `${window.location.pathname}?${params}`);
  updateContactLinks();
}

async function selectLocation(id, { scroll = false } = {}) {
  state.id = id;
  $('location').value = id;
  await loadPublished(id);
  syncUrl();
  render();
  if (scroll) $('verdict').scrollIntoView();
}

function fillLocationSelect() {
  const groups = [
    ['Follow the Kerala Sunni rule', (location) => follows(location) && location.method !== 'karachi'],
    ['Follow Karachi 18°/18°', (location) => follows(location) && location.method === 'karachi'],
    ['Other calendars · checked against the rule, nothing fitted', (location) => !follows(location)],
  ];
  $('location').innerHTML = groups.map(([label, test]) => {
    const ids = Object.keys(locations).filter((id) => test(locations[id])).sort((a, b) => humanize(a).localeCompare(humanize(b)));
    return ids.length ? `<optgroup label="${label}">${ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(humanize(id))}${follows(locations[id]) ? '' : ` (${QUALITY[locations[id].quality].toLowerCase()})`}</option>`).join('')}</optgroup>` : '';
  }).join('');
  $('month').innerHTML = `<option value="all">All months</option>${MONTHS.map((name, index) => `<option value="${index + 1}">${name}</option>`).join('')}`;
}

function downloadCsv() {
  const comparison = render.comparison;
  if (!comparison) return;
  const header = ['date', ...PRAYERS.flatMap((prayer) => [`${prayer}_published`, `${prayer}_calculated`, `${prayer}_difference_min`])];
  const lines = comparison.rows.map((row) => [
    `${row.date.year}-${String(row.date.month).padStart(2, '0')}-${String(row.date.day).padStart(2, '0')}`,
    ...PRAYERS.flatMap((prayer) => [formatMinutes(row.published[prayer]) ?? '', formatMinutes(row.calculated[prayer]) ?? '', row.diff[prayer] ?? '']),
  ].join(','));
  const blob = new Blob([`${header.join(',')}\n${lines.join('\n')}\n`], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `azantimes-comparison-${state.id}-${state.mode}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function start() {
  enhanceAll();
  try {
    const response = await fetch('./locations.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    locations = (await response.json()).locations;
  } catch (error) {
    setStatus(`The calculation settings could not be loaded (${error.message}). Reload the page to try again.`);
    return;
  }
  fillLocationSelect();
  const params = new URLSearchParams(window.location.search);
  state.date = parseDate(params.get('date')) ? params.get('date') : todayInIndia();
  state.mode = params.get('mode') === 'date' ? 'date' : 'table';
  state.month = String(parseDate(state.date).month);
  $('date').value = state.date;
  document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
  const requested = params.get('location');
  const first = Object.hasOwn(locations, requested ?? '') ? requested : Object.hasOwn(locations, DEFAULT_LOCATION) ? DEFAULT_LOCATION : Object.keys(locations)[0];

  $('location').addEventListener('change', (event) => selectLocation(event.target.value));
  $('date').addEventListener('change', (event) => {
    if (!parseDate(event.target.value)) return;
    state.date = event.target.value;
    state.month = String(parseDate(state.date).month);
    syncUrl();
    render();
  });
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener('change', () => { state.mode = input.value; syncUrl(); render(); });
  }
  $('month').addEventListener('change', (event) => { state.month = event.target.value; render(); });
  $('only-diff').addEventListener('change', (event) => { state.onlyDiff = event.target.checked; render(); });
  $('elevation').addEventListener('input', (event) => {
    const value = Number(event.target.value);
    state.elevation = Number.isFinite(value) ? Math.min(4000, Math.max(0, value)) : 0;
    const location = locations[state.id];
    const date = parseDate(state.date);
    if (location && date) renderMethods(location, date);
  });
  $('download').addEventListener('click', downloadCsv);
  $('copy-link').addEventListener('click', async () => {
    const button = $('copy-link');
    try {
      await navigator.clipboard.writeText(window.location.href);
      button.textContent = 'Link copied';
    } catch (_) {
      button.textContent = 'Copy the address from the browser bar';
    }
    setTimeout(() => { button.textContent = 'Copy link to this view'; }, 2500);
  });
  const pick = (event) => {
    const row = event.target.closest('tr.pick');
    if (!row || (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    selectLocation(row.dataset.id, { scroll: true });
  };
  $('all-table').addEventListener('click', pick);
  $('all-table').addEventListener('keydown', pick);
  await selectLocation(first);
}

start();
