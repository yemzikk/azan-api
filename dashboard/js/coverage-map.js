// Zoom, panning and pointer labels for the coverage map on /locations (scripts/seo-pages.mjs).
// The map works without this script: every area and dot is a plain link.
(() => {
  const figure = document.querySelector('[data-coverage-map]');
  const svg = figure?.querySelector('.map-svg');
  if (!svg) return;
  const frame = figure.querySelector('.map-frame');
  const tip = figure.querySelector('.map-tip');
  const controls = figure.querySelector('.map-controls');
  const width = Number(svg.dataset.width);
  const height = Number(svg.dataset.height);
  const MAX_ZOOM = 10;
  const NAMES_FROM = 3.5; // Constituency names appear from this zoom; district names before it.
  // Sizes on screen, in CSS pixels, whatever the zoom.
  const SIZE = { point: 1.8, calendar: 3.6, group: 4.4, district: 11, area: 10 };
  const points = [...svg.querySelectorAll('.map-points circle')];
  const calendars = [...svg.querySelectorAll('.map-calendar circle')];
  const districtLabels = svg.querySelector('.map-district-labels');
  const areaLabels = svg.querySelector('.map-area-labels');
  let view = { x: 0, y: 0, w: width, h: height };

  const zoom = () => width / view.w;
  function clamp(next) {
    const w = Math.min(width, Math.max(width / MAX_ZOOM, next.w));
    const h = w * (height / width);
    return { w, h, x: Math.min(width - w, Math.max(0, next.x)), y: Math.min(height - h, Math.max(0, next.y)) };
  }
  function render() {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const unitsPerPixel = view.w / (svg.getBoundingClientRect().width || width);
    const k = zoom();
    for (const circle of points) circle.setAttribute('r', SIZE.point * unitsPerPixel * Math.min(2, Math.sqrt(k)));
    for (const circle of calendars) circle.setAttribute('r', (circle.parentNode.classList.contains('is-group') ? SIZE.group : SIZE.calendar) * unitsPerPixel);
    districtLabels.setAttribute('font-size', SIZE.district * unitsPerPixel);
    areaLabels.setAttribute('font-size', SIZE.area * unitsPerPixel);
    figure.classList.toggle('is-zoomed', k > 1.01);
    figure.classList.toggle('show-names', k >= NAMES_FROM);
    controls.querySelector('[data-zoom="in"]').disabled = k >= MAX_ZOOM - 0.01;
    controls.querySelector('[data-zoom="out"]').disabled = k <= 1.01;
    controls.querySelector('[data-zoom="reset"]').disabled = k <= 1.01;
  }
  // Zoom by `factor`, keeping the map point under (px, py) in place.
  function zoomAt(px, py, factor) {
    const w = view.w / factor;
    const scale = w / view.w;
    view = clamp({ w, x: px - (px - view.x) * scale, y: py - (py - view.y) * scale });
    render();
  }
  const toMap = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    return [view.x + ((clientX - rect.left) / rect.width) * view.w, view.y + ((clientY - rect.top) / rect.height) * view.h];
  };
  const centre = () => [view.x + view.w / 2, view.y + view.h / 2];

  controls.addEventListener('click', (event) => {
    const button = event.target.closest('[data-zoom]');
    if (!button) return;
    if (button.dataset.zoom === 'reset') { view = { x: 0, y: 0, w: width, h: height }; render(); return; }
    zoomAt(...centre(), button.dataset.zoom === 'in' ? 1.8 : 1 / 1.8);
  });
  // Ctrl (or Cmd) and scroll zooms; plain scrolling keeps scrolling the page.
  svg.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomAt(...toMap(event.clientX, event.clientY), Math.exp(-event.deltaY * 0.003));
  }, { passive: false });

  // Drag to pan, two fingers to pinch. A drag never opens the link it started on.
  const pointers = new Map();
  let gesture = null;
  let dragged = false;
  svg.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    dragged = false;
    gesture = { view: { ...view }, start: [...pointers.values()].map((point) => [...point]) };
  });
  svg.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) { showTip(event); return; }
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    const now = [...pointers.values()];
    const rect = svg.getBoundingClientRect();
    if (now.length === 1 && gesture.start.length === 1) {
      const dx = now[0][0] - gesture.start[0][0];
      const dy = now[0][1] - gesture.start[0][1];
      if (!dragged && Math.hypot(dx, dy) < 5) return;
      if (zoom() <= 1.01 && event.pointerType !== 'mouse') return; // Let the page scroll.
      dragged = true; hideTip();
      svg.setPointerCapture(event.pointerId);
      view = clamp({ ...gesture.view, x: gesture.view.x - (dx / rect.width) * gesture.view.w, y: gesture.view.y - (dy / rect.height) * gesture.view.h });
      render();
    } else if (now.length === 2 && gesture.start.length === 2) {
      dragged = true; hideTip();
      const distance = (pair) => Math.hypot(pair[0][0] - pair[1][0], pair[0][1] - pair[1][1]);
      const middle = (pair) => [(pair[0][0] + pair[1][0]) / 2, (pair[0][1] + pair[1][1]) / 2];
      const factor = distance(now) / Math.max(1, distance(gesture.start));
      const [sx, sy] = middle(gesture.start);
      const [mx, my] = middle(now);
      const anchor = [gesture.view.x + ((sx - rect.left) / rect.width) * gesture.view.w, gesture.view.y + ((sy - rect.top) / rect.height) * gesture.view.h];
      const w = gesture.view.w / factor;
      view = clamp({ w, x: anchor[0] - ((mx - rect.left) / rect.width) * w, y: anchor[1] - ((my - rect.top) / rect.height) * (w * height / width) });
      render();
    }
  });
  const release = (event) => {
    pointers.delete(event.pointerId);
    gesture = pointers.size ? { view: { ...view }, start: [...pointers.values()].map((point) => [...point]) } : null;
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('click', (event) => { if (dragged) { event.preventDefault(); event.stopPropagation(); dragged = false; } }, true);
  // Two-finger gestures belong to the map; one finger scrolls the page until the map is zoomed.
  svg.addEventListener('touchstart', (event) => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });

  // Labels that follow the pointer, in the brand style.
  let tipFor = null;
  function showTip(event) {
    const target = event.target.closest?.('[data-name]');
    if (!target || event.pointerType === 'touch') { hideTip(); return; }
    if (tipFor !== target) {
      tipFor?.classList.remove('is-active');
      tipFor = target;
      target.classList.add('is-active');
      tip.innerHTML = '';
      const name = document.createElement('strong');
      name.textContent = target.dataset.name;
      const detail = document.createElement('span');
      detail.textContent = target.dataset.detail ?? '';
      tip.append(name, detail);
      tip.hidden = false;
    }
    const rect = frame.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const flip = x > rect.width * 0.55;
    tip.style.left = `${flip ? x - 14 : x + 14}px`;
    tip.style.top = `${y}px`;
    tip.classList.toggle('flip', flip);
  }
  function hideTip() { tipFor?.classList.remove('is-active'); tipFor = null; tip.hidden = true; }
  svg.addEventListener('pointerleave', hideTip);

  controls.hidden = false;
  figure.querySelector('.map-hint').hidden = false;
  figure.classList.add('is-interactive');
  addEventListener('resize', render);
  render();
})();
