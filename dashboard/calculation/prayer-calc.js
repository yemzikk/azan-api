// Prayer-time calculation engine for Kerala timetables.
//
// Pure ES module with no imports, so it runs unchanged in Node and in the browser.
// All clock times are minutes after local midnight in the configured UTC offset
// (India Standard Time by default). See PRAYER_CALCULATION.md for the derivation.
// Used by the review page beside this file and by scripts/calc-*.mjs.

export const PRAYERS = Object.freeze(['subh', 'sunrise', 'duhr', 'asar', 'maghrib', 'isha']);
export const IST_OFFSET_MINUTES = 330;

// Sun's centre altitude when its upper limb touches a sea-level horizon:
// 34' of refraction plus 16' of semidiameter.
export const STANDARD_HORIZON = -0.8333;

const RAD = Math.PI / 180;
const sin = (deg) => Math.sin(deg * RAD);
const cos = (deg) => Math.cos(deg * RAD);
const tan = (deg) => Math.tan(deg * RAD);

/** Julian Day at 0h UT of a Gregorian calendar date. */
export function julianDay(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/**
 * Apparent solar declination (degrees) and equation of time (minutes) at a Julian Day.
 * Meeus, Astronomical Algorithms, ch. 25 and 28 (the low-precision series NOAA uses).
 */
export function sunPosition(jd) {
  const t = (jd - 2451545.0) / 36525.0;
  const meanLongitude = (((280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = (1.914602 - t * (0.004817 + 0.000014 * t)) * sin(meanAnomaly)
    + (0.019993 - 0.000101 * t) * sin(2 * meanAnomaly)
    + 0.000289 * sin(3 * meanAnomaly);
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * sin(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cos(omega);
  const declination = Math.asin(sin(obliquity) * sin(apparentLongitude)) / RAD;
  const y = tan(obliquity / 2) ** 2;
  const equationOfTime = 4 * (y * sin(2 * meanLongitude)
    - 2 * eccentricity * sin(meanAnomaly)
    + 4 * eccentricity * y * sin(meanAnomaly) * cos(2 * meanLongitude)
    - 0.5 * y * y * sin(4 * meanLongitude)
    - 1.25 * eccentricity * eccentricity * sin(2 * meanAnomaly)) / RAD;
  return { declination, equationOfTime };
}

/** Minutes between solar noon and the sun standing at `altitude` degrees; NaN if it never does. */
export function hourAngleMinutes(latitude, declination, altitude) {
  const cosH = (sin(altitude) - sin(latitude) * sin(declination)) / (cos(latitude) * cos(declination));
  if (cosH < -1 || cosH > 1) return NaN;
  return (Math.acos(cosH) / RAD) * 4;
}

/** Sun altitude at which a vertical object's shadow is `factor` object-lengths longer than at noon. */
export function asrAltitude(latitude, declination, factor) {
  return Math.atan(1 / (factor + tan(Math.abs(latitude - declination)))) / RAD;
}

/** Extra depression of the visible horizon for an observer `metres` above the surrounding terrain. */
export function horizonDip(metres) {
  return metres > 0 ? 0.0347 * Math.sqrt(metres) : 0;
}

/**
 * Calculation methods. Angles are degrees of solar depression; offsets are minutes
 * added after the astronomical instant; `rounding` is applied last. A method may also
 * set `ishaInterval` (Isha as minutes after sunset) or `fixed` (a constant clock time).
 * `envelope` chooses how a perpetual table resolves year-to-year drift (see below).
 *
 * `kerala-sunni` is the rule recovered from the Assembly Constituency timetables. It is
 * the Samastha convention (Subh 20 degrees, Isha 18 degrees) with the last degree counted
 * as a flat four minutes, plus precautionary minutes. `bias` is an empirical calibration:
 * measured against independent town coordinates, every column of those tables sits the
 * same 0.19 minutes (11 seconds) later than the instant rounded to the nearest minute.
 */
export const METHODS = Object.freeze({
  'kerala-sunni': Object.freeze({
    label: 'Kerala Sunni (Samastha constituency timetables)',
    fajrAngle: 19,
    ishaAngle: 17,
    asrFactor: 1,
    horizon: STANDARD_HORIZON,
    offsets: Object.freeze({ subh: -4, sunrise: 0, duhr: 3, asar: 2, maghrib: 3, isha: 6 }),
    rounding: 'nearest',
    bias: 0.19,
    envelope: 'latest',
  }),
  'kerala-sunni-hanafi': Object.freeze({
    label: 'Kerala Sunni, Hanafi Asr',
    fajrAngle: 19,
    ishaAngle: 17,
    asrFactor: 2,
    horizon: STANDARD_HORIZON,
    offsets: Object.freeze({ subh: -4, sunrise: 0, duhr: 3, asar: 2, maghrib: 3, isha: 6 }),
    rounding: 'nearest',
    bias: 0.19,
    envelope: 'latest',
  }),
  karachi: Object.freeze({
    label: 'University of Islamic Sciences, Karachi (18/18)',
    fajrAngle: 18,
    ishaAngle: 18,
    asrFactor: 1,
    horizon: STANDARD_HORIZON,
    offsets: Object.freeze({ subh: 0, sunrise: 0, duhr: 0, asar: 0, maghrib: 0, isha: 0 }),
    rounding: 'nearest',
    bias: 0,
    envelope: 'mean',
  }),
  mwl: Object.freeze({
    label: 'Muslim World League (18/17)',
    fajrAngle: 18,
    ishaAngle: 17,
    asrFactor: 1,
    horizon: STANDARD_HORIZON,
    offsets: Object.freeze({ subh: 0, sunrise: 0, duhr: 0, asar: 0, maghrib: 0, isha: 0 }),
    rounding: 'nearest',
    bias: 0,
    envelope: 'mean',
  }),
  astronomical: Object.freeze({
    label: 'Astronomical 20/18 with no margins',
    fajrAngle: 20,
    ishaAngle: 18,
    asrFactor: 1,
    horizon: STANDARD_HORIZON,
    offsets: Object.freeze({ subh: 0, sunrise: 0, duhr: 0, asar: 0, maghrib: 0, isha: 0 }),
    rounding: 'nearest',
    bias: 0,
    envelope: 'mean',
  }),
});

/** Resolve a method name or a partial method object into a complete method. */
export function resolveMethod(method = 'kerala-sunni') {
  if (typeof method === 'string') {
    if (!Object.hasOwn(METHODS, method)) throw new Error(`Unknown calculation method: ${method}`);
    return METHODS[method];
  }
  const base = METHODS[method.base ?? 'kerala-sunni'];
  if (!base) throw new Error(`Unknown calculation method: ${method.base}`);
  return { ...base, ...method, offsets: { ...base.offsets, ...(method.offsets ?? {}) } };
}

function validateLocation(latitude, longitude) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new RangeError('latitude must be between -90 and 90');
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new RangeError('longitude must be between -180 and 180');
}

// First guesses (minutes after local midnight); each event is then refined at its own instant.
const GUESS = { subh: 330, sunrise: 390, duhr: 750, asar: 960, maghrib: 1110, isha: 1185 };

function solveEvent(prayer, jdMidnightUt, latitude, longitude, method, utcOffset, dip) {
  let minutes = GUESS[prayer];
  for (let pass = 0; pass < 3; pass += 1) {
    const { declination, equationOfTime } = sunPosition(jdMidnightUt + (minutes - utcOffset) / 1440);
    const noon = 720 - equationOfTime - 4 * longitude + utcOffset;
    const horizon = method.horizon - dip;
    if (prayer === 'duhr') minutes = noon;
    else if (prayer === 'subh') minutes = noon - hourAngleMinutes(latitude, declination, -method.fajrAngle);
    else if (prayer === 'sunrise') minutes = noon - hourAngleMinutes(latitude, declination, horizon);
    else if (prayer === 'asar') minutes = noon + hourAngleMinutes(latitude, declination, asrAltitude(latitude, declination, method.asrFactor));
    else if (prayer === 'maghrib') minutes = noon + hourAngleMinutes(latitude, declination, horizon);
    else minutes = noon + hourAngleMinutes(latitude, declination, -method.ishaAngle);
    if (!Number.isFinite(minutes)) return NaN;
  }
  return minutes;
}

/**
 * Unrounded astronomical instants for one calendar date, before any offsets.
 * Returns minutes after local midnight for each prayer.
 */
export function astronomicalTimes({ year, month, day, latitude, longitude, method, elevation = 0, utcOffset = IST_OFFSET_MINUTES }) {
  validateLocation(latitude, longitude);
  const resolved = resolveMethod(method);
  const dip = horizonDip(elevation);
  const jd = julianDay(year, month, day);
  const times = {};
  for (const prayer of PRAYERS) times[prayer] = solveEvent(prayer, jd, latitude, longitude, resolved, utcOffset, dip);
  // Some timetables define Isha as a fixed interval after sunset instead of a twilight angle.
  if (Number.isFinite(resolved.ishaInterval)) times.isha = times.maghrib + resolved.ishaInterval;
  return times;
}

// ---------------------------------------------------------------------------------------
// Perpetual (year-independent) timetables
//
// A printed timetable repeats the same 366 rows every year, but the real instants wander:
// by about half a minute over the four-year leap cycle and a little more over decades.
// The source calendars resolve this in one of two ways, selected by `method.envelope`:
//
//   'latest'  the latest instant the event reaches in any year from 2021 to 2099, so the
//             time has certainly entered whichever year the table is used in. This is
//             what the Kerala constituency timetables do.
//   'mean'    the average over one leap cycle.
//
// Like the source tables, both sample the sun once per day, at 12:00 local time.
// ---------------------------------------------------------------------------------------

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Within a century the leap cycle drifts steadily, so the extremes of 2021-2099 are
// reached in its first and last four years; the years between cannot exceed them.
export const PERPETUAL_YEARS = Object.freeze({
  latest: Object.freeze([2021, 2022, 2023, 2024, 2096, 2097, 2098, 2099]),
  mean: Object.freeze([2040, 2041, 2042, 2043]),
});

const sampleCache = new Map();

/** The years a perpetual value is drawn from for one calendar date (leap years only for 29 February). */
export function perpetualYears(month, day, envelope = 'latest') {
  const span = PERPETUAL_YEARS[envelope];
  if (!span) throw new Error(`Unknown perpetual envelope: ${envelope}`);
  return month === 2 && day === 29 ? span.filter(isLeapYear) : [...span];
}

/** Sun positions at local noon of one calendar date in each year of a perpetual span. */
export function perpetualSunSamples(month, day, envelope = 'latest', utcOffset = IST_OFFSET_MINUTES) {
  const key = `${envelope}:${month}-${day}:${utcOffset}`;
  let samples = sampleCache.get(key);
  if (!samples) {
    samples = perpetualYears(month, day, envelope).map((year) => sunPosition(julianDay(year, month, day) + (720 - utcOffset) / 1440));
    sampleCache.set(key, samples);
  }
  return samples;
}

/** Unrounded event instants for one sun position, before offsets. */
export function eventsFromSun({ declination, equationOfTime }, latitude, longitude, method, utcOffset = IST_OFFSET_MINUTES, dip = 0) {
  const noon = 720 - equationOfTime - 4 * longitude + utcOffset;
  const horizon = method.horizon - dip;
  const sunset = noon + hourAngleMinutes(latitude, declination, horizon);
  return {
    subh: noon - hourAngleMinutes(latitude, declination, -method.fajrAngle),
    sunrise: noon - hourAngleMinutes(latitude, declination, horizon),
    duhr: noon,
    asar: noon + hourAngleMinutes(latitude, declination, asrAltitude(latitude, declination, method.asrFactor)),
    maghrib: sunset,
    isha: Number.isFinite(method.ishaInterval) ? sunset + method.ishaInterval : noon + hourAngleMinutes(latitude, declination, -method.ishaAngle),
  };
}

/**
 * Every step behind a perpetual value: the sun's position and the six instants in each
 * sampled year, the resulting instants, and which year supplied each one.
 */
export function perpetualBreakdown({ month, day, latitude, longitude, method, elevation = 0, utcOffset = IST_OFFSET_MINUTES }) {
  validateLocation(latitude, longitude);
  const resolved = resolveMethod(method);
  const envelope = resolved.envelope ?? 'latest';
  const dip = horizonDip(elevation);
  const samples = perpetualSunSamples(month, day, envelope, utcOffset);
  const years = perpetualYears(month, day, envelope).map((year, index) => ({
    year, ...samples[index], events: eventsFromSun(samples[index], latitude, longitude, resolved, utcOffset, dip),
  }));
  const times = {};
  const sourceYear = {};
  for (const prayer of PRAYERS) {
    if (envelope === 'mean') {
      times[prayer] = years.reduce((sum, entry) => sum + entry.events[prayer], 0) / years.length;
      sourceYear[prayer] = null;
    } else {
      const latest = years.reduce((best, entry) => (entry.events[prayer] > best.events[prayer] ? entry : best));
      times[prayer] = latest.events[prayer];
      sourceYear[prayer] = latest.year;
    }
  }
  return { envelope, years, times, sourceYear };
}

/** Unrounded perpetual instants for a calendar date, before offsets. */
export function perpetualAstronomicalTimes(options) {
  return perpetualBreakdown(options).times;
}

function roundMinutes(value, rounding) {
  if (!Number.isFinite(value)) return null;
  if (rounding === 'up') return Math.ceil(value);
  if (rounding === 'down') return Math.floor(value);
  if (rounding === 'none') return value;
  return Math.floor(value + 0.5);
}

/**
 * Prayer times for one date as whole minutes after local midnight.
 *
 * @param {object} options
 * @param {number} options.year - Gregorian year; ignored when `perpetual` is true.
 * @param {number} options.month - 1-12.
 * @param {number} options.day - 1-31.
 * @param {number} options.latitude - degrees north.
 * @param {number} options.longitude - degrees east.
 * @param {string|object} [options.method] - a METHODS key or an override object.
 * @param {number} [options.elevation] - metres above the surrounding horizon (0 reproduces the timetables).
 * @param {boolean} [options.perpetual] - use the year-independent table value (see `method.envelope`).
 * @param {number} [options.utcOffset] - minutes east of UTC (330 for IST).
 */
export function prayerTimes(options) {
  const method = resolveMethod(options.method);
  const raw = options.perpetual ? perpetualAstronomicalTimes({ ...options, method }) : astronomicalTimes({ ...options, method });
  const result = {};
  for (const prayer of PRAYERS) {
    const fixed = method.fixed?.[prayer];
    result[prayer] = Number.isFinite(fixed)
      ? fixed
      : roundMinutes(raw[prayer] + (method.offsets[prayer] ?? 0) + (method.bias ?? 0), method.rounding);
  }
  return result;
}

/** Minutes after midnight as a 12-hour clock string such as "5:23 AM". */
export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(mins).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Every calendar date of a year as { month, day }. */
export function datesOfYear(year) {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths.flatMap((length, index) => Array.from({ length }, (_, offset) => ({ month: index + 1, day: offset + 1 })));
}

/** A full timetable: one row per date with whole-minute prayer times. */
export function timetable({ year, perpetual = false, ...location }) {
  const dates = perpetual ? datesOfYear(2040) : datesOfYear(year);
  return dates.map(({ month, day }) => ({ month, day, ...prayerTimes({ ...location, year, month, day, perpetual }) }));
}
