// Handles are lowercase; a pasted one may be percent-encoded or mixed case.
export function decodeHandle(raw) {
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}
