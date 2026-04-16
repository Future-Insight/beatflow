const PREFIX = "vaf_web:";

export function loadString(key, fallback = "") {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

export function saveString(key, value) {
  try {
    localStorage.setItem(PREFIX + key, String(value));
  } catch {
    // ignore
  }
}

export function saveResult(result) {
  try {
    localStorage.setItem(PREFIX + "lastResult", JSON.stringify(result));
  } catch {
    // ignore
  }
}

export function loadResult() {
  try {
    const s = localStorage.getItem(PREFIX + "lastResult");
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
