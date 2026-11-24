// A matchMedia that honours the query, so a test can resize the "window" and
// have components see the change. Answers `(min-width: <n>px|rem)` from the
// current width and the root font size (a rem is 16px unless a test changes
// it); every other query, such as colour scheme, reads as not matching.
export function createMatchMedia({ width = 1280, remPx = 16 } = {}) {
  const state = { width, remPx };
  const queries = new Set();

  const evaluate = (query) => {
    const m = /^\(min-width:\s*([\d.]+)(px|rem)\)$/.exec(query.trim());
    if (!m) return false;
    const min = Number(m[1]) * (m[2] === "rem" ? state.remPx : 1);
    return state.width >= min;
  };

  const matchMedia = (query) => {
    const listeners = new Set();
    const mql = {
      media: query,
      get matches() {
        return evaluate(query);
      },
      addEventListener: (type, fn) => type === "change" && listeners.add(fn),
      removeEventListener: (type, fn) => type === "change" && listeners.delete(fn),
      addListener: (fn) => listeners.add(fn),
      removeListener: (fn) => listeners.delete(fn),
      last: evaluate(query),
      listeners,
    };
    queries.add(mql);
    return mql;
  };

  // Change the window (width and/or rem size) and fire "change" on every
  // query whose result flipped, like a browser does.
  const resize = (next) => {
    Object.assign(state, next);
    for (const mql of queries) {
      const matches = evaluate(mql.media);
      if (matches === mql.last) continue;
      mql.last = matches;
      for (const fn of [...mql.listeners]) fn({ matches, media: mql.media });
    }
  };

  return { matchMedia, resize, state };
}
