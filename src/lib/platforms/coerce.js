// Feed fields reach the page as text, so each adapter reads them through these
// at the boundary: an object or array in a title would otherwise make React
// throw, and String() would turn one into "[object Object]".

// A string as it is, a finite number as its digits, anything else as "".
export function asText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

// The text entries of a list, empty ones dropped; anything but an array is no list.
export function asTexts(value) {
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
}
