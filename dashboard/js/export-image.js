import { PRAYERS, normalizeDate, formatDate, formatTime } from './prayer-data.js';

const COLORS = Object.freeze({
  paper: '#f8f9f5', white: '#ffffff', green: '#214e3b', ink: '#264235',
  muted: '#697c6a', line: '#dfe6d9', soft: '#edf2e7', gold: '#d6c28d', light: '#c3d3bc',
});
const SANS = '"Atkinson Hyperlegible Next", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const CAPTIONS = { subh: 'Dawn prayer', sunrise: 'End of Fajr time', duhr: 'Midday prayer', asar: 'Afternoon prayer', maghrib: 'Sunset prayer', isha: 'Night prayer' };

function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r); ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height); ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r); ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function text(ctx, value, x, y, size, color = COLORS.ink, weight = 400, family = SANS, align = 'left') {
  ctx.font = `${weight} ${size}px ${family}`; ctx.fillStyle = color;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(String(value), x, y);
}

function fitText(ctx, value, maxWidth, size, minSize = 20, weight = 400, family = SANS) {
  let fitted = size;
  while (fitted > minSize) {
    ctx.font = `${weight} ${fitted}px ${family}`;
    if (ctx.measureText(value).width <= maxWidth) break;
    fitted -= 1;
  }
  return fitted;
}

function wrap(ctx, value, maxWidth, fontSize, weight = 400, family = SANS) {
  ctx.font = `${weight} ${fontSize}px ${family}`;
  const lines = []; let line = '';
  for (const word of String(value).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) { line = next; continue; }
    if (line) lines.push(line);
    line = '';
    for (const char of word) {
      if (ctx.measureText(line + char).width > maxWidth && line) { lines.push(line); line = char; }
      else line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function line(ctx, x1, y1, x2, y2, color = COLORS.line, width = 1.5) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function crescent(ctx, x, y, radius, fill, background) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = background; ctx.beginPath(); ctx.arc(x + radius * .43, y - radius * .32, radius * .88, 0, Math.PI * 2); ctx.fill();
}

/** Architectural arch and crescent, rendered as vectors so exports stay crisp. */
function brandMark(ctx, x, y, size) {
  roundedRect(ctx, x, y, size, size, size * .25, '#2d5b46', '#6f8a65');
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 80, size / 80);
  ctx.beginPath(); ctx.moveTo(20, 61); ctx.lineTo(20, 39);
  ctx.bezierCurveTo(20, 24, 35, 23, 40, 15); ctx.bezierCurveTo(45, 23, 60, 24, 60, 39);
  ctx.lineTo(60, 61); ctx.strokeStyle = '#e0d5b0'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.stroke();
  line(ctx, 15, 65, 65, 65, '#e0d5b0', 2.8);
  crescent(ctx, 39, 42, 11, '#e0d5b0', '#2d5b46'); ctx.restore();
}

function drawBrand(ctx, { width, scale = 1, logo } = {}) {
  const x = 72 * scale; const y = 58 * scale; const size = 70 * scale;
  if (logo) ctx.drawImage(logo, x, y, size, size); else brandMark(ctx, x, y, size);
  text(ctx, 'AzanTimes', x + size + 21 * scale, y + 39 * scale, 35 * scale, COLORS.white, 600);
  text(ctx, 'PRAYER TIMES · KERALA', x + size + 22 * scale, y + 64 * scale, 11 * scale, COLORS.light, 500);
  text(ctx, 'azantimes.in', width - x, y + 36 * scale, 17 * scale, COLORS.light, 400, SANS, 'right');
}

function prayerIcon(ctx, key, x, y, size) {
  const color = ['sunrise', 'maghrib'].includes(key) ? '#ab8b4c' : '#668165';
  roundedRect(ctx, x - size / 2, y - size / 2, size, size, size / 2, COLORS.soft);
  if (['subh', 'isha'].includes(key)) { crescent(ctx, x - 1, y, size * .22, color, COLORS.soft); return; }
  const radius = size * .13;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const angle = i * Math.PI / 4;
    line(ctx, x + Math.cos(angle) * size * .21, y + Math.sin(angle) * size * .21, x + Math.cos(angle) * size * .29, y + Math.sin(angle) * size * .29, color, 2);
  }
  if (['sunrise', 'maghrib'].includes(key)) {
    ctx.fillStyle = COLORS.soft; ctx.fillRect(x - size * .33, y + size * .1, size * .66, size * .24);
    line(ctx, x - size * .29, y + size * .11, x + size * .29, y + size * .11, color, 2);
  }
}

function drawTime(ctx, raw, x, y, use24Hour, size = 51) {
  const formatted = formatTime(raw, use24Hour);
  const [time, suffix] = formatted.split(' ');
  text(ctx, time, x, y, size, COLORS.ink, 600);
  if (suffix) {
    const width = ctx.measureText(time).width;
    text(ctx, suffix, x + width + 11, y - 3, Math.round(size * .43), COLORS.muted, 500);
  }
}

function drawDaily(ctx, { location, rows, use24Hour, logo, attribution, width, height }) {
  ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.green; ctx.fillRect(0, 0, width, 445);
  drawBrand(ctx, { width, logo });
  line(ctx, 72, 159, width - 72, 159, '#ffffff22');
  text(ctx, 'PRAYER TIMES', 72, 210, 15, COLORS.gold, 600);
  const labelSize = fitText(ctx, location.label, width - 144, 51, 34, 500);
  const labels = wrap(ctx, location.label, width - 144, labelSize, 500);
  // Location labels are bounded to two lines without crowding the date block.
  labels.slice(0, 2).forEach((label, index) => text(ctx, label, 72, 274 + index * 49, labelSize, COLORS.white, 500));
  const subtitleY = labels.length > 1 ? 354 : 316;
  text(ctx, [location.district && location.district !== 'Other locations' ? location.district : 'Local timetable', 'India'].join(' · '), 74, subtitleY, 20, COLORS.light);
  const row = rows[0];
  const date = formatDate(row.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  text(ctx, date, 74, 403, fitText(ctx, date, width - 150, 29, 23), '#e8ecdc', 400, SERIF);
  const cardWidth = 455; const cardHeight = 186; const gap = 26; const top = 490;
  PRAYERS.forEach((prayer, index) => {
    const x = 72 + (index % 2) * (cardWidth + gap); const y = top + Math.floor(index / 2) * (cardHeight + 22);
    roundedRect(ctx, x, y, cardWidth, cardHeight, 18, COLORS.white, COLORS.line);
    prayerIcon(ctx, prayer.key, x + 49, y + 47, 50);
    text(ctx, prayer.label, x + 89, y + 54, 23, COLORS.ink, 500);
    drawTime(ctx, row[prayer.key], x + 29, y + 127, use24Hour);
    text(ctx, row[prayer.key] ? CAPTIONS[prayer.key] : 'Time unavailable', x + 30, y + 160, 16, COLORS.muted);
  });
  const footerY = 1175;
  line(ctx, 72, footerY, width - 72, footerY);
  text(ctx, 'PRAYER START TIMES · INDIAN STANDARD TIME (UTC +05:30)', 73, footerY + 39, 14, COLORS.green, 600);
  text(ctx, 'Follow your local timetable. Confirm jama’ah times with your mosque.', 73, footerY + 74, 17, COLORS.muted);
  text(ctx, 'azantimes.in', 73, height - 45, 23, COLORS.green, 600);
  if (attribution) ctx.drawImage(attribution, width - 343, height - 73, 270, 40);
}

function drawMonthly(ctx, { location, rows, use24Hour, logo, attribution, width, height }) {
  const margin = 92; const rowHeight = 56; const tableTop = 390; const headerHeight = 66;
  ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.green; ctx.fillRect(0, 0, width, 337);
  drawBrand(ctx, { width, scale: 1.15, logo });
  const label = location.label;
  text(ctx, label, margin, 224, fitText(ctx, label, width - margin * 2, 54, 29, 500), COLORS.white, 500);
  const month = formatDate(rows[0].date, { weekday: undefined, day: undefined, month: 'long', year: 'numeric' });
  text(ctx, `${month} · Prayer timetable`, margin, 287, 36, '#d4dfc6', 400, SERIF);
  const tableWidth = width - margin * 2; const dateWidth = 290; const cellWidth = (tableWidth - dateWidth) / PRAYERS.length;
  roundedRect(ctx, margin, tableTop, tableWidth, headerHeight + rows.length * rowHeight, 14, COLORS.white, COLORS.line);
  ctx.save();
  // Clip the table header and alternating rows to the same rounded boundary.
  roundedRect(ctx, margin, tableTop, tableWidth, headerHeight + rows.length * rowHeight, 14);
  ctx.clip(); ctx.fillStyle = COLORS.soft; ctx.fillRect(margin, tableTop, tableWidth, headerHeight);
  text(ctx, 'DATE', margin + 25, tableTop + 42, 20, COLORS.green, 600);
  PRAYERS.forEach(({ label: prayer }, index) => text(ctx, prayer, margin + dateWidth + cellWidth * (index + .5), tableTop + 42, 24, COLORS.green, 600, SANS, 'center'));
  rows.forEach((row, index) => {
    const y = tableTop + headerHeight + index * rowHeight;
    if (index % 2) { ctx.fillStyle = '#f5f7ef'; ctx.fillRect(margin, y, tableWidth, rowHeight); }
    const date = formatDate(row.date, { weekday: 'short', day: 'numeric', month: 'short', year: undefined });
    text(ctx, date, margin + 25, y + 37, 24, COLORS.ink, 500);
    PRAYERS.forEach(({ key }, column) => text(ctx, formatTime(row[key], use24Hour), margin + dateWidth + cellWidth * (column + .5), y + 37, 25, COLORS.ink, 400, SANS, 'center'));
    line(ctx, margin, y + rowHeight, width - margin, y + rowHeight, '#e7ebdf', 1);
  });
  ctx.restore();
  const footerY = tableTop + headerHeight + rows.length * rowHeight + 50;
  text(ctx, 'All times in Indian Standard Time (UTC +05:30). Sunrise marks the end of Fajr and is not a prayer.', margin, footerY, 21, COLORS.muted);
  text(ctx, 'Confirm congregation (jama’ah) times with your local mosque.', margin, footerY + 35, 21, COLORS.muted);
  line(ctx, margin, height - 103, width - margin, height - 103);
  text(ctx, 'azantimes.in', margin, height - 53, 27, COLORS.green, 600);
  if (attribution) ctx.drawImage(attribution, width - margin - 340, height - 88, 340, 51);
}

async function optionalLogo(logoUrl) {
  if (!logoUrl) return null;
  // Keep exports origin-clean. Unknown remote artwork is replaced by the native mark.
  let url;
  try { url = new URL(logoUrl, document.baseURI); } catch { return null; }
  if (url.origin !== window.location.origin && url.protocol !== 'data:') return null;
  return new Promise((resolve) => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), 1800);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = url.href;
  });
}

/**
 * Render a shareable PNG without modifying the page or initiating a download.
 * The caller owns save/share behavior. Returns { blob, filename, width, height }.
 * Yearly exports should use CSV; choose a month for a readable image.
 */
export async function exportPrayerImage({ location, rows, period = 'day', use24Hour = false, logoUrl } = {}) {
  if (!['day', 'month'].includes(period)) throw new Error('Choose Daily or Monthly to export a readable image. Use CSV for a full year.');
  if (!location?.label || typeof location.label !== 'string') throw new Error('Choose a timetable location before exporting.');
  if (!Array.isArray(rows) || !rows.length) throw new Error('Choose a date with a published timetable to export.');
  if (period === 'day' && rows.length !== 1 || period === 'month' && rows.length > 31) throw new Error('Choose one day or one month for an image export.');
  const normalizedRows = rows.map((row) => {
    const date = normalizeDate(row?.date);
    if (!date) throw new Error('The timetable includes an invalid date and could not be exported.');
    return { ...row, date };
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (new Set(normalizedRows.map(({ date }) => date)).size !== normalizedRows.length) throw new Error('The timetable includes duplicate dates and could not be exported.');
  if (period === 'month' && new Set(normalizedRows.map(({ date }) => date.slice(0, 7))).size !== 1) throw new Error('Select a single month for an image export.');
  const width = period === 'day' ? 1080 : 1800;
  const height = period === 'day' ? 1350 : 390 + 66 + normalizedRows.length * 56 + 233;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Image export is unavailable in this browser. Please use CSV instead.');
  await document.fonts?.ready;
  const [logo, attribution] = await Promise.all([
    optionalLogo(logoUrl),
    optionalLogo(new URL('../brand/zikklabs-product-badge.svg', import.meta.url).href),
  ]);
  const args = { location, rows: normalizedRows, use24Hour, logo, attribution, width, height };
  if (period === 'day') drawDaily(ctx, args); else drawMonthly(ctx, args);
  const blob = await new Promise((resolve, reject) => {
    try { canvas.toBlob((result) => result ? resolve(result) : reject(new Error('The image could not be created. Please try again.')), 'image/png'); }
    catch { reject(new Error('The image could not be exported. Please use CSV instead.')); }
  });
  const identifier = String(location.id || location.label).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
  const datePart = normalizedRows[0].date.slice(0, period === 'day' ? 10 : 7);
  return { blob, filename: `AzanTimes-${identifier}-${datePart}.png`, width, height };
}
