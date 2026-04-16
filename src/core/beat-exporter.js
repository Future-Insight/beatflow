function _downloadBlob(filename, blob) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadBeatsJSON(result, filename = "beats.json") {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
  _downloadBlob(filename, blob);
}

export function downloadBeatsCSV(result, filename = "beats.csv") {
  const beatTimes = Array.isArray(result?.beat_times) ? result.beat_times : [];
  const lines = ["Index,Time (seconds),Type"];
  for (let i = 0; i < beatTimes.length; i += 1) {
    const t = Number(beatTimes[i]);
    lines.push(`${i},${Number.isFinite(t) ? t.toFixed(3) : ""},main`);
  }
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
  _downloadBlob(filename, blob);
}

