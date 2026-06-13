// storage.js — tiny persistence layer over localStorage.
// Everything is wrapped so a blocked/again private-mode storage never crashes the app.

const KEY = "chaiwithkay.v1";

const fallback = {
  known: [], // ids you've marked "got it"
  streak: { count: 0, last: null }, // day streak
  settings: { showTranslit: true, showGrammar: false },
  session: { date: null, ids: [] }, // today's practice session
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...structuredClone(fallback), ...JSON.parse(raw) } : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — run in-memory for this session */
  }
}

let state = load();

export function getSettings() {
  return state.settings;
}

export function setSetting(key, value) {
  state.settings[key] = value;
  save(state);
}

export function isKnown(id) {
  return state.known.includes(id);
}

export function toggleKnown(id) {
  state.known = isKnown(id)
    ? state.known.filter((x) => x !== id)
    : [...state.known, id];
  save(state);
  return isKnown(id);
}

export function knownCount() {
  return state.known.length;
}

// Bump the streak when you practice. Counts consecutive calendar days.
export function touchStreak() {
  const today = new Date().toDateString();
  const last = state.streak.last;
  if (last === today) return state.streak.count; // already counted today

  const yesterday = new Date(Date.now() - 864e5).toDateString();
  state.streak.count = last === yesterday ? state.streak.count + 1 : 1;
  state.streak.last = today;
  save(state);
  return state.streak.count;
}

export function getStreak() {
  return state.streak.count;
}

// Today's session: up to 10 card ids chosen once per calendar day.
export function getTodaySession() {
  const today = new Date().toDateString();
  if (state.session?.date === today && state.session.ids?.length) {
    return state.session.ids;
  }
  return null;
}

export function saveTodaySession(ids) {
  state.session = { date: new Date().toDateString(), ids };
  save(state);
}
