// Location search for the timetable picker. Ranks names that start with the query first and
// understands the older English spellings people still type for Kerala places.

// Each group lists the spelling used in our timetables first, then the alternatives.
const SPELLINGS = [
  ['kozhikode', 'calicut', 'kozhikkode'],
  ['thiruvananthapuram', 'trivandrum', 'tvm', 'trivandram'],
  ['kochi', 'cochin'],
  ['ernakulam', 'ekm'],
  ['alappuzha', 'alleppey', 'alappey', 'alapuzha'],
  ['koyilandy', 'quilandy', 'quilandi', 'koyilandi'],
  ['kuttiady', 'kuttiadi', 'kuttyadi', 'kuttyady'],
  ['payyanur', 'payyannur'],
  ['palakkad', 'palghat', 'palakad'],
  ['kannur', 'cannanore'],
  ['thalassery', 'tellicherry', 'thalasseri'],
  ['kollam', 'quilon'],
  ['thrissur', 'trichur', 'thrisur'],
  ['vadakara', 'badagara', 'vatakara'],
  ['kasaragod', 'kasargod', 'kasaragode', 'kasargode'],
  ['shornur', 'shoranur'],
  ['manjeshwaram', 'manjeshwar', 'manjeswaram', 'manjeswar'],
  ['mattanur', 'mattannur'],
  ['dharmadom', 'dharmadam'],
  ['aluva', 'alwaye'],
  ['kodungallur', 'cranganore'],
  ['changanassery', 'changanacherry'],
  ['udma', 'uduma'],
  ['taliparamba', 'thaliparamba'],
  ['thrikaripur', 'trikaripur'],
  ['tirur', 'thirur'],
  ['tirurangadi', 'thirurangadi'],
  ['tanur', 'thanur'],
  ['tarur', 'tharur'],
  ['wadakkanchery', 'vadakkanchery'],
  ['wandoor', 'vandoor'],
  ['sulthan', 'sultan'],
  ['bathery', 'battery'],
  ['malappuram', 'mlp'],
  ['pathanamthitta', 'pta'],
  ['mannarkkad', 'mannarkad', 'mannarghat'],
  ['muvattupuzha', 'moovattupuzha'],
  ['guruvayur', 'guruvayoor'],
  ['kuthuparamba', 'koothuparamba'],
  ['pala', 'palai'],
  ['vypin', 'vypeen'],
];

const ALTERNATES = new Map();
for (const [main, ...others] of SPELLINGS) {
  for (const word of [main, ...others]) ALTERNATES.set(word, [main, ...others].filter((other) => other !== word));
}

/** Lower case, accents removed, and anything that is not a letter or digit turned into a space. */
export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A looser form for spellings that differ in small ways: doubled letters, th or t, oo or u,
 * ee or i, w or v, and a final y or i (Kuttiady, Kuttiadi; Mattannur, Mattanur).
 */
export function looseSearch(value) {
  return normalizeSearch(value).split(' ').map((word) => word
    .replace(/th/g, 't').replace(/oo/g, 'u').replace(/ee/g, 'i').replace(/w/g, 'v')
    .replace(/y$/, 'i').replace(/([a-z])\1+/g, '$1')).join(' ');
}

/** Other spellings for the words in a name, so "Calicut" finds Kozhikode. */
export function alternateNames(text) {
  const extra = new Set();
  for (const word of normalizeSearch(text).split(' ')) for (const other of ALTERNATES.get(word) ?? []) extra.add(other);
  return [...extra];
}

/** Precomputes the search fields for one location. */
export function searchFields({ label = '', district = '', id = '' }) {
  const name = normalizeSearch(label);
  const words = [...name.split(' '), ...alternateNames(label)].filter(Boolean);
  const place = normalizeSearch(district);
  const places = [...place.split(' '), ...alternateNames(district)].filter(Boolean);
  const all = [...words, ...places, normalizeSearch(id)].join(' ');
  const loose = (list) => list.map(looseSearch);
  return {
    name, words, place, places, all,
    loose: { name: looseSearch(name), words: loose(words), place: looseSearch(place), places: loose(places), all: looseSearch(all) },
  };
}

// Lower is better: 0 exact name, 1 name starts with the query, 2 a word in the name starts
// with it, 3 every query word starts a word in the name, 4 district, 5 words anywhere, 6 text anywhere.
function rank(fields, query) {
  const { name, words, place, places, all } = fields;
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (words.some((word) => word.startsWith(query)) || name.includes(` ${query}`)) return 2;
  const parts = query.split(' ');
  if (parts.length > 1 && parts.every((part) => words.some((word) => word.startsWith(part)))) return 3;
  if (place.startsWith(query) || places.some((word) => word.startsWith(query))) return 4;
  const allWords = all.split(' ');
  if (parts.every((part) => allWords.some((word) => word.startsWith(part)))) return 5;
  if (parts.every((part) => all.includes(part))) return 6;
  return null;
}

/** Score for one location, or null when it does not match. */
export function searchScore(location, query) {
  const text = normalizeSearch(query);
  if (!text) return 0;
  const fields = location.search ?? searchFields(location);
  const exact = rank(fields, text);
  if (exact !== null) return exact;
  // Spelling variations are tried only after an ordinary match fails, never for short input
  // (it would match too much while someone is still typing), and only at the start of a word.
  if (text.replace(/ /g, '').length < 5) return null;
  const loose = rank(fields.loose, looseSearch(text));
  return loose === null || loose > 5 ? null : loose + 0.5;
}

/** Locations that match the query, best first. Constituencies come before calendars on a tie. */
export function searchLocations(locations, query) {
  if (!normalizeSearch(query)) return [...locations];
  const scored = [];
  locations.forEach((location, index) => {
    const score = searchScore(location, query);
    if (score !== null) scored.push({ location, score, index });
  });
  const constituency = (location) => (/_Assembly_Constituency$/i.test(location.id) ? 0 : 1);
  return scored.sort((a, b) => a.score - b.score
    || constituency(a.location) - constituency(b.location)
    || a.index - b.index).map(({ location }) => location);
}
