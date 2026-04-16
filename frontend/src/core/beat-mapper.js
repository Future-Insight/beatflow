export function buildBeatSegments(beatTimes, duration) {
  const beats = Array.isArray(beatTimes) ? beatTimes.map((x) => Number(x)).filter(Number.isFinite) : [];
  const dur = Number(duration);
  const end = Number.isFinite(dur) && dur > 0 ? dur : (beats.length ? beats[beats.length - 1] : 0);

  const segments = [];
  for (let i = 0; i < beats.length; i += 1) {
    const start = beats[i];
    const segEnd = i + 1 < beats.length ? beats[i + 1] : end;
    if (Number.isFinite(start) && Number.isFinite(segEnd) && segEnd > start) {
      segments.push({ index: i, start, end: segEnd, duration: segEnd - start });
    }
  }
  return segments;
}

export function assignImagesToSegments(segments, images) {
  const imgs = Array.isArray(images) ? images : [];
  if (imgs.length === 0) return segments.map((s) => ({ ...s, image: null, imageIndex: -1 }));
  return segments.map((s, i) => {
    const imageIndex = i % imgs.length;
    return { ...s, image: imgs[imageIndex], imageIndex };
  });
}

