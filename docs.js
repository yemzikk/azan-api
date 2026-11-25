// Developer documentation at api.azantimes.in (pages from scripts/docs-pages.mjs): copy
// buttons, the language tabs on Quick start and the Try it console on each endpoint page.
// Try it requests this site's own /v2/ files and builds every element with textContent,
// so nothing in a response is ever read as HTML.
import { enhanceAll } from '/dashboard/js/brand-controls.js?v=ea18b2495fc4';

const API_BASE = 'https://api.azantimes.in';
const TIME_ZONE = 'Asia/Kolkata';
const LANGUAGE_KEY = 'azan-docs-language';
const PRAYERS = [['fajr', 'Subh'], ['sunrise', 'Sunrise'], ['dhuhr', 'Dhuhr'], ['asr', 'Asr'], ['maghrib', 'Maghrib'], ['isha', 'Isha']];
const SCHOOLS = { shafii: 'Shafi’i', hanafi: 'Hanafi' };
const TYPES = { 'assembly-constituency': 'Assembly constituency', calendar: 'Regional calendar' };
const BASES = { town: 'town centre', 'calculation-point': 'reference point of the timetable' };
const announcer = document.getElementById('copy-status');

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value === true ? '' : value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const pad = (value) => String(value).padStart(2, '0');
const keralaDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
const formatSize = (bytes) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const formatDate = (date, options) => new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

// ---------------------------------------------------------------------------------------
// Copy buttons: data-copy names an element to copy, data-copy-text holds the text itself.
// ---------------------------------------------------------------------------------------
async function copy(button) {
  const target = button.dataset.copy ? document.getElementById(button.dataset.copy) : null;
  const text = button.dataset.copyText ?? target?.textContent ?? '';
  const label = button.querySelector('span') ?? button;
  label.dataset.label ??= label.textContent;
  try {
    await navigator.clipboard.writeText(text);
    label.textContent = 'Copied';
    announcer.textContent = 'Copied to clipboard.';
  } catch {
    // Without clipboard permission, select the text so the keyboard can copy it.
    if (target) {
      const range = document.createRange();
      range.selectNodeContents(target);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }
    label.textContent = target ? 'Text selected' : 'Copy blocked';
    announcer.textContent = target ? 'Copy is not available here. The text is selected; copy it with the keyboard.' : 'Copy is not available in this browser.';
  }
  clearTimeout(button.resetLabel);
  button.resetLabel = setTimeout(() => { label.textContent = label.dataset.label; }, 2000);
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-copy], [data-copy-text]');
  if (button) copy(button);
});

// ---------------------------------------------------------------------------------------
// Language tabs, remembered across pages
// ---------------------------------------------------------------------------------------
function setupTabs(root) {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const copyButton = root.querySelector('[data-copy-tabs]');
  function select(key, { focus = false, remember = true } = {}) {
    for (const tab of tabs) {
      const active = tab.dataset.tab === key;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      root.querySelector(`[data-panel="${tab.dataset.tab}"]`).hidden = !active;
      if (active && focus) tab.focus();
    }
    if (copyButton) copyButton.dataset.copy = `code-${key}`;
    if (remember) {
      try { localStorage.setItem(LANGUAGE_KEY, key); } catch { /* Private browsing: keep it for this page. */ }
    }
  }
  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) select(tab.dataset.tab);
  });
  root.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(document.activeElement);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (index < 0 || next === undefined) return;
    event.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length].dataset.tab, { focus: true });
  });
  let saved = null;
  try { saved = localStorage.getItem(LANGUAGE_KEY); } catch { /* Storage blocked: use the first tab. */ }
  if (tabs.some((tab) => tab.dataset.tab === saved)) select(saved, { remember: false });
}

// ---------------------------------------------------------------------------------------
// Try it
// ---------------------------------------------------------------------------------------
const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],])/g;

/** Pretty-printed JSON as highlighted lines, built from text nodes. */
function jsonLines(data) {
  const fragment = document.createDocumentFragment();
  const lines = JSON.stringify(data, null, 2).split('\n');
  lines.forEach((line, index) => {
    const row = el('span', { class: 'line' });
    let last = 0;
    for (const match of line.matchAll(TOKEN)) {
      if (match.index > last) row.append(line.slice(last, match.index));
      if (match[1] && match[2]) row.append(el('span', { class: 't-k' }, match[1]), el('span', { class: 't-p' }, match[2]));
      else if (match[1]) row.append(el('span', { class: 't-s' }, match[1]));
      else if (match[3] || match[4]) row.append(el('span', { class: 't-n' }, match[3] ?? match[4]));
      else row.append(el('span', { class: 't-p' }, match[5]));
      last = match.index + match[0].length;
    }
    if (last < line.length) row.append(line.slice(last));
    fragment.append(row);
    if (index < lines.length - 1) fragment.append('\n');
  });
  return fragment;
}

function dayPreview(data, kind) {
  const [, month, day] = keralaDate().split('-').map(Number);
  let entry;
  let label;
  let lookup;
  if (kind === 'perpetual') {
    entry = data.days.find((item) => item.month === month && item.day === day);
    label = `${formatDate(`2000-${pad(month)}-${pad(day)}`, { day: 'numeric', month: 'long' })}, any year`;
    lookup = `days.find((d) => d.month === ${month} && d.day === ${day})`;
  } else {
    // 29 February falls back to 28 February outside leap years.
    const wanted = `${data.year}-${pad(month)}-${pad(day)}`;
    entry = data.days.find((item) => item.date === wanted) ?? data.days.find((item) => item.date === `${data.year}-02-28` && month === 2);
    const date = entry?.date ?? wanted;
    label = formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    lookup = `days.find((d) => d.date === '${date}')`;
  }
  if (!entry) return el('p', { class: 'muted' }, 'This file has no entry for today.');
  const { location } = data;
  return el('div', {},
    el('p', { class: 'pv-note' }, 'Today’s entry, found with ', el('code', {}, lookup)),
    el('div', { class: 'pv-card' },
      el('div', { class: 'pv-head' },
        el('div', {}, el('div', { class: 'pv-name' }, location.name), el('div', { class: 'pv-sub' }, [location.district, label].filter(Boolean).join(' · '))),
        el('div', { class: 'pv-pills' }, el('span', { class: 'pill' }, TYPES[location.type] ?? location.type), el('span', { class: 'pill pill-g' }, SCHOOLS[location.school] ?? location.school))),
      el('div', { class: 'pv-times' }, ...PRAYERS.map(([key, name]) => el('div', { class: 'pv-time' }, el('span', {}, name), el('strong', {}, entry[key] ?? 'Not listed'), el('code', {}, key)))),
      el('p', { class: 'pv-foot' }, data.attribution)));
}

function rows(entries) {
  return el('dl', { class: 'pv-rows' }, ...entries.map(([term, value]) => el('div', { class: 'pv-row' }, el('dt', {}, term), el('dd', {}, value))));
}

function locationPreview(data) {
  const source = data.source ?? {};
  const point = data.coordinates;
  return rows([
    ['Name', data.name],
    ['Type', TYPES[data.type] ?? data.type],
    ['District', data.district ?? 'Not set'],
    ['School', SCHOOLS[data.school] ?? data.school],
    ['Source', source.year ? `${source.name}, ${source.year}` : source.name],
    ['Coordinates', point ? `${point.latitude}, ${point.longitude} (${BASES[point.basis] ?? point.basis})` : 'Not available'],
    ['Years', data.years ? `${data.years.first} to ${data.years.last}, and perpetual` : 'Any year'],
    ['Dashboard', data.links?.dashboard ? el('a', { href: data.links.dashboard }, data.links.dashboard.replace(/^https:\/\//, '')) : 'Not available'],
  ]);
}

function listPreview(data) {
  const body = el('tbody', {}, ...data.locations.map((location) => el('tr', {},
    el('th', { scope: 'row' }, location.name),
    el('td', {}, el('code', { class: 'mono' }, location.id)),
    el('td', {}, location.district ?? ''),
    el('td', {}, SCHOOLS[location.school] ?? location.school))));
  return el('div', {},
    el('p', { class: 'pv-note' }, `${data.locations.length} timetables, sorted by name.`),
    el('div', { class: 'tw' }, el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, ...['Name', 'id', 'District', 'School'].map((heading) => el('th', { scope: 'col' }, heading)))),
      body)));
}

function indexPreview(data) {
  return rows([
    ['Version', data.version],
    ['Data version', data.dataVersion],
    ['Years', `${data.years.first} to ${data.years.last}`],
    ['Timetables', String(data.locationCount)],
    ['Time zone', `${data.timeZone}, UTC${data.utcOffset}`],
    ['Prayer keys', data.prayers.map((prayer) => prayer.key).join(', ')],
    ['Licence', data.licence?.name ?? ''],
  ]);
}

function previewFor(kind, data) {
  if (kind === 'year' || kind === 'perpetual') return dayPreview(data, kind);
  if (kind === 'location') return locationPreview(data);
  if (kind === 'locations') return listPreview(data);
  return indexPreview(data);
}

function setupTry(section) {
  const kind = section.dataset.try;
  const template = section.dataset.path;
  const form = section.querySelector('[data-try-form]');
  const idSelect = form.querySelector('[name="id"]');
  const yearSelect = form.querySelector('[name="year"]');
  const panel = section.querySelector('.console');
  const url = section.querySelector('[data-try-url]');
  const copyUrl = section.querySelector('[data-try-copy]');
  const open = section.querySelector('[data-try-open]');
  const status = section.querySelector('[data-try-status]');
  const jsonBox = section.querySelector('[data-try-json]');
  const code = jsonBox.querySelector('code');
  const preview = section.querySelector('[data-try-preview]');
  const error = section.querySelector('[data-try-error]');
  const views = [...section.querySelectorAll('[data-view]')];
  let controller = null;

  // Start with this year in Kerala, when the API has it.
  if (yearSelect) {
    const year = keralaDate().slice(0, 4);
    if ([...yearSelect.options].some((option) => option.value === year)) yearSelect.value = year;
  }

  const path = () => template
    .replace('{id}', encodeURIComponent(idSelect?.value ?? ''))
    .replace('{year}', yearSelect?.value ?? '');

  function showPath(current) {
    const parts = current.split('/');
    url.replaceChildren(el('span', { class: 'base' }, API_BASE), ...parts.flatMap((part, index) => (index < parts.length - 1 ? [`${part}/`, el('wbr')] : [part])));
    copyUrl.dataset.copyText = `${API_BASE}${current}`;
    open.href = current;
  }

  function setView(view) {
    for (const button of views) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    jsonBox.hidden = view !== 'json';
    preview.hidden = view !== 'preview';
  }

  async function send() {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const current = path();
    showPath(current);
    error.hidden = true;
    panel.setAttribute('aria-busy', 'true');
    status.dataset.state = '';
    status.textContent = 'Sending request…';
    const started = performance.now();
    const timer = setTimeout(() => request.abort('timeout'), 15000);
    try {
      const response = await fetch(current, { signal: request.signal, headers: { Accept: 'application/json' } });
      const text = await response.text();
      if (!response.ok) throw new Error(`The server returned HTTP ${response.status}. Check the id and the year.`);
      if (!(response.headers.get('content-type') ?? '').includes('json')) throw new Error('The server returned a page instead of JSON. This file may not exist.');
      const data = JSON.parse(text);
      if (controller !== request) return;
      code.replaceChildren(jsonLines(data));
      jsonBox.scrollTop = 0;
      preview.replaceChildren(previewFor(kind, data));
      const records = Array.isArray(data.days) ? `${data.days.length} days` : Array.isArray(data.locations) ? `${data.locations.length} timetables` : null;
      status.textContent = [`${response.status} OK`, records, formatSize(new Blob([text]).size), `${Math.round(performance.now() - started)} ms`].filter(Boolean).join(' · ');
      status.dataset.state = 'ok';
    } catch (problem) {
      // A newer request replaced this one.
      if (controller !== request) return;
      const timedOut = request.signal.aborted && request.signal.reason === 'timeout';
      code.replaceChildren();
      preview.replaceChildren();
      error.textContent = timedOut ? 'The request timed out. Check your connection and try again.'
        : problem instanceof SyntaxError ? 'The response could not be read as JSON.'
          : problem instanceof TypeError ? 'Could not connect to the API. Check your connection and try again.'
            : problem.message;
      error.hidden = false;
      status.textContent = 'Request failed';
      status.dataset.state = 'error';
    } finally {
      clearTimeout(timer);
      if (controller === request) panel.setAttribute('aria-busy', 'false');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    send();
  });
  form.addEventListener('change', () => send());
  for (const button of views) button.addEventListener('click', () => setView(button.dataset.view));
  setView('json');
  send();
}

// ---------------------------------------------------------------------------------------
// Sidebar position, kept from page to page (restored by an inline script in each page)
// ---------------------------------------------------------------------------------------
const sidebar = document.querySelector('.side-in');
if (sidebar) {
  let timer;
  const save = () => {
    try { sessionStorage.setItem('azan-docs-sidebar', String(Math.round(sidebar.scrollTop))); } catch { /* Storage blocked: start at the top. */ }
  };
  sidebar.addEventListener('scroll', () => {
    clearTimeout(timer);
    timer = setTimeout(save, 100);
  }, { passive: true });
  // Save before following a link, so the next page opens with the same position.
  sidebar.addEventListener('click', save);
  addEventListener('pagehide', save);
}

enhanceAll();
document.querySelectorAll('[data-tabs]').forEach(setupTabs);
document.querySelectorAll('[data-try]').forEach(setupTry);
