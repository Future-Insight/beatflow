// 预览播放器：根据 wavesurfer 的 currentTime 在"9:16 预览窗口"里切图，
// 并维护一条精简时间线（节拍刻度 + 播放头 + 当前进度填充 + 点击跳转）。
//
// 和 BeatPlayer 解耦：它只需要一个提供 currentTime / duration / 事件订阅的对象，
// 所以我们直接接管 BeatPlayer.ws（wavesurfer 实例）的事件。

function fmt(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export class PreviewPlayer {
  constructor({
    stageEl,
    scrubEl,
    fillEl,
    beatsEl,
    playheadEl,
    timeEl,
    stageTimeEl,
    stageHudEl,
    stageEmptyEl,
    playBtn,
  }) {
    this.stageEl = stageEl;
    this.scrubEl = scrubEl;
    this.fillEl = fillEl;
    this.beatsEl = beatsEl;
    this.playheadEl = playheadEl;
    this.timeEl = timeEl;
    this.stageTimeEl = stageTimeEl;
    this.stageHudEl = stageHudEl;
    this.stageEmptyEl = stageEmptyEl;
    this.playBtn = playBtn;

    this.segments = [];
    this.duration = 0;
    this.ws = null;
    this._imgEls = new Map(); // File -> <img>
    this._activeFile = null;
    this._raf = 0;
    this._dragging = false;

    this._onScrub = this._onScrub.bind(this);
    this._onScrubDown = this._onScrubDown.bind(this);
    this._onScrubMove = this._onScrubMove.bind(this);
    this._onScrubUp = this._onScrubUp.bind(this);

    this.scrubEl.addEventListener("mousedown", this._onScrubDown);
    this.scrubEl.addEventListener("click", this._onScrub);
    this.playBtn.addEventListener("click", () => this._togglePlay());
  }

  // 挂上 wavesurfer 实例（BeatPlayer.ws），跟随播放进度更新 UI
  bindWaveSurfer(ws) {
    this.ws = ws || null;
    this._cancelRAF();
    if (!this.ws) {
      this._setPlayingUI(false);
      return;
    }
    const tick = () => {
      this._updatePlayhead();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
    this.ws.on("play", () => this._setPlayingUI(true));
    this.ws.on("pause", () => this._setPlayingUI(false));
    this.ws.on("finish", () => this._setPlayingUI(false));
  }

  setSegments(segments, duration) {
    this.segments = Array.isArray(segments) ? segments : [];
    this.duration = Number(duration) || 0;
    if (!this.duration && this.segments.length) {
      this.duration = this.segments[this.segments.length - 1]?.end || 0;
    }
    this._rebuildImages();
    this._renderBeats();
    this._updatePlayhead();
    this._refreshEmptyState();
  }

  destroy() {
    this._cancelRAF();
    this.scrubEl.removeEventListener("mousedown", this._onScrubDown);
    this.scrubEl.removeEventListener("click", this._onScrub);
    window.removeEventListener("mousemove", this._onScrubMove);
    window.removeEventListener("mouseup", this._onScrubUp);
    this._clearImages();
    this.ws = null;
  }

  _cancelRAF() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _setPlayingUI(playing) {
    this.playBtn.textContent = playing ? "❚❚" : "▶";
    this.stageHudEl.classList.toggle("live", playing);
    this.playBtn.disabled = !this.ws;
  }

  _togglePlay() {
    if (!this.ws) return;
    this.ws.playPause();
  }

  _clearImages() {
    for (const img of this._imgEls.values()) {
      try { URL.revokeObjectURL(img.src); } catch {}
      img.remove();
    }
    this._imgEls.clear();
    this._activeFile = null;
  }

  _rebuildImages() {
    this._clearImages();
    const files = new Set();
    for (const s of this.segments) if (s.image) files.add(s.image);
    for (const f of files) {
      const img = document.createElement("img");
      img.alt = f.name || "image";
      img.src = URL.createObjectURL(f);
      this.stageEl.insertBefore(img, this.stageEmptyEl);
      this._imgEls.set(f, img);
    }
  }

  _renderBeats() {
    this.beatsEl.replaceChildren();
    if (!this.duration) return;
    const seen = new Set();
    for (const s of this.segments) {
      if (!Number.isFinite(s.start)) continue;
      if (seen.has(s.start)) continue;
      seen.add(s.start);
      const div = document.createElement("div");
      div.className = "beat";
      div.style.left = `${Math.max(0, Math.min(100, (s.start / this.duration) * 100))}%`;
      this.beatsEl.appendChild(div);
    }
  }

  _updatePlayhead() {
    const t = this.ws ? this.ws.getCurrentTime() : 0;
    const dur = this.duration || (this.ws ? this.ws.getDuration() : 0) || 0;
    const pct = dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0;

    this.fillEl.style.width = `${(pct * 100).toFixed(2)}%`;
    this.playheadEl.style.left = `${(pct * 100).toFixed(2)}%`;
    this.timeEl.textContent = `${fmt(t)} / ${fmt(dur)}`;
    this.stageTimeEl.textContent = fmt(t);

    // 切图：当前 t 落在哪个 segment
    const seg = this._segmentAt(t);
    const file = seg?.image || null;
    if (file !== this._activeFile) {
      this._activeFile = file;
      for (const [f, img] of this._imgEls) {
        img.classList.toggle("show", f === file);
      }
    }

    // 高亮离 playhead 最近的节拍刻度
    const children = this.beatsEl.children;
    if (children.length) {
      const targetIdx = this._closestBeatIndex(t);
      for (let i = 0; i < children.length; i += 1) {
        children[i].classList.toggle("active", i === targetIdx);
      }
    }
  }

  _closestBeatIndex(t) {
    // segments 里每段的 start 构成节拍列表
    let best = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < this.segments.length; i += 1) {
      const d = Math.abs(this.segments[i].start - t);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return best;
  }

  _segmentAt(t) {
    if (!this.segments.length) return null;
    // 二分：segments 按 start 升序
    let lo = 0, hi = this.segments.length - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].start <= t) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return this.segments[found];
  }

  _refreshEmptyState() {
    const hasImages = this._imgEls.size > 0;
    this.stageEmptyEl.style.display = hasImages ? "none" : "grid";
    this.playBtn.disabled = !this.ws;
  }

  _onScrub(ev) {
    if (this._dragging) return;
    this._seekFromEvent(ev);
  }
  _onScrubDown(ev) {
    this._dragging = true;
    this._seekFromEvent(ev);
    window.addEventListener("mousemove", this._onScrubMove);
    window.addEventListener("mouseup", this._onScrubUp);
  }
  _onScrubMove(ev) {
    if (!this._dragging) return;
    this._seekFromEvent(ev);
  }
  _onScrubUp() {
    this._dragging = false;
    window.removeEventListener("mousemove", this._onScrubMove);
    window.removeEventListener("mouseup", this._onScrubUp);
  }
  _seekFromEvent(ev) {
    if (!this.ws) return;
    const r = this.scrubEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const dur = this.duration || this.ws.getDuration() || 0;
    if (dur <= 0) return;
    this.ws.setTime(pct * dur);
    this._updatePlayhead();
  }
}
