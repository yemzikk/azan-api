import {
  TIME_ZONE, PRAYERS, getDateKey, addDays, formatDate, formatTime,
  getDay, getNextPrayer, getPrayerStates, getMonthRows,
  loadLocations, loadSchedule, getStored, setStored, normalizeDate,
} from './prayer-data.js';
import { PrayerNotifications } from './notifications.js';
import { createExportSelection, createExportCSV } from './export-data.js';

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icon = (name, extra = '') => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const saved = getStored('azan-favorites', []);
const state = {
  locations: [], location: null, schedule: null, period: 'day', date: getDateKey(),
  today: getDateKey(), favorites: new Set(Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : []),
  savedOnly: false, use24Hour: getStored('azan-time-format') === '24',
  controller: null, nextKey: null, installPrompt: null, exportContext: null, activeAlert: null,
};
const notifications = new PrayerNotifications({
  onStatus: (status) => updateReminderStatus(status),
  onAlert: (alert) => showPrayerAlert(alert),
});
const prayerIcons = { subh: 'moon', sunrise: 'sunrise', duhr: 'sun', asar: 'afternoon', maghrib: 'sunset', isha: 'moon' };
const prayerCaptions = { subh: 'Dawn prayer', sunrise: 'End of Fajr time', duhr: 'Midday prayer', asar: 'Afternoon prayer', maghrib: 'Sunset prayer', isha: 'Night prayer' };
const aliases = { kochi: 'Ernakulam_Shafi', cochin: 'Ernakulam_Shafi', ernakulam: 'Ernakulam_Shafi', kozhikode: 'MARKAZ_CALICUT_2025', calicut: 'MARKAZ_CALICUT_2025', kannur: 'Kannur_Assembly_Constituency', thalassery: 'Thalassery_Assembly_Constituency', thiruvananthapuram: 'T_V_M__shafi__standard_to_thambaanur', trivandrum: 'T_V_M__shafi__standard_to_thambaanur' };
const toSlug = (id) => id.toLowerCase().replace(/_/g, '-');
let toastTimer;
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
function info(title, html) {
  $('info-title').textContent = title; $('info-content').innerHTML = html;
  if (!$('info-dialog').open) $('info-dialog').showModal();
}
function setTheme(theme) {
  theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#131c18' : '#f8f9f5';
  $('theme-select').value = theme; $('theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`);
  $('theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  document.querySelector('.product-badge').src = `./brand/zikklabs-product-badge${theme === 'dark' ? '-light' : ''}.svg`;
  document.querySelector('.brand-logo').src = `./brand/azantimes-logo${theme === 'dark' ? '-light' : ''}.svg`;
  setStored('azan-theme', theme);
}
function updateSaved() {
  const active = state.location && state.favorites.has(state.location.id);
  $('save-location').setAttribute('aria-pressed', String(Boolean(active)));
  $('save-location').setAttribute('aria-label', active ? 'Remove saved location' : 'Save this location');
  $('saved-count').textContent = state.favorites.size;
  $('filter-saved-count').textContent = state.favorites.size;
}
function showLocations(savedOnly = false) {
  state.savedOnly = savedOnly; $('location-search').value = ''; $('district-filter').value = '';
  renderLocations(); $('location-dialog').showModal(); $('location-search').focus();
}
function renderLocations() {
  const query = $('location-search').value.toLowerCase().trim();
  const district = $('district-filter').value;
  const filtered = state.locations.filter((location) => (!state.savedOnly || state.favorites.has(location.id)) && (!district || location.district === district) && (!query || location.searchText.includes(query)));
  for (const [id, active] of [['filter-all', !state.savedOnly], ['filter-saved', state.savedOnly]]) {
    $(id).classList.toggle('active', active); $(id).setAttribute('aria-pressed', String(active));
  }
  $('location-results').innerHTML = filtered.length ? filtered.map((location) => `<button class="location-result ${state.location?.id === location.id ? 'selected' : ''}" data-location="${escapeHTML(location.id)}">${icon('location')}<span><strong>${escapeHTML(location.label)}</strong><small>${escapeHTML([location.district, location.detail].filter(Boolean).join(' · '))}</small></span>${state.location?.id === location.id ? icon('check', 'selected-check') : state.favorites.has(location.id) ? icon('bookmark') : ''}</button>`).join('') : `<p class="empty-locations">${state.savedOnly ? 'No saved locations match. Save a location using the bookmark beside its name.' : 'No locations match. Try a town name or choose another district.'}</p>`;
  $('location-result-count').textContent = `${filtered.length} timetable${filtered.length === 1 ? '' : 's'} available`;
}
function locationFromURL() {
  const params = new URLSearchParams(location.search);
  const query = params.get('q');
  let path;
  try { path = decodeURIComponent(location.pathname).replace(/^\/dashboard\/?/, '').replace(/^\/+|\/+$/g, ''); } catch { path = ''; }
  const candidate = query || (path && path !== 'index.html' ? path : '');
  if (!candidate) return null;
  const alias = aliases[candidate.toLowerCase()];
  return state.locations.find(({ id }) => id === candidate || toSlug(id) === candidate.toLowerCase() || id === alias) ?? null;
}
function updateURL(id) {
  const url = new URL(location.href); url.searchParams.set('q', id);
  // Canonicalize pretty paths when changing cities, so a shared URL has one location.
  url.pathname = location.pathname.startsWith('/dashboard/') ? '/dashboard/' : '/';
  history.pushState({ location: id, date: state.date, period: state.period }, '', url);
}
async function selectLocation(id, update = true) {
  const nextLocation = state.locations.find((entry) => entry.id === id);
  if (!nextLocation) return;
  state.controller?.abort(); state.controller = new AbortController();
  const controller = state.controller;
  state.location = nextLocation; state.schedule = null; state.nextKey = null;
  $('location-name').textContent = nextLocation.label;
  $('location-detail').textContent = `${nextLocation.district}, India`;
  $('hero-location').textContent = nextLocation.label;
  $('next-name').textContent = 'One moment'; $('next-time').textContent = '—';
  for (const part of ['hours', 'minutes', 'seconds']) $(`count-${part}`).textContent = '--';
  $('schedule-content').innerHTML = '<div class="schedule-placeholder">Loading your local timetable…</div>';
  $('schedule-content').setAttribute('aria-busy', 'true'); $('next-prayer-card').setAttribute('aria-busy', 'true');
  $('error-panel').hidden = true;
  updateSaved();
  if (update) updateURL(id);
  setStored('azan-location', id);
  try {
    const schedule = await loadSchedule(id, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.schedule = schedule;
    $('source-note').textContent = `Local timetable · ${schedule.years.join(', ')}`;
    renderSchedule(); tick(); updateConnection();
  } catch (error) {
    if (controller.signal.aborted) return;
    $('error-panel').hidden = false; $('error-message').textContent = error.message;
    $('schedule-content').innerHTML = '<div class="schedule-placeholder">Timetable unavailable. Choose another location or try again.</div>';
    $('next-name').textContent = 'Unavailable'; $('next-time').textContent = '';
  } finally {
    if (!controller.signal.aborted) {
      $('schedule-content').setAttribute('aria-busy', 'false'); $('next-prayer-card').setAttribute('aria-busy', 'false');
    }
  }
}
function displayTime(raw) { return formatTime(raw, state.use24Hour); }
function timeHTML(raw) {
  const value = displayTime(raw);
  const [time, suffix] = value.split(' ');
  return `${escapeHTML(time)}${suffix ? ` <small>${escapeHTML(suffix)}</small>` : ''}`;
}
function selectedRows() {
  if (!state.schedule) return [];
  if (state.period === 'day') return [getDay(state.schedule, state.date)].filter(Boolean);
  if (state.period === 'month') return getMonthRows(state.schedule, state.date.slice(0, 7));
  return state.schedule.days.filter((day) => day.date.startsWith(state.date.slice(0, 4)));
}
function updateDateInput() {
  const input = $('schedule-date');
  input.type = state.period === 'day' ? 'date' : state.period === 'month' ? 'month' : 'number';
  input.value = state.period === 'day' ? state.date : state.period === 'month' ? state.date.slice(0, 7) : state.date.slice(0, 4);
  input.setAttribute('aria-label', `Choose schedule ${state.period === 'day' ? 'date' : state.period}`);
  if (input.type === 'number') { input.min = '1900'; input.max = '2200'; input.step = '1'; } else { input.removeAttribute('min'); input.removeAttribute('max'); }
  $('previous-date').setAttribute('aria-label', `Previous ${state.period}`);
  $('next-date').setAttribute('aria-label', `Next ${state.period}`);
}
function renderSchedule() {
  updateDateInput();
  document.querySelectorAll('[data-period]').forEach((button) => {
    const active = button.dataset.period === state.period;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  for (const [id, active] of [['nav-prayers', state.period === 'day'], ['nav-calendar', state.period !== 'day']]) {
    $(id).classList.toggle('active', active);
    active ? $(id).setAttribute('aria-current', 'page') : $(id).removeAttribute('aria-current');
  }
  if (!state.schedule) return;
  const viewURL = new URL(location.href);
  state.date === state.today ? viewURL.searchParams.delete('date') : viewURL.searchParams.set('date', state.date);
  state.period === 'day' ? viewURL.searchParams.delete('view') : viewURL.searchParams.set('view', state.period);
  history.replaceState({ location: state.location.id, date: state.date, period: state.period }, '', viewURL);
  const rows = selectedRows();
  const isToday = state.date === state.today;
  const dateLabel = state.period === 'year' ? state.date.slice(0, 4) : state.period === 'month'
    ? new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: TIME_ZONE }).format(new Date(`${state.date.slice(0, 7)}-01T12:00:00+05:30`))
    : formatDate(state.date, { weekday: 'long', day: 'numeric', month: 'long', year: undefined });
  $('schedule-subtitle').textContent = `${state.period === 'day' && isToday ? 'Today · ' : ''}${dateLabel}`;
  if (!rows.length) {
    $('schedule-content').innerHTML = `<div class="schedule-placeholder">No timetable is published for ${escapeHTML(dateLabel)}.<br>Available dates: ${escapeHTML(formatDate(state.schedule.firstDate, { weekday: undefined }))} – ${escapeHTML(formatDate(state.schedule.lastDate, { weekday: undefined }))}.</div>`;
  } else if (state.period === 'day') {
    $('schedule-content').innerHTML = `<div class="prayer-grid">${getPrayerStates(state.schedule, state.date).map((prayer) => `<article class="prayer-card ${prayer.status === 'next' ? 'is-next' : prayer.status === 'passed' ? 'is-passed' : ''}" data-prayer="${prayer.key}">${prayer.status === 'next' ? '<span class="next-indicator"><span class="status-dot"></span> UP NEXT</span>' : ''}<span class="prayer-icon">${icon(prayerIcons[prayer.key])}</span><h3>${prayer.label}</h3><span class="prayer-time">${timeHTML(prayer.time)}</span><span class="prayer-caption">${prayer.time ? prayerCaptions[prayer.key] : 'Time unavailable'}</span></article>`).join('')}</div>`;
  } else {
    $('schedule-content').innerHTML = `<div class="table-wrap" role="region" aria-label="${escapeHTML(dateLabel)} prayer timetable" tabindex="0"><table><caption class="sr-only">Prayer start times for ${escapeHTML(state.location.label)}, ${escapeHTML(dateLabel)}, Indian Standard Time</caption><thead><tr><th scope="col">Date</th>${PRAYERS.map(({ label }) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${rows.map((day) => `<tr class="${day.date === state.today ? 'is-today' : ''}"><th scope="row"><button class="table-date-button" data-select-date="${day.date}">${escapeHTML(formatDate(day.date, { weekday: 'short', day: 'numeric', month: 'short', year: undefined }))}${day.date === state.today ? '<span class="table-today">TODAY</span>' : ''}</button></th>${PRAYERS.map(({ key }) => `<td>${escapeHTML(displayTime(day[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
}
function setPeriod(period) { state.period = period; renderSchedule(); }
function moveDate(amount) {
  if (state.period === 'day') state.date = addDays(state.date, amount);
  else {
    const date = new Date(`${state.date.slice(0, 7)}-01T12:00:00Z`);
    if (state.period === 'month') date.setUTCMonth(date.getUTCMonth() + amount);
    else date.setUTCFullYear(date.getUTCFullYear() + amount);
    state.date = date.toISOString().slice(0, 10);
  }
  renderSchedule();
}
function updateConnection() {
  const messages = [];
  if (!navigator.onLine) messages.push('You’re offline. Showing timetables already saved on this device.');
  if (state.schedule && !getDay(state.schedule, state.today)) messages.push(`No timetable is published for today. This source covers ${state.schedule.years.join(', ')}. Choose a published date to browse.`);
  $('connection-status').textContent = messages.join(' '); $('connection-status').hidden = !messages.length;
}
function updateReminderStatus(status = notifications.status()) {
  $('enable-reminders').textContent = status.reasonCode === 'install-required' ? 'How to install' : status.enabled ? 'Turn off' : 'Enable reminders';
  $('enable-reminders').disabled = !status.supported && status.reasonCode !== 'install-required';
  $('reminder-status').textContent = status.reason;
  $('test-notification').disabled = !status.supported || status.permission === 'denied';
}
function tick() {
  const now = new Date(); const nextToday = getDateKey(now);
  if (nextToday !== state.today) {
    if (state.date === state.today) state.date = nextToday;
    state.today = nextToday; renderSchedule(); updateConnection();
  }
  $('live-clock').textContent = new Intl.DateTimeFormat('en-IN', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: !state.use24Hour }).format(now);
  $('today-label').textContent = formatDate(state.today, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  try { $('hijri-label').textContent = new Intl.DateTimeFormat('en-IN-u-ca-islamic-umalqura', { timeZone: TIME_ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(now) + ' · estimated'; } catch { /* Calendar unsupported on older browsers. */ }
  const next = state.schedule ? getNextPrayer(state.schedule, now) : null;
  if (state.schedule) {
    $('next-name').textContent = next?.label ?? 'No timetable';
    $('next-time').textContent = next ? displayTime(next.time) : '';
    $('next-day-label').textContent = next?.isTomorrow ? 'NEXT PRAYER · TOMORROW' : 'NEXT PRAYER';
    $('hero-date').textContent = next ? (next.isTomorrow ? 'Tomorrow' : 'Today') + ' · ' + formatDate(next.dateKey, { weekday: undefined, day: 'numeric', month: 'short', year: undefined }) : 'Choose a published date below';
    const seconds = next ? Math.max(0, Math.ceil(next.remainingMs / 1000)) : null;
    $('count-hours').textContent = seconds === null ? '--' : String(Math.floor(seconds / 3600)).padStart(2, '0');
    $('count-minutes').textContent = seconds === null ? '--' : String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
    $('count-seconds').textContent = seconds === null ? '--' : String(seconds % 60).padStart(2, '0');
    const key = next ? `${next.dateKey}-${next.key}` : null;
    if (key !== state.nextKey) { state.nextKey = key; if (state.period === 'day') renderSchedule(); }
    void notifications.check({ schedule: state.schedule, location: state.location, now: now.getTime(), use24Hour: state.use24Hour }).catch(() => { updateReminderStatus(); });
  }
}
async function shareSchedule() {
  const rows = selectedRows(); if (!rows.length) { toast('Choose a date with a published timetable first.'); return; }
  const url = new URL(location.href); url.searchParams.set('q', state.location.id); url.searchParams.set('date', state.date); url.searchParams.set('view', state.period);
  const day = rows[0];
  const text = `${state.location.label} · ${state.period === 'day' ? formatDate(day.date) : state.date.slice(0, state.period === 'month' ? 7 : 4)}\n${state.period === 'day' ? PRAYERS.map(({ key, label }) => `${label}: ${displayTime(day[key])}`).join('\n') + '\n' : ''}All times in IST.\n${url.href}`;
  try {
    if (navigator.share) await navigator.share({ title: 'AzanTimes · Prayer times', text });
    else { await navigator.clipboard.writeText(text); toast('Prayer schedule and link copied.'); }
  } catch (error) { if (error.name !== 'AbortError') info('Share your schedule', `<p>Copy this link to share the selected timetable:</p><p><a href="${escapeHTML(url.href)}">${escapeHTML(url.href)}</a></p>`); }
}
function showPrayerAlert(alert) {
  state.activeAlert = alert;
  $('prayer-alert-title').textContent = alert.prayerLabel || alert.title;
  $('prayer-alert-time').textContent = alert.time || '';
  $('prayer-alert-message').textContent = alert.locationLabel || alert.body;
  $('prayer-alert-help').hidden = alert.delivered !== false;
  $('prayer-alert').hidden = false;
}
function exportSelection() {
  return createExportSelection({
    ...state.exportContext, date: $('export-date').value, period: $('export-scope').value,
  });
}
function updateExportSelection() {
  try {
    const selection = exportSelection();
    $('export-summary').textContent = `${selection.location.label} · ${selection.summary}`;
    $('export-image').disabled = selection.period === 'year';
    $('export-csv').disabled = false;
    $('export-status').textContent = selection.period === 'year' ? 'For a readable image, choose a day or month. CSV includes the whole year.' : '';
  } catch (error) {
    $('export-summary').textContent = error.message;
    $('export-image').disabled = true; $('export-csv').disabled = true;
  }
}
function openExport() {
  if (!state.schedule) { toast('Load a timetable before exporting.'); return; }
  state.exportContext = { schedule: state.schedule, location: { ...state.location }, use24Hour: state.use24Hour };
  // A full month is exported only when explicitly requested in this dialog.
  $('export-scope').value = 'day'; $('export-date').value = state.date;
  updateExportSelection(); $('export-dialog').showModal();
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function exportSchedule() {
  try {
    const selection = exportSelection();
    downloadBlob(new Blob(['\ufeff', createExportCSV(selection)], { type: 'text/csv;charset=utf-8;' }),
      `AzanTimes-${selection.location.id}-${selection.date}-${selection.period}.csv`);
    $('export-status').textContent = `CSV download started · ${selection.summary}`;
  } catch (error) { $('export-status').textContent = error.message; }
}
// City coordinates are intentionally a small, explicit list: the visitor confirms the source.
async function detectLocation() {
  if (!navigator.geolocation) { toast('Location is unavailable in this browser. Search for your town instead.'); showLocations(); return; }
  $('detect-location').disabled = true;
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    const cities = [
      ['Ernakulam_Shafi', 9.9816, 76.2999], ['MARKAZ_CALICUT_2025', 11.2588, 75.7804], ['Kannur_Assembly_Constituency', 11.8745, 75.3704],
      ['Thalassery_Assembly_Constituency', 11.748, 75.489], ['T_V_M__shafi__standard_to_thambaanur', 8.487, 76.952],
      ['Kasaragod_Assembly_Constituency', 12.4996, 74.9869], ['Malappuram_Assembly_Constituency', 11.073, 76.074],
      ['Palakkad_Assembly_Constituency', 10.787, 76.654], ['Alappuzha_Town', 9.498, 76.338], ['Kalpetta_Assembly_Constituency', 11.608, 76.083],
    ].filter(([id]) => state.locations.some((entry) => entry.id === id));
    const rad = (angle) => angle * Math.PI / 180;
    const distance = ([, lat, lon]) => { const a = Math.sin(rad(lat - coords.latitude) / 2) ** 2 + Math.cos(rad(coords.latitude)) * Math.cos(rad(lat)) * Math.sin(rad(lon - coords.longitude) / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a))); };
    cities.sort((a, b) => distance(a) - distance(b));
    $('detect-location').disabled = false;
    if (!cities.length || distance(cities[0]) > 70) { showLocations(); toast('No supported city is close enough. Please choose your local timetable.'); return; }
    // Reviewable selection; do not silently replace a community-specific timetable.
    showLocations(); $('location-search').value = state.locations.find(({ id }) => id === cities[0][0]).label.split(' ')[0]; renderLocations();
    $('location-result-count').textContent = `Nearest supported city: ${state.locations.find(({ id }) => id === cities[0][0]).label} (about ${Math.round(distance(cities[0]))} km). Choose your community’s timetable.`;
  }, (error) => { $('detect-location').disabled = false; toast(error.code === 1 ? 'Location permission was declined. You can search for your town.' : 'Couldn’t find your location. Please search for your town.'); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
}
async function installApp() {
  if (state.installPrompt) {
    await state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; return;
  }
  info('Keep AzanTimes close', '<p><strong>On iPhone or iPad</strong><br>Open this page in Safari, tap Share, then choose Add to Home Screen.</p><p><strong>On Android</strong><br>Open the browser menu and choose Install app or Add to Home screen.</p><p><strong>On desktop</strong><br>Use the install icon in your browser’s address bar, when available.</p><p>After your first visit, the app and previously loaded timetables can be available offline. Reminders work while the page is running.</p>');
}

$('choose-location').addEventListener('click', () => showLocations());
$('nav-saved').addEventListener('click', () => showLocations(true));
$('location-search').addEventListener('input', renderLocations); $('district-filter').addEventListener('change', renderLocations);
$('filter-all').addEventListener('click', () => { state.savedOnly = false; renderLocations(); });
$('filter-saved').addEventListener('click', () => { state.savedOnly = true; renderLocations(); });
$('location-results').addEventListener('click', (event) => { const item = event.target.closest('[data-location]'); if (item) { $('location-dialog').close(); void selectLocation(item.dataset.location); } });
$('save-location').addEventListener('click', () => {
  if (!state.location) return;
  const id = state.location.id; const had = state.favorites.has(id);
  had ? state.favorites.delete(id) : state.favorites.add(id);
  const persisted = setStored('azan-favorites', [...state.favorites]); updateSaved();
  toast(persisted ? had ? 'Location removed from saved.' : 'Location saved for next time.' : 'Saved for this visit. Browser storage is unavailable.');
});
$('theme-toggle').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
$('theme-select').addEventListener('change', (event) => setTheme(event.target.value));
for (const id of ['settings-button', 'nav-settings', 'nav-reminders']) $(id).addEventListener('click', () => { updateReminderStatus(); $('settings-dialog').showModal(); });
$('time-format').value = state.use24Hour ? '24' : '12';
$('time-format').addEventListener('change', (event) => { state.use24Hour = event.target.value === '24'; setStored('azan-time-format', event.target.value); renderSchedule(); tick(); });
$('enable-reminders').addEventListener('click', async () => {
  const status = notifications.status();
  if (status.reasonCode === 'install-required') { await installApp(); return; }
  const button = $('enable-reminders'); button.disabled = true;
  try { status.enabled ? notifications.disable() : await notifications.enable(); }
  finally { updateReminderStatus(); }
});
$('test-notification').addEventListener('click', async () => {
  const button = $('test-notification'); button.disabled = true; button.textContent = 'Sending…';
  try { const result = await notifications.sendTest(); $('reminder-status').textContent = result.message || result.error || result.status.reason; }
  finally { button.textContent = 'Send test notification'; button.disabled = !notifications.status().supported; }
});
for (const id of ['dismiss-prayer-alert', 'prayer-alert-dismiss']) $(id).addEventListener('click', () => { $('prayer-alert').hidden = true; });
$('prayer-alert-view').addEventListener('click', async () => {
  const alert = state.activeAlert;
  $('prayer-alert').hidden = true;
  state.date = normalizeDate(alert?.date) ?? state.today;
  state.period = 'day';
  if (alert?.locationId && alert.locationId !== state.location?.id) await selectLocation(alert.locationId);
  else renderSchedule();
  $('schedule-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
});
$('prayer-alert-help').addEventListener('click', () => { $('prayer-alert').hidden = true; updateReminderStatus(); $('settings-dialog').showModal(); });
$('text-size').value = document.documentElement.dataset.textSize || 'large';
$('text-size').addEventListener('change', (event) => { document.documentElement.dataset.textSize = event.target.value; setStored('azan-text-size', event.target.value); });
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); });
document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', () => setPeriod(button.dataset.period)));
$('nav-prayers').addEventListener('click', () => { state.date = state.today; setPeriod('day'); });
$('nav-calendar').addEventListener('click', () => { setPeriod('month'); $('schedule-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); });
$('previous-date').addEventListener('click', () => moveDate(-1)); $('next-date').addEventListener('click', () => moveDate(1));
$('go-today').addEventListener('click', () => { state.date = state.today; setPeriod('day'); });
$('schedule-date').addEventListener('change', (event) => {
  const value = event.target.value;
  if (state.period === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(value)) state.date = value;
  else if (state.period === 'month' && /^\d{4}-\d{2}$/.test(value)) state.date = `${value}-01`;
  else if (state.period === 'year' && /^\d{4}$/.test(value) && Number(value) >= 1900 && Number(value) <= 2200) state.date = `${value}-01-01`;
  renderSchedule();
});
$('share-schedule').addEventListener('click', () => void shareSchedule());
$('export-schedule').addEventListener('click', openExport);
$('export-scope').addEventListener('change', updateExportSelection);
$('export-date').addEventListener('change', updateExportSelection);
$('export-csv').addEventListener('click', exportSchedule);
$('export-image').addEventListener('click', async () => {
  const button = $('export-image');
  try {
    const selection = exportSelection();
    button.disabled = true; $('export-status').textContent = `Preparing image · ${selection.summary}`;
    const { exportPrayerImage } = await import('./export-image.js');
    const { blob, filename } = await exportPrayerImage({ ...selection, logoUrl: new URL('../brand/azantimes-mark.svg', import.meta.url).href });
    downloadBlob(blob, filename);
    $('export-status').textContent = `PNG download started · ${selection.summary}`;
  } catch (error) { $('export-status').textContent = error.message || 'The image could not be saved. Try CSV instead.'; }
  finally { button.disabled = $('export-scope').value === 'year'; }
});
$('schedule-content').addEventListener('click', (event) => {
  const day = event.target.closest('[data-select-date]');
  if (day) { state.date = day.dataset.selectDate; setPeriod('day'); }
});
$('detect-location').addEventListener('click', () => void detectLocation()); $('install-app').addEventListener('click', () => void installApp());
$('retry-load').addEventListener('click', () => state.locations.length ? void selectLocation(state.location?.id ?? 'Ernakulam_Shafi', false) : void init());
$('about-times').addEventListener('click', () => info('About your prayer times', '<p>AzanTimes presents <strong>published local prayer timetables</strong>. Sources can have different conventions, so select the timetable followed by your local community. Source names and their original publication years are retained in the location chooser.</p><p>Times show the <strong>start of each prayer</strong>, rather than mosque congregation (jama’ah) times. Sunrise marks the end of Fajr time and is not counted as a prayer in the countdown.</p><p>Every time and countdown uses <strong>Indian Standard Time (Asia/Kolkata)</strong>, even when you travel. Hijri dates are estimated using the Umm al-Qura calendar; local moon sightings can differ.</p><p>Unavailable dates and missing times are shown explicitly. A timetable from another date or year is never substituted.</p>'));
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; });
window.addEventListener('appinstalled', () => { state.installPrompt = null; toast('AzanTimes is ready on your home screen.'); });
window.addEventListener('online', updateConnection); window.addEventListener('offline', updateConnection);
window.addEventListener('popstate', (event) => {
  const savedView = event.state;
  const nextLocation = state.locations.find(({ id }) => id === savedView?.location) ?? locationFromURL()
    ?? state.locations.find(({ id }) => id === 'Ernakulam_Shafi') ?? state.locations[0];
  const params = new URLSearchParams(location.search);
  state.date = normalizeDate(savedView?.date) ?? normalizeDate(params.get('date')) ?? state.today;
  const period = savedView?.period ?? params.get('view');
  state.period = ['day', 'month', 'year'].includes(period) ? period : 'day';
  if (nextLocation) void selectLocation(nextLocation.id, false);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

async function init() {
  try {
    state.locations = await loadLocations();
    state.favorites = new Set([...state.favorites].filter((id) => state.locations.some((entry) => entry.id === id)));
    const districts = [...new Set(state.locations.map(({ district }) => district))].sort();
    $('district-filter').innerHTML = '<option value="">All districts</option>' + districts.map((district) => `<option>${escapeHTML(district)}</option>`).join('');
    let legacy;
    try { legacy = localStorage.getItem('prayer-times-default-location'); } catch { /* Optional migration. */ }
    const remembered = getStored('azan-location') ?? legacy;
    const initial = locationFromURL() ?? state.locations.find(({ id }) => id === remembered) ?? state.locations.find(({ id }) => id === 'Ernakulam_Shafi') ?? state.locations[0];
    if (!initial) throw new Error('No timetables are currently published.');
    const params = new URLSearchParams(location.search);
    const date = normalizeDate(params.get('date')); if (date) state.date = date;
    if (['day', 'month', 'year'].includes(params.get('view'))) state.period = params.get('view');
    history.replaceState({ location: initial.id, date: state.date, period: state.period }, '', location.href);
    updateSaved(); await selectLocation(initial.id, false);
  } catch {
    $('location-name').textContent = 'Choose your location'; $('error-panel').hidden = false;
    $('error-message').textContent = 'The location list could not be loaded. Check your connection and try again.';
    $('schedule-content').setAttribute('aria-busy', 'false'); $('next-prayer-card').setAttribute('aria-busy', 'false');
    $('schedule-content').innerHTML = '<div class="schedule-placeholder">No location list is available. Please try again when connected.</div>';
    $('next-name').textContent = 'Unavailable';
  }
}
setTheme(document.documentElement.dataset.theme); updateReminderStatus(); updateDateInput(); tick();
setInterval(tick, 1000);
if ('serviceWorker' in navigator && window.isSecureContext) {
  // Initial requests can finish before the first worker claims this tab. Warm
  // the selected source once it controls the page, so the first visit works offline.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    void loadLocations().catch(() => {});
    if (state.location) void loadSchedule(state.location.id).catch(() => {});
  });
  window.addEventListener('load', () => { navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => { /* Timetables still work without offline support. */ }); });
}
void init();
