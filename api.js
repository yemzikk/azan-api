(() => {
  'use strict';

  const form = document.getElementById('explorer-form');
  const locationSelect = document.getElementById('location');
  const periodSelect = document.getElementById('period');
  const runButton = document.getElementById('run-request');
  const endpointCode = document.getElementById('request-url');
  const copyEndpoint = document.getElementById('copy-endpoint');
  const responseCode = document.getElementById('response-json');
  const responseContainer = document.getElementById('response-container');
  const responseStatus = document.getElementById('response-status');
  const responseNote = document.getElementById('response-note');
  const errorContainer = document.getElementById('explorer-error');
  const errorMessage = document.getElementById('error-message');
  const copyStatus = document.getElementById('copy-status');
  let requestController;
  let locationsLoaded = false;
  let requestVersion = 0;
  let activePath = '';

  // Version 2 ids are the version 1 names in lower case with hyphens.
  const v2Id = (legacyId) => legacyId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const indiaYear = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date());

  function requestPath() {
    const option = locationSelect.selectedOptions[0];
    if (!option?.value) return '';
    const [version, period] = periodSelect.value.split(':');
    if (version === 'v1') return `/v1/timesheets/${encodeURIComponent(option.dataset.legacy)}/${period}.json`;
    if (period === 'location') return `/v2/locations/${option.value}.json`;
    return `/v2/locations/${option.value}/timetables/${period === 'year' ? indiaYear() : 'perpetual'}.json`;
  }

  function setStatus(message, state = '') {
    responseStatus.textContent = message;
    responseStatus.dataset.state = state;
  }

  function setBusy(busy) {
    responseContainer.setAttribute('aria-busy', String(busy));
    runButton.disabled = busy || !locationsLoaded;
    runButton.textContent = busy ? 'Sending…' : 'Send request →';
  }

  function clearResponse() {
    responseCode.textContent = 'Send a request to see this timetable.';
    responseNote.hidden = true;
    errorContainer.hidden = true;
    setStatus('Ready to send');
  }

  function updateEndpoint() {
    // Selecting another request cancels the old one, including when it has not
    // finished downloading a larger yearly dataset.
    requestVersion += 1;
    requestController?.abort();
    activePath = requestPath();
    endpointCode.textContent = activePath || `/v2/locations/…/timetables/${indiaYear()}.json`;
    copyEndpoint.disabled = !activePath;
    setBusy(false);
    clearResponse();
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorContainer.hidden = false;
    setStatus('Request unavailable', 'error');
  }

  async function fetchJSON(path, signal) {
    const response = await fetch(path, { signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`The server returned HTTP ${response.status}. Check that the timetable and file exist.`);
    const type = response.headers.get('content-type') || '';
    if (!type.includes('json')) throw new Error('The server returned a page instead of JSON. This timetable may be unavailable.');
    return { response, data: await response.json() };
  }

  function indiaDate() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type).value;
    return `${part('day')}-${part('month')}-${part('year')}`;
  }

  async function sendRequest() {
    if (!locationsLoaded || !requestPath()) return;
    requestController?.abort();
    requestController = new AbortController();
    const controller = requestController;
    const version = ++requestVersion;
    const path = requestPath();
    const startedAt = performance.now();
    setBusy(true);
    errorContainer.hidden = true;
    responseNote.hidden = true;
    setStatus('Fetching JSON…');
    responseCode.textContent = 'Loading response…';
    let timeoutExpired = false;
    const timeout = window.setTimeout(() => { timeoutExpired = true; controller.abort(); }, 15000);
    try {
      const { response, data } = await fetchJSON(path, controller.signal);
      if (version !== requestVersion) return;
      if (!data || typeof data !== 'object') throw new Error('This file did not contain a timetable object or array.');
      responseCode.textContent = JSON.stringify(data, null, 2);
      const records = Array.isArray(data) ? data : Array.isArray(data.days) ? data.days : [data];
      const count = records.length;
      const elapsed = Math.round(performance.now() - startedAt);
      setStatus(`${response.status} OK · ${count} ${count === 1 ? 'record' : 'records'} · ${elapsed} ms`, 'success');
      const firstDate = records[0]?.date;
      const lastDate = records[records.length - 1]?.date;
      if (firstDate) {
        responseNote.hidden = false;
        responseNote.textContent = count > 1
          ? `Returned dates: ${firstDate} to ${lastDate}. Times are local to the timetable (Asia/Kolkata).`
          : `Returned date: ${firstDate}. Times are local to the timetable (Asia/Kolkata).`;
        if (periodSelect.value === 'v1:today' && firstDate !== indiaDate()) {
          responseNote.textContent += ' This daily file is not dated today. Use a matching date from the yearly dataset before displaying current prayer times.';
        }
      }
      if (!count) {
        responseNote.hidden = false;
        responseNote.textContent = 'The endpoint returned an empty dataset. Try another period or timetable.';
      }
    } catch (error) {
      if (version !== requestVersion) return;
      if (error.name === 'AbortError' && !timeoutExpired) return;
      responseCode.textContent = 'No response to display.';
      showError(timeoutExpired
        ? 'The request timed out. Check your connection and try again.'
        : error instanceof SyntaxError
          ? 'The response could not be read as JSON. Try another timetable or period.'
          : error.message === 'Failed to fetch'
            ? 'Could not connect to the API. Check your internet connection and try again.'
            : error.message);
    } finally {
      window.clearTimeout(timeout);
      if (version === requestVersion) setBusy(false);
    }
  }

  async function loadLocations() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    locationSelect.disabled = true;
    errorContainer.hidden = true;
    responseContainer.setAttribute('aria-busy', 'true');
    setStatus('Loading locations…');
    try {
      // Prefer the version 2 list for its names; fall back to the version 1 index.
      let entries;
      try {
        const { data } = await fetchJSON('/v2/locations.json', controller.signal);
        if (!Array.isArray(data?.locations) || !data.locations.length) throw new Error('empty');
        entries = data.locations.map((location) => ({ id: location.id, legacy: location.legacyId, label: location.type === 'assembly-constituency' ? `${location.name} (constituency)` : location.name }));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        const { data } = await fetchJSON('/v1/timesheets/index.json', controller.signal);
        if (!Array.isArray(data) || !data.length || data.some((item) => typeof item !== 'string')) {
          throw new Error('The locations index is unavailable. Please try again later.');
        }
        entries = [...new Set(data)].map((legacy) => ({ id: v2Id(legacy), legacy, label: legacy.replace(/_/g, ' ') }));
      }
      entries.sort((a, b) => a.label.localeCompare(b.label));
      locationSelect.replaceChildren(...entries.map((entry) => {
        const option = new Option(entry.label, entry.id);
        option.dataset.legacy = entry.legacy;
        return option;
      }));
      locationSelect.value = entries.some((entry) => entry.id === 'kuttiady-assembly-constituency')
        ? 'kuttiady-assembly-constituency' : entries[0].id;
      locationsLoaded = true;
      locationSelect.disabled = false;
      updateEndpoint();
      await sendRequest();
    } catch (error) {
      locationSelect.replaceChildren(new Option('Timetables unavailable', ''));
      responseContainer.setAttribute('aria-busy', 'false');
      showError(error.name === 'AbortError'
        ? 'Loading timetables timed out. Check your connection and try again.'
        : 'Could not load the timetable list. Check your connection and try again.');
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function copyText(text, button) {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied ✓';
      copyStatus.textContent = 'Copied to clipboard.';
    } catch {
      // Keep the content available to keyboards and browsers without clipboard
      // permission, without changing the page's selected timetable.
      const source = button === copyEndpoint ? endpointCode : document.getElementById(button.dataset.copy);
      const range = document.createRange();
      range.selectNodeContents(source);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      button.textContent = 'Text selected';
      copyStatus.textContent = 'Copy is unavailable. The text is selected; use your keyboard to copy it.';
    }
    window.setTimeout(() => { button.textContent = original; }, 2200);
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); sendRequest(); });
  locationSelect.addEventListener('change', updateEndpoint);
  periodSelect.addEventListener('change', updateEndpoint);
  document.getElementById('retry-request').addEventListener('click', () => {
    if (locationsLoaded) sendRequest(); else loadLocations();
  });
  copyEndpoint.addEventListener('click', () => {
    if (activePath) copyText(new URL(activePath, window.location.origin).href, copyEndpoint);
  });
  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => copyText(document.getElementById(button.dataset.copy).textContent, button));
  });

  // The sidebar keeps its place as a person reads or navigates with anchors.
  if ('IntersectionObserver' in window) {
    const links = [...document.querySelectorAll('.docs-sidebar nav a')];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link) => {
          if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }
    }, { rootMargin: '-100px 0px -55% 0px', threshold: 0 });
    document.querySelectorAll('.doc-section').forEach((section) => observer.observe(section));
  }

  loadLocations();
})();
