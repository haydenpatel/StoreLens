// Shared helpers for tests that touch localStorage or fetch. See README.md.

export function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
  };
}

export function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, statusText: ok ? "OK" : "Error", json: async () => body };
}
