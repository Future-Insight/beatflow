// 预览播放器：驱动 9:16 stage（根据当前时间硬切图片 + 节拍脉冲描边），
// 以及下方完整时间线（节拍刻度 + 填充条 + 播放头 + 起止区间暗色遮罩）。
//
// 和 BeatPlayer 解耦：仅依赖 wavesurfer.ws 的 currentTime / duration / 事件。

function fmtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export class PreviewPlayer {
  constructor(els) {
    // stage
    this.stageEl = els.stageEl;
    this.stageSlotEl = els.stageSlotEl;
    this.stageEmptyEl = els.stageEmptyEl;
    this.stagePulseEl = els.stagePulseEl;
    this.stageRecEl = els.stageRecEl;
    this.stageRecLabelEl = els.stageRecLabelEl;
    this.stageAspectTagEl = els.stageAspectTagEl;
    // timeline
    this.trackWrapEl = els.trackWrapEl;
    this.fillEl = els.fillEl;
    this.beatsEl = els.beatsEl;
    this.playheadEl = els.playheadEl;
    this.dimStartEl = els.dimStartEl;
    this.dimEndEl = els.dimEndEl;
    this.rangeStartEl = els.rangeStartEl;
    this.rangeEndEl = els.rangeEndEl;
    this.tlCurEl = els.tlCurEl;
    this.tlDurEl = els.tlDurEl;
    this.tlLabelEls = els.tlLabelEls; // [1,2,3,4] quarter points
    // stage meta & pills
    this.smImagesEl = els.smImagesEl;
    this.smBeatsEl = els.smBeatsEl;
    this.smLoopsEl = els.smLoopsEl;
    this.pillCutEl = els.pillCutEl;
    this.pillNextEl = els.pillNextEl;
    this.pillFitEl = els.pillFitEl;
    // callbacks
    this.onPlayToggle = els.onPlayToggle || (() => {});
    this.playBtn = els.playBtn;
    this.backBtn = els.backBtn;
    this.fwdBtn = els.fwdBtn;

    this.segments = [];
    this.duration = 0;
    this.ws = null;
    this._imgEls = new Map(); // File -> <img>
    this._activeFile = null;
    this._activeIdx = -1;
    this._raf = 0;
    this._dragging = false;
    this._clipStart = 0;
    this._clipEnd = 0;
    this._fitMode = "cover";
    this._pulseMs = 180;

    this._onScrubDown = this._onScrubDown.bind(this);
    this._onScrubMove = this._onScrubMove.bind(this);
    this._onScrubUp = this._onScrubUp.bind(this);

    this.trackWrapEl.addEventListener("mousedown", this._onScrubDown);
    this.playBtn.addEventListener("click", () => this.onPlayToggle());
    this.backBtn.addEventListener("click", () => this._seek((this.ws ? this.ws.getCurrentTime() : 0) - 1));
    this.fwdBtn.addEventListener("click", () => this._seek((this.ws ? this.ws.getCurrentTime() : 0) + 1));
  }

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
    this._setPlayingUI(this.ws.isPlaying && this.ws.isPlaying());
  }

  setSegments(segments, duration) {
    this.segments = Array.isArray(segments) ? segments : [];
    this.duration = Number(duration) || 0;
    if (!this.duration && this.segments.length) {
      this.duration = this.segments[this.segments.length - 1]?.end || 0;
    }
    this._rebuildImages();
    this._renderBeats();
    this._renderTimeLabels();
    this._updateMeta();
    this._updatePlayhead(true);
  }

  setClipRange(startSec, endSec) {
    this._clipStart = Math.max(0, Number(startSec) || 0);
    this._clipEnd = Math.max(this._clipStart, Number(endSec) || this.duration);
    this._renderClipDim();
  }

  setAspect(aspect) {
    this.stageEl.classList.remove("a1-1", "a16-9");
    if (aspect === "1:1") this.stageEl.classList.add("a1-1");
    else if (aspect === "16:9") this.stageEl.classList.add("a16-9");
    if (this.stageAspectTagEl) this.stageAspectTagEl.textContent = aspect;
  }

  setFitMode(mode) {
    this._fitMode = mode;
    if (this.pillFitEl) this.pillFitEl.textContent = mode;
    for (const img of this._imgEls.values()) {
      img.style.objectFit = mode === "stretch" ? "fill" : mode;
      img.style.background = mode === "contain" ? "#000" : "";
    }
  }

  setPulseMs(ms) { this._pulseMs = Math.max(60, Math.min(400, Number(ms) || 180)); this.stageEl.style.setProperty("--pulse-ms", `${this._pulseMs}ms`); }

  setRecording(on, label) {
    if (!this.stageRecEl) return;
    if (!on) {
      this.stageRecEl.style.display = "none";
      this.stageRecEl.classList.remove("live");
      return;
    }
    this.stageRecEl.style.display = "inline-flex";
    this.stageRecLabelEl.textContent = label || "REC";
    this.stageRecEl.classList.toggle("live", label === "LIVE");
  }

  destroy() {
    this._cancelRAF();
    this.trackWrapEl.removeEventListener("mousedown", this._onScrubDown);
    window.removeEventListener("mousemove", this._onScrubMove);
    window.removeEventListener("mouseup", this._onScrubUp);
    this._clearImages();
    this.ws = null;
  }

  _cancelRAF() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; }

  _setPlayingUI(playing) {
    // play button icon
    const svg = playing
      ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="1" width="2.2" height="8"/><rect x="5.8" y="1" width="2.2" height="8"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>';
    this.playBtn.innerHTML = svg;
    this.setRecording(playing, "LIVE");
  }

  _clearImages() {
    for (const img of this._imgEls.values()) {
      try { URL.revokeObjectURL(img.src); } catch {}
      img.remove();
    }
    this._imgEls.clear();
    this._activeFile = null;
    this._activeIdx = -1;
  }

  _rebuildImages() {
    this._clearImages();
    const files = new Set();
    for (const s of this.segments) if (s.image) files.add(s.image);
    for (const f of files) {
      const wrap = document.createElement("div");
      wrap.className = "slide";
      const img = document.createElement("img");
      img.alt = f.name || "image";
      img.src = URL.createObjectURL(f);
      img.style.objectFit = this._fitMode === "stretch" ? "fill" : this._fitMode;
      if (this._fitMode === "contain") img.style.background = "#000";
      wrap.appendChild(img);
      this.stageEl.insertBefore(wrap, this.stagePulseEl);
      this._imgEls.set(f, wrap);
    }
    // 空状态
    if (this.stageEmptyEl) {
      this.stageEmptyEl.parentElement.style.display = this._imgEls.size === 0 ? "flex" : "none";
      this.stageEmptyEl.parentElement.classList.toggle("on", this._imgEls.size === 0);
    }
  }

  _renderBeats() {
    this.beatsEl.replaceChildren();
    if (!this.duration) return;
    // segments 每段的 start 就是节拍时间点
    for (let i = 0; i < this.segments.length; i += 1) {
      const s = this.segments[i];
      if (!Number.isFinite(s.start)) continue;
      const div = document.createElement("div");
      div.className = "tl-beat" + (i % 4 === 0 ? " downbeat" : "");
      div.dataset.t = String(s.start);
      div.style.left = `${Math.max(0, Math.min(100, (s.start / this.duration) * 100))}%`;
      this.beatsEl.appendChild(div);
    }
  }

  _renderTimeLabels() {
    if (!this.tlLabelEls) return;
    const d = this.duration;
    const quarters = [d / 4, d / 2, (d * 3) / 4, d];
    for (let i = 0; i < this.tlLabelEls.length; i += 1) {
      this.tlLabelEls[i].textContent = fmtTime(quarters[i] || 0);
    }
  }

  _updateMeta() {
    if (this.smImagesEl) this.smImagesEl.textContent = String(this._imgEls.size);
    if (this.smBeatsEl) this.smBeatsEl.textContent = String(this.segments.length);
    const nImgs = this._imgEls.size;
    if (this.smLoopsEl) {
      this.smLoopsEl.textContent = nImgs > 0 ? String(Math.ceil(this.segments.length / nImgs)) : "0";
    }
  }

  _renderClipDim() {
    const d = this.duration;
    if (!d) {
      this.dimStartEl.style.width = "0";
      this.dimEndEl.style.width = "0";
      return;
    }
    const s = Math.max(0, Math.min(d, this._clipStart));
    const e = Math.max(s, Math.min(d, this._clipEnd));
    this.dimStartEl.style.width = `${(s / d) * 100}%`;
    this.dimEndEl.style.width = `${100 - (e / d) * 100}%`;
    if (this.rangeStartEl) this.rangeStartEl.style.left = `${(s / d) * 100}%`;
    if (this.rangeEndEl) this.rangeEndEl.style.left = `${(e / d) * 100}%`;
  }

  _updatePlayhead(force) {
    const t = this.ws ? this.ws.getCurrentTime() : 0;
    const dur = this.duration || (this.ws ? this.ws.getDuration() : 0) || 0;
    const pct = dur > 0 ? Math.max(0, Math.min(1, t / dur)) : 0;

    this.fillEl.style.width = `${(pct * 100).toFixed(3)}%`;
    this.playheadEl.style.left = `${(pct * 100).toFixed(3)}%`;
    if (this.tlCurEl) this.tlCurEl.textContent = fmtTime(t);
    if (this.tlDurEl) this.tlDurEl.textContent = fmtTime(dur);

    // 当前段切图 + 脉冲
    const seg = this._segmentAt(t);
    const idx = seg ? this._segmentIndex(seg) : -1;
    const file = seg?.image || null;
    if (file !== this._activeFile || idx !== this._activeIdx || force) {
      const changedSeg = idx !== this._activeIdx;
      this._activeFile = file;
      this._activeIdx = idx;
      for (const [f, el] of this._imgEls) {
        el.classList.toggle("on", f === file);
      }
      if (changedSeg && file) this._firePulse();
      // pill: cut
      if (this.pillCutEl) {
        if (file) this.pillCutEl.textContent = `img_${String(this._imgIndexOf(file) + 1).padStart(2, "0")}`;
        else this.pillCutEl.textContent = "—";
      }
    }

    // 节拍刻度：passed 高亮
    const beats = this.beatsEl.children;
    for (let i = 0; i < beats.length; i += 1) {
      const bt = Number(beats[i].dataset.t || 0);
      beats[i].classList.toggle("passed", bt <= t);
    }

    // pill: next beat
    if (this.pillNextEl) {
      const next = this.segments.find((s) => s.start > t);
      this.pillNextEl.textContent = next ? `${(next.start - t).toFixed(2)}s` : "—";
    }
  }

  _imgIndexOf(file) {
    let i = 0;
    for (const f of this._imgEls.keys()) {
      if (f === file) return i;
      i += 1;
    }
    return -1;
  }

  _firePulse() {
    if (!this.stagePulseEl) return;
    // 重触发动画
    this.stagePulseEl.classList.remove("fire");
    // eslint-disable-next-line no-unused-expressions
    this.stagePulseEl.offsetWidth;
    this.stagePulseEl.classList.add("fire");
  }

  _segmentAt(t) {
    if (!this.segments.length) return null;
    let lo = 0, hi = this.segments.length - 1, found = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.segments[mid].start <= t) { found = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return this.segments[found];
  }

  _segmentIndex(seg) {
    return this.segments.indexOf(seg);
  }

  _seek(t) {
    if (!this.ws) return;
    const dur = this.duration || this.ws.getDuration() || 0;
    const clamped = Math.max(0, Math.min(dur, t));
    this.ws.setTime(clamped);
    this._updatePlayhead(true);
  }

  _onScrubDown(ev) {
    this._dragging = true;
    this._seekFromEvent(ev);
    window.addEventListener("mousemove", this._onScrubMove);
    window.addEventListener("mouseup", this._onScrubUp);
  }
  _onScrubMove(ev) { if (this._dragging) this._seekFromEvent(ev); }
  _onScrubUp() {
    this._dragging = false;
    window.removeEventListener("mousemove", this._onScrubMove);
    window.removeEventListener("mouseup", this._onScrubUp);
  }
  _seekFromEvent(ev) {
    if (!this.ws) return;
    const r = this.trackWrapEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const dur = this.duration || this.ws.getDuration() || 0;
    if (dur <= 0) return;
    this.ws.setTime(pct * dur);
    this._updatePlayhead(true);
  }
}
