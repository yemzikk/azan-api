/**
 * Branded dropdowns and date pickers, shared by the dashboard, the API docs and the
 * review page. Each native <select> or date input stays in the page as the source of
 * truth (forms, labels and existing code keep working) and is drawn as a branded
 * control on top. Selecting dispatches the usual `input` and `change` events, and
 * values set from code are reflected immediately.
 *
 *   import { enhanceAll } from './brand-controls.js?v=6c154cf95166';
 *   enhanceAll();            // every <select> and date/month input on the page
 *
 * Dependency-free. Popups open in the browser's top layer (Popover API) so dialogs never
 * clip them, and become a bottom sheet on narrow screens.
 */
const TIME_ZONE = 'Asia/Kolkata';
const SEARCH_THRESHOLD = 12;
const supportsPopover = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
let uid = 0;
const nextId = (prefix) => `bc-${prefix}-${++uid}`;
const ICONS = {
  chevron: '<svg class="bc-icon bc-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg class="bc-icon bc-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  calendar: '<svg class="bc-icon bc-date-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18"/></svg>',
  previous: '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>',
  next: '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>',
  search: '<svg class="bc-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',
};

// ---------------------------------------------------------------------------------------
// Shared popup handling
// ---------------------------------------------------------------------------------------
let openPopup = null;

function createPopup(className, role) {
  const popup = document.createElement('div');
  popup.className = `bc-popover ${className}`;
  popup.id = nextId('popup');
  if (role) popup.setAttribute('role', role);
  if (supportsPopover) popup.popover = 'manual';
  else popup.hidden = true;
  return popup;
}

function showPopup(control) {
  if (openPopup && openPopup !== control) openPopup.close({ restoreFocus: false });
  const { popup, button } = control;
  // Without the Popover API, keep the popup inside an open modal dialog so it stays usable.
  if (!supportsPopover) {
    const host = button.closest('dialog[open]') ?? document.body;
    if (popup.parentElement !== host) host.append(popup);
    popup.hidden = false;
  } else if (!popup.matches(':popover-open')) {
    popup.showPopover();
  }
  button.setAttribute('aria-expanded', 'true');
  control.wrapper.classList.add('bc-open');
  openPopup = control;
  place(control);
}

function hidePopup(control) {
  const { popup, button } = control;
  if (supportsPopover) { if (popup.matches(':popover-open')) popup.hidePopover(); } else popup.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  control.wrapper.classList.remove('bc-open');
  if (openPopup === control) openPopup = null;
}

const narrow = () => matchMedia('(max-width: 559px)').matches;

/** Put the popup under (or over) its button, inside the viewport; a bottom sheet on phones. */
function place(control) {
  const { popup, button } = control;
  popup.classList.toggle('bc-sheet', narrow());
  if (narrow()) {
    Object.assign(popup.style, { top: '', left: '', width: '', maxHeight: '' });
    return;
  }
  const rect = button.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(Math.max(rect.width, control.minWidth ?? 220), innerWidth - margin * 2);
  const left = Math.min(Math.max(rect.left, margin), innerWidth - width - margin);
  popup.style.width = `${width}px`;
  popup.style.left = `${left}px`;
  popup.style.maxHeight = '';
  // scrollHeight leaves out the border, and the popup's height includes it: without the
  // border the content is two pixels short and a scroll bar appears for nothing.
  const border = popup.offsetHeight - popup.clientHeight;
  const natural = Math.min(popup.scrollHeight + border, control.maxHeight ?? 380);
  const below = innerHeight - rect.bottom - margin - 6;
  const above = rect.top - margin - 6;
  if (below >= natural || below >= above) {
    popup.style.top = `${rect.bottom + 6}px`;
    popup.style.maxHeight = `${Math.max(160, Math.min(natural, below))}px`;
  } else {
    const height = Math.min(natural, above);
    popup.style.top = `${rect.top - 6 - height}px`;
    popup.style.maxHeight = `${height}px`;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => {
    if (!openPopup) return;
    if (openPopup.popup.contains(event.target) || openPopup.button.contains(event.target)) return;
    openPopup.close({ restoreFocus: false });
  }, true);
  addEventListener('resize', () => { if (openPopup) place(openPopup); });
  addEventListener('scroll', (event) => {
    if (openPopup && !openPopup.popup.contains(event.target)) place(openPopup);
  }, true);
}

/** Accessible label text for a native control: its <label>, wrapping label, or aria-label. */
function labelText(control) {
  const parts = [];
  if (control.id) for (const label of document.querySelectorAll(`label[for="${CSS.escape(control.id)}"]`)) parts.push(label.textContent);
  const wrapping = control.closest('label');
  if (wrapping) {
    const copy = wrapping.cloneNode(true);
    copy.querySelectorAll('select, input, button, .bc-popover, .bc-value').forEach((node) => node.remove());
    parts.push(copy.textContent);
  }
  if (control.getAttribute('aria-labelledby')) {
    for (const id of control.getAttribute('aria-labelledby').split(/\s+/)) parts.push(document.getElementById(id)?.textContent ?? '');
  }
  parts.push(control.getAttribute('aria-label') ?? '');
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).find(Boolean) ?? '';
}

/** Hide the native control, keep it in place, and route its label to the branded button. */
function adopt(native, button, popup, className) {
  const wrapper = document.createElement('span');
  wrapper.className = `bc-control ${className}`;
  native.before(wrapper);
  wrapper.append(native, button, popup);
  native.classList.add('bc-native');
  native.tabIndex = -1;
  native.setAttribute('aria-hidden', 'true');
  native.dataset.bcEnhanced = 'true';
  if (native.id) for (const label of document.querySelectorAll(`label[for="${CSS.escape(native.id)}"]`)) label.htmlFor = button.id;
  // A label that wraps the control would otherwise focus the hidden native element.
  native.closest('label')?.addEventListener('click', (event) => {
    if (button.contains(event.target) || popup.contains(event.target)) return;
    event.preventDefault();
    if (!button.disabled) button.focus();
  });
  return wrapper;
}

/** Make `element.value = ...` (and similar) from page code refresh the branded control. */
function watchProperties(element, prototype, properties, refresh) {
  for (const property of properties) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor?.set) continue;
    Object.defineProperty(element, property, {
      configurable: true,
      enumerable: true,
      get() { return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, value); refresh(); },
    });
  }
}

function emit(native) {
  native.dispatchEvent(new Event('input', { bubbles: true }));
  native.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------------------------------------------------------------------------------
// Dropdown
// ---------------------------------------------------------------------------------------
export function enhanceSelect(select) {
  if (!select || select.dataset.bcEnhanced || select.multiple || select.size > 1) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bc-button';
  button.id = nextId('select');
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `<span class="bc-value"></span>${ICONS.chevron}`;
  const popup = createPopup('bc-list-popup');
  button.setAttribute('aria-controls', popup.id);
  const control = { kind: 'select', native: select, button, popup, minWidth: 200, maxHeight: 380 };
  control.wrapper = adopt(select, button, popup, 'bc-select');
  let label = '';
  let list;
  let search;
  let options = [];
  let active = -1;

  const optionText = (option) => (option.label || option.textContent || '').replace(/\s+/g, ' ').trim();
  function refresh() {
    label = labelText(select);
    const selected = select.selectedOptions[0];
    const text = selected ? optionText(selected) : '';
    button.querySelector('.bc-value').textContent = text;
    button.disabled = select.disabled;
    button.setAttribute('aria-label', label ? `${label}: ${text}` : text);
    if (control.wrapper.classList.contains('bc-open')) build();
  }

  function build() {
    popup.replaceChildren();
    const all = [...select.options];
    const searchable = all.length > SEARCH_THRESHOLD;
    search = null;
    if (searchable) {
      const field = document.createElement('div');
      field.className = 'bc-search';
      field.innerHTML = ICONS.search;
      search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'Search';
      search.autocomplete = 'off';
      search.spellcheck = false;
      search.setAttribute('aria-label', `Search ${label || 'options'}`);
      field.append(search);
      popup.append(field);
      search.addEventListener('input', filter);
      search.addEventListener('keydown', keydown);
    }
    list = document.createElement('div');
    list.className = 'bc-list';
    list.id = nextId('listbox');
    list.setAttribute('role', 'listbox');
    list.tabIndex = searchable ? -1 : 0;
    if (label) list.setAttribute('aria-label', label);
    popup.append(list);
    if (search) {
      search.setAttribute('role', 'combobox');
      search.setAttribute('aria-controls', list.id);
      search.setAttribute('aria-expanded', 'true');
      search.setAttribute('aria-autocomplete', 'list');
    }
    options = [];
    const add = (option, parent) => {
      const row = document.createElement('div');
      row.className = 'bc-option';
      row.id = nextId('option');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.selected));
      if (option.disabled) row.setAttribute('aria-disabled', 'true');
      row.dataset.index = String(option.index);
      row.innerHTML = `<span class="bc-option-text"></span>${ICONS.check}`;
      row.firstChild.textContent = optionText(option);
      parent.append(row);
      options.push({ row, option, text: optionText(option).toLowerCase() });
    };
    for (const child of select.children) {
      if (child.tagName === 'OPTGROUP') {
        const group = document.createElement('div');
        group.className = 'bc-group';
        group.setAttribute('role', 'group');
        const heading = document.createElement('div');
        heading.className = 'bc-group-label';
        heading.id = nextId('group');
        heading.textContent = child.label;
        group.setAttribute('aria-labelledby', heading.id);
        group.append(heading);
        for (const option of child.children) if (option.tagName === 'OPTION') add(option, group);
        list.append(group);
      } else if (child.tagName === 'OPTION') add(child, list);
    }
    list.addEventListener('keydown', keydown);
    list.addEventListener('click', (event) => {
      const row = event.target.closest('.bc-option');
      if (row && row.getAttribute('aria-disabled') !== 'true') choose(Number(row.dataset.index));
    });
    list.addEventListener('pointermove', (event) => {
      const row = event.target.closest('.bc-option');
      if (row) setActive(options.findIndex((entry) => entry.row === row), false);
    });
    setActive(options.findIndex((entry) => entry.option.selected), true);
  }

  const visible = () => options.filter((entry) => !entry.row.hidden && !entry.option.disabled);
  function setActive(index, scroll) {
    options.forEach((entry, i) => entry.row.classList.toggle('bc-active', i === index));
    active = index;
    const target = options[index];
    const owner = search ?? list;
    if (target) {
      owner.setAttribute('aria-activedescendant', target.row.id);
      if (scroll) target.row.scrollIntoView({ block: 'nearest' });
    } else owner.removeAttribute('aria-activedescendant');
  }
  function move(step) {
    const candidates = visible();
    if (!candidates.length) return;
    const current = candidates.findIndex((entry) => options.indexOf(entry) === active);
    const next = current < 0 ? (step > 0 ? 0 : candidates.length - 1)
      : Math.max(0, Math.min(candidates.length - 1, current + step));
    setActive(options.indexOf(candidates[next]), true);
  }
  function filter() {
    const query = search.value.trim().toLowerCase();
    for (const entry of options) entry.row.hidden = Boolean(query) && !entry.text.includes(query);
    for (const group of list.querySelectorAll('.bc-group')) group.hidden = ![...group.querySelectorAll('.bc-option')].some((row) => !row.hidden);
    let empty = list.querySelector('.bc-empty');
    if (!visible().length) {
      if (!empty) { empty = document.createElement('div'); empty.className = 'bc-empty'; list.append(empty); }
      empty.textContent = 'No matches';
    } else empty?.remove();
    const first = visible()[0];
    setActive(first ? options.indexOf(first) : -1, true);
    place(control);
  }
  let typed = '';
  let typedTimer;
  function keydown(event) {
    const inSearch = event.target === search;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1); return;
      case 'ArrowUp': event.preventDefault(); move(-1); return;
      case 'PageDown': event.preventDefault(); move(8); return;
      case 'PageUp': event.preventDefault(); move(-8); return;
      case 'Home': if (inSearch) return; event.preventDefault(); move(-Infinity); return;
      case 'End': if (inSearch) return; event.preventDefault(); move(Infinity); return;
      case 'Enter': event.preventDefault(); if (options[active]) choose(Number(options[active].row.dataset.index)); return;
      case 'Escape': event.preventDefault(); close({ restoreFocus: true }); return;
      case 'Tab': close({ restoreFocus: false }); return;
      default:
        if (!inSearch && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          clearTimeout(typedTimer);
          typed += event.key.toLowerCase();
          typedTimer = setTimeout(() => { typed = ''; }, 600);
          const match = visible().find((entry) => entry.text.startsWith(typed));
          if (match) setActive(options.indexOf(match), true);
        }
    }
  }
  function choose(index) {
    const changed = select.selectedIndex !== index;
    select.selectedIndex = index;
    close({ restoreFocus: true });
    if (changed) emit(select);
  }
  function open() {
    if (select.disabled) return;
    build();
    showPopup(control);
    setActive(options.findIndex((entry) => entry.option.selected), true);
    (search ?? list).focus({ preventScroll: true });
  }
  function close({ restoreFocus } = {}) {
    hidePopup(control);
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  control.close = close;

  button.addEventListener('click', () => (control.wrapper.classList.contains('bc-open') ? close({ restoreFocus: true }) : open()));
  button.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
  });
  select.addEventListener('change', refresh);
  watchProperties(select, HTMLSelectElement.prototype, ['value', 'selectedIndex'], refresh);
  new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ['disabled', 'label', 'selected', 'aria-label'] });
  refresh();
  return control;
}

// ---------------------------------------------------------------------------------------
// Date, month and year picker
// ---------------------------------------------------------------------------------------
const pad = (value) => String(value).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const daysIn = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekday = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
const longDay = (year, month, day) => new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));

function indiaToday() {
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  return { year, month, day };
}

/** Parse the input's value for its current type. */
function readValue(input) {
  const value = input.value;
  if (input.type === 'month') { const m = /^(\d{4})-(\d{2})$/.exec(value); return m ? { year: +m[1], month: +m[2], day: 1 } : null; }
  if (input.type === 'number') return /^\d{4}$/.test(value) ? { year: +value, month: 1, day: 1 } : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? { year: +m[1], month: +m[2], day: +m[3] } : null;
}
const key = (date, level) => (level === 'year' ? `${date.year}` : level === 'month' ? `${date.year}-${pad(date.month)}` : `${date.year}-${pad(date.month)}-${pad(date.day)}`);

export function enhanceDateInput(input) {
  if (!input || input.dataset.bcEnhanced) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bc-button bc-date-button';
  button.id = nextId('date');
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = `${ICONS.calendar}<span class="bc-value"></span>${ICONS.chevron}`;
  const popup = createPopup('bc-date-popup', 'dialog');
  button.setAttribute('aria-controls', popup.id);
  const control = { kind: 'date', native: input, button, popup, minWidth: 296, maxHeight: 440 };
  control.wrapper = adopt(input, button, popup, 'bc-date');
  let view;  // { level: 'day'|'month'|'year', year, month, focus: {year, month, day} }

  const mode = () => (input.type === 'month' ? 'month' : input.type === 'number' ? 'year' : 'day');
  const bound = (name) => {
    const value = input.getAttribute(name);
    if (!value) return null;
    if (mode() === 'year') return /^\d{4}$/.test(value) ? value : null;
    return value;
  };
  const inRange = (date, level) => {
    const text = key(date, level);
    const min = bound('min');
    const max = bound('max');
    const cut = (value) => (value ? value.slice(0, text.length) : null);
    return (!cut(min) || text >= cut(min)) && (!cut(max) || text <= cut(max));
  };

  function refresh() {
    const date = readValue(input);
    const level = mode();
    const text = !date ? (level === 'year' ? 'Choose a year' : level === 'month' ? 'Choose a month' : 'Choose a date')
      : level === 'year' ? `${date.year}`
        : level === 'month' ? `${MONTHS[date.month - 1]} ${date.year}`
          : new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
    button.querySelector('.bc-value').textContent = text;
    button.disabled = input.disabled;
    const label = labelText(input);
    button.setAttribute('aria-label', label ? `${label}: ${text}` : text);
    popup.setAttribute('aria-label', label || 'Choose a date');
  }

  function render() {
    const { level, year, month } = view;
    const title = level === 'day' ? `${MONTHS[month - 1]} ${year}` : level === 'month' ? `${year}` : `${Math.floor(year / 12) * 12} to ${Math.floor(year / 12) * 12 + 11}`;
    const step = level === 'day' ? 'month' : level === 'month' ? 'year' : 'twelve years';
    popup.innerHTML = `<div class="bc-cal-head"><button type="button" class="bc-cal-nav" data-nav="-1" aria-label="Previous ${step}">${ICONS.previous}</button><button type="button" class="bc-cal-title" ${level === 'year' ? 'disabled' : ''} aria-label="${title}${level === 'year' ? '' : ', choose a different ' + (level === 'day' ? 'month' : 'year')}">${title}</button><button type="button" class="bc-cal-nav" data-nav="1" aria-label="Next ${step}">${ICONS.next}</button></div>`;
    const grid = document.createElement('div');
    grid.className = `bc-cal-grid bc-cal-${level}`;
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', title);
    const today = indiaToday();
    const selected = readValue(input);
    const cell = (date, text, label) => {
      const value = key(date, level);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bc-cal-cell';
      b.textContent = text;
      b.dataset.value = value;
      b.setAttribute('aria-label', label);
      b.tabIndex = -1;
      if (selected && key(selected, level) === value) { b.classList.add('bc-selected'); b.setAttribute('aria-selected', 'true'); }
      if (key(today, level) === value) { b.classList.add('bc-today'); b.setAttribute('aria-current', level === 'day' ? 'date' : 'true'); }
      if (!inRange(date, level)) b.disabled = true;
      const wrap = document.createElement('div');
      wrap.setAttribute('role', 'gridcell');
      wrap.append(b);
      return wrap;
    };
    const row = () => { const r = document.createElement('div'); r.className = 'bc-cal-row'; r.setAttribute('role', 'row'); grid.append(r); return r; };
    if (level === 'day') {
      const head = row();
      head.classList.add('bc-cal-weekdays');
      for (const name of WEEKDAYS) { const h = document.createElement('div'); h.setAttribute('role', 'columnheader'); h.textContent = name.slice(0, 2); h.setAttribute('aria-label', name); head.append(h); }
      let current = row();
      for (let i = 0; i < weekday(year, month, 1); i += 1) { const blank = document.createElement('div'); blank.setAttribute('role', 'gridcell'); current.append(blank); }
      for (let day = 1; day <= daysIn(year, month); day += 1) {
        if (current.children.length === 7) current = row();
        current.append(cell({ year, month, day }, String(day), longDay(year, month, day)));
      }
    } else if (level === 'month') {
      let current;
      MONTHS.forEach((name, index) => {
        if (index % 3 === 0) current = row();
        current.append(cell({ year, month: index + 1, day: 1 }, name.slice(0, 3), `${name} ${year}`));
      });
    } else {
      const start = Math.floor(year / 12) * 12;
      let current;
      for (let i = 0; i < 12; i += 1) {
        if (i % 3 === 0) current = row();
        current.append(cell({ year: start + i, month: 1, day: 1 }, String(start + i), String(start + i)));
      }
    }
    popup.append(grid);
    if (level === mode() && mode() === 'day') {
      const foot = document.createElement('div');
      foot.className = 'bc-cal-foot';
      foot.innerHTML = '<button type="button" class="bc-cal-today">Today</button>';
      foot.firstChild.disabled = !inRange(today, 'day');
      popup.append(foot);
    }
    // Roving focus: the chosen, today's or first available cell takes the tab stop.
    const cells = [...grid.querySelectorAll('.bc-cal-cell:not(:disabled)')];
    const target = cells.find((b) => b.dataset.value === key(view.focus, level)) ?? cells.find((b) => b.classList.contains('bc-selected')) ?? cells.find((b) => b.classList.contains('bc-today')) ?? cells[0];
    if (target) target.tabIndex = 0;
    place(control);
    return target;
  }

  function focusCell(date) {
    view.focus = date;
    if (view.level === 'day') { view.year = date.year; view.month = date.month; } else view.year = date.year;
    render()?.focus({ preventScroll: true });
  }
  function shift(amount, unit) {
    const f = { ...view.focus };
    if (unit === 'day') {
      const d = new Date(Date.UTC(f.year, f.month - 1, f.day + amount));
      focusCell({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
    } else if (unit === 'month') {
      const total = f.year * 12 + (f.month - 1) + amount;
      const year = Math.floor(total / 12);
      const month = (total % 12) + 1;
      focusCell({ year, month, day: Math.min(f.day, daysIn(year, month)) });
    } else focusCell({ ...f, year: f.year + amount, day: Math.min(f.day, daysIn(f.year + amount, f.month)) });
  }
  function commit(value) {
    const changed = input.value !== value;
    input.value = value;
    close({ restoreFocus: true });
    if (changed) emit(input);
  }
  function pick(value) {
    const level = view.level;
    const [y, m, d] = value.split('-').map(Number);
    if (level === mode()) { commit(value); return; }
    // Navigating from a coarser view back down to the input's own level.
    if (level === 'year') { view.level = 'month'; focusCell({ year: y, month: view.focus.month, day: 1 }); }
    else if (level === 'month') { view.level = 'day'; focusCell({ year: y, month: m, day: Math.min(view.focus.day, daysIn(y, m)) }); }
    void d;
  }

  popup.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.dataset.nav) {
      const amount = Number(target.dataset.nav);
      if (view.level === 'day') shift(amount, 'month');
      else if (view.level === 'month') shift(amount, 'year');
      else shift(amount * 12, 'year');
      popup.querySelector(`[data-nav="${target.dataset.nav}"]`)?.focus({ preventScroll: true });
    } else if (target.classList.contains('bc-cal-title')) {
      view.level = view.level === 'day' ? 'month' : 'year';
      render()?.focus({ preventScroll: true });
    } else if (target.classList.contains('bc-cal-today')) {
      commit(key(indiaToday(), 'day'));
    } else if (target.classList.contains('bc-cal-cell')) {
      pick(target.dataset.value);
    }
  });
  popup.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close({ restoreFocus: true }); return; }
    if (event.key === 'Tab') {
      // Keep focus inside the picker.
      const focusable = [...popup.querySelectorAll('button:not(:disabled)')].filter((b) => b.tabIndex >= 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if (!event.target.classList.contains('bc-cal-cell')) return;
    const level = view.level;
    const columns = level === 'day' ? 7 : 3;
    const unit = level === 'day' ? 'day' : level === 'month' ? 'month' : 'year';
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    if (event.key in moves) { event.preventDefault(); shift(moves[event.key], unit); return; }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      const sign = event.key === 'PageUp' ? -1 : 1;
      if (level === 'day') shift(sign * (event.shiftKey ? 12 : 1), 'month');
      else shift(sign * (level === 'month' ? 1 : 12), 'year');
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (level === 'day') {
        const offset = weekday(view.focus.year, view.focus.month, view.focus.day);
        shift(event.key === 'Home' ? -offset : 6 - offset, 'day');
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.target.disabled) pick(event.target.dataset.value); }
  });

  function open() {
    if (input.disabled) return;
    const start = readValue(input) ?? indiaToday();
    view = { level: mode(), year: start.year, month: start.month, focus: start };
    showPopup(control);
    render()?.focus({ preventScroll: true });
  }
  function close({ restoreFocus } = {}) {
    hidePopup(control);
    if (restoreFocus) button.focus({ preventScroll: true });
  }
  control.close = close;
  button.addEventListener('click', () => (control.wrapper.classList.contains('bc-open') ? close({ restoreFocus: true }) : open()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && (event.altKey || !control.wrapper.classList.contains('bc-open'))) { event.preventDefault(); open(); }
  });
  input.addEventListener('change', refresh);
  watchProperties(input, HTMLInputElement.prototype, ['value', 'valueAsDate', 'valueAsNumber'], refresh);
  new MutationObserver(refresh).observe(input, { attributes: true, attributeFilter: ['type', 'min', 'max', 'disabled', 'aria-label'] });
  refresh();
  return control;
}

/** Enhance every dropdown and date or month input under `root`. Safe to call again. */
export function enhanceAll(root = document) {
  for (const select of root.querySelectorAll('select:not([data-native])')) enhanceSelect(select);
  for (const input of root.querySelectorAll('input[type="date"]:not([data-native]), input[type="month"]:not([data-native])')) enhanceDateInput(input);
}
