function findClosestIndex(sortedTimes, t) {
  // 返回最接近 t 的 index（假设 sortedTimes 单调递增）
  const n = sortedTimes.length;
  if (n === 0) return -1;
  if (t <= sortedTimes[0]) return 0;
  if (t >= sortedTimes[n - 1]) return n - 1;

  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] === t) return mid;
    if (sortedTimes[mid] < t) lo = mid;
    else hi = mid;
  }
  return (t - sortedTimes[lo]) <= (sortedTimes[hi] - t) ? lo : hi;
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export class BeatPlayer {
  constructor({ waveformEl, overlayEl }) {
    this.waveformEl = waveformEl;
    this.overlayEl = overlayEl;
    this.ws = null;
    this.audioUrl = null;
    this.beatTimes = [];
    this.duration = 0;
    this.activeBeatIndex = -1;
    this._resizeObs = null;
  }

  destroy() {
    if (this._resizeObs) this._resizeObs.disconnect();
    this._resizeObs = null;
    this._setActiveBeat(-1);

    if (this.ws) {
      try { this.ws.destroy(); } catch { /* ignore */ }
    }
    this.ws = null;

    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;

    this.beatTimes = [];
    this.duration = 0;
    clearChildren(this.overlayEl);
  }

  async load({ audioFile, beatTimes, duration }) {
    this.destroy();

    const beats = Array.isArray(beatTimes) ? beatTimes.map((x) => Number(x)).filter(Number.isFinite) : [];
    beats.sort((a, b) => a - b);
    this.beatTimes = beats;

    const dur = Number(duration);
    this.duration = Number.isFinite(dur) && dur > 0 ? dur : 0;

    const WaveSurfer = window.WaveSurfer;
    if (!WaveSurfer) throw new Error("WaveSurfer 加载失败（请检查网络/CDN）");

    this.ws = WaveSurfer.create({
      container: this.waveformEl,
      height: 96,
      waveColor: "#2f81f7",
      progressColor: "#1f6feb",
      cursorColor: "#e6edf3",
      normalize: true,
    });

    this.audioUrl = URL.createObjectURL(audioFile);
    await this.ws.load(this.audioUrl);

    this.ws.on("ready", () => {
      const d = this.ws.getDuration();
      if (!this.duration && Number.isFinite(d) && d > 0) this.duration = d;
      this._renderBeatMarkers();
    });

    this.ws.on("timeupdate", (t) => {
      const i = findClosestIndex(this.beatTimes, t);
      this._setActiveBeat(i);
    });

    // 尽量保证缩放/窗口变化后标记位置仍然正确
    this._resizeObs = new ResizeObserver(() => this._renderBeatMarkers());
    this._resizeObs.observe(this.waveformEl);

    this._renderBeatMarkers();
  }

  playPause() {
    if (!this.ws) return;
    this.ws.playPause();
  }

  isReady() {
    return !!this.ws;
  }

  _renderBeatMarkers() {
    clearChildren(this.overlayEl);
    const dur = this.duration || (this.ws ? this.ws.getDuration() : 0);
    if (!dur || !Number.isFinite(dur) || dur <= 0) return;

    for (let i = 0; i < this.beatTimes.length; i += 1) {
      const t = this.beatTimes[i];
      const leftPct = Math.max(0, Math.min(100, (t / dur) * 100));
      const m = document.createElement("div");
      m.className = "beat-marker";
      m.style.left = `${leftPct}%`;
      m.dataset.index = String(i);
      this.overlayEl.appendChild(m);
    }
    this._setActiveBeat(this.activeBeatIndex);
  }

  _setActiveBeat(i) {
    this.activeBeatIndex = i;
    const nodes = this.overlayEl.querySelectorAll(".beat-marker");
    for (const n of nodes) {
      const idx = Number(n.dataset.index);
      if (idx === i) n.classList.add("active");
      else n.classList.remove("active");
    }
  }
}

