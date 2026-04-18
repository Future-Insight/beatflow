import { BeatAnalyzerAPI } from "./core/api-client.js";
import { downloadBeatsCSV, downloadBeatsJSON } from "./core/beat-exporter.js";
import { BeatPlayer } from "./core/beat-player.js";
import { assignImagesToSegments, buildBeatSegments } from "./core/beat-mapper.js";
import { downloadBlob, exportVideo } from "./core/video-recorder.js";
import { mustPickSingleFile, warnIfLarge } from "./ui/file-uploader.js";
import { highlightActiveThumb, readImageFiles, renderImagesGrid } from "./ui/image-picker.js";
import { PreviewPlayer } from "./ui/preview-player.js";
import { loadResult, loadString, saveResult, saveString } from "./utils/storage.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el;
}

function fmtTime(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function setStatus(text) { $("status").textContent = text || ""; }
function setExportStatus(text) { $("export-status").textContent = text || "本地录制 · 耗时 ≈ 片段时长"; }

function setMeta(result) {
  const tempo = Number(result?.tempo);
  const duration = Number(result?.duration);
  const beats = Array.isArray(result?.beat_times) ? result.beat_times.length : 0;
  $("m-bpm").textContent = Number.isFinite(tempo) && tempo > 0 ? tempo.toFixed(1) : "—";
  $("m-dur").textContent = Number.isFinite(duration) && duration > 0 ? duration.toFixed(1) : "—";
  $("m-beats").textContent = beats || "—";

  if (Number.isFinite(duration) && duration > 0) {
    $("wave-head-left").textContent = `Analysis · ${beats} beats · ${tempo?.toFixed(1) || "—"} BPM`;
    $("wave-head-right").textContent = "✓ DETECTED";
    $("wave-head-right").style.color = "var(--ok)";
  } else {
    $("wave-head-left").textContent = "Analysis · 等待分析";
    $("wave-head-right").textContent = "—";
    $("wave-head-right").style.color = "var(--fg-muted)";
  }
  if (beats > 1 && Number.isFinite(duration)) {
    const avg = (duration / beats).toFixed(3);
    $("wave-foot-right").textContent = `Δ ${avg}s avg`;
  } else {
    $("wave-foot-right").textContent = "—";
  }
}

function enableDownloads(enabled) {
  $("download-json").disabled = !enabled;
  $("download-csv").disabled = !enabled;
}

let lastResult = null;
let lastAudioFile = null;
let imageFiles = [];
let segmentsCache = [];
let aspect = "9:16";
let fitMode = "cover";

const player = new BeatPlayer({
  waveformEl: document.getElementById("waveform"),
  overlayEl: document.getElementById("beat-overlay"),
});

const preview = new PreviewPlayer({
  stageEl: $("stage"),
  stageSlotEl: $("stage-slot"),
  stageEmptyEl: $("stage-empty"),
  stagePulseEl: $("stage-pulse"),
  stageRecEl: $("stage-rec"),
  stageRecLabelEl: $("stage-rec-label"),
  stageAspectTagEl: $("stage-aspect-tag"),
  trackWrapEl: $("tl-track-wrap"),
  fillEl: $("tl-fill"),
  beatsEl: $("tl-beats"),
  playheadEl: $("tl-playhead"),
  dimStartEl: $("tl-dim-start"),
  dimEndEl: $("tl-dim-end"),
  rangeStartEl: $("tl-range-start"),
  rangeEndEl: $("tl-range-end"),
  tlCurEl: $("tl-cur"),
  tlDurEl: $("tl-dur"),
  tlLabelEls: [$("tl-lbl-1"), $("tl-lbl-2"), $("tl-lbl-3"), $("tl-lbl-4")],
  smImagesEl: $("sm-images"),
  smBeatsEl: $("sm-beats"),
  smLoopsEl: $("sm-loops"),
  pillCutEl: $("pill-cut"),
  pillNextEl: $("pill-next"),
  pillFitEl: $("pill-fit"),
  playBtn: $("tl-play"),
  backBtn: $("tl-back"),
  fwdBtn: $("tl-fwd"),
  onPlayToggle: () => {
    if (player.isReady()) player.playPause();
  },
});

function refreshTimeline() {
  const segments = buildBeatSegments(lastResult?.beat_times, lastResult?.duration);
  segmentsCache = assignImagesToSegments(segments, imageFiles);
  preview.setSegments(segmentsCache, lastResult?.duration || 0);
  refreshExportSummary();
  refreshClipSliders();
  refreshExportBtn();
}

function refreshExportBtn() {
  const ok = !!lastResult && !!lastAudioFile && imageFiles.length > 0;
  $("export-video-btn").disabled = !ok;
}

function refreshClipSliders() {
  const dur = Number(lastResult?.duration) || 0;
  const start = $("clip-start");
  const end = $("clip-end");
  start.max = String(dur.toFixed(2));
  end.max = String(dur.toFixed(2));
  if (Number(start.value) > dur) start.value = "0";
  if (!end.dataset.inited || Number(end.value) <= Number(start.value)) {
    end.value = String(dur.toFixed(2));
    end.dataset.inited = "1";
  }
  updateClipUI();
}

function updateClipUI() {
  const dur = Number(lastResult?.duration) || 0;
  const s = Number($("clip-start").value) || 0;
  const e = Number($("clip-end").value) || 0;
  $("clip-start-label").textContent = s.toFixed(2);
  $("clip-end-label").textContent = e.toFixed(2);
  preview.setClipRange(s, e);

  // range-slider 填充（双滑块共享一条 fill）
  if (dur > 0) {
    const leftPct = (s / dur) * 100;
    const rightPct = 100 - (e / dur) * 100;
    $("range-fill-start").style.left = `${leftPct}%`;
    $("range-fill-start").style.right = `${rightPct}%`;
    $("range-fill-end").style.left = `${leftPct}%`;
    $("range-fill-end").style.right = `${rightPct}%`;
  }
  refreshExportSummary();
}

function refreshExportSummary() {
  const dur = Number(lastResult?.duration) || 0;
  const s = Number($("clip-start").value) || 0;
  const e = Number($("clip-end").value) || 0;
  const segDur = Math.max(0, e - s);

  $("es-dur").textContent = segDur.toFixed(2);
  $("es-time-start").textContent = fmtTime(s);
  $("es-time-end").textContent = fmtTime(e);
  $("pill-clip").textContent = `${segDur.toFixed(2)}s`;

  if (dur > 0) {
    $("es-bar-fill").style.left = `${(s / dur) * 100}%`;
    $("es-bar-fill").style.right = `${100 - (e / dur) * 100}%`;
  } else {
    $("es-bar-fill").style.left = "0";
    $("es-bar-fill").style.right = "100%";
  }
}

function getApiUrl() {
  return String(loadString("apiUrl", "http://localhost:8088") || "").replace(/\/+$/, "");
}

function restoreLastResult() {
  const cached = loadResult();
  if (!cached || !Array.isArray(cached.beat_times) || cached.beat_times.length === 0) return;
  lastResult = cached;
  setMeta(cached);
  enableDownloads(true);
  setStatus("已恢复上次分析结果（重新上传音频可刷新）");
  refreshTimeline();
}

function updateUploadState(file) {
  const up = $("audio-upload");
  if (file) {
    up.classList.add("has-file");
    $("audio-upload-t1").textContent = file.name;
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    $("audio-upload-t2").textContent = `${sizeMB} MB · 已选择`;
  } else {
    up.classList.remove("has-file");
    $("audio-upload-t1").textContent = "点击上传 或拖入音频文件";
    $("audio-upload-t2").textContent = "MP3 · WAV · M4A · FLAC · 最大 50MB";
  }
}

async function onAnalyze() {
  enableDownloads(false);
  setMeta(null);
  $("play-btn").disabled = true;
  preview.bindWaveSurfer(null);
  player.destroy();

  const method = $("method").value;
  const minInterval = Number($("min-interval").value);
  if (!Number.isFinite(minInterval) || minInterval <= 0) throw new Error("最小间隔必须是 >0 的数字");

  const audioFile = mustPickSingleFile($("audio-file"));
  lastAudioFile = audioFile;

  const sizeWarning = warnIfLarge(audioFile);
  const baseStatus = "分析中（首次请求可能在唤醒服务器）...";
  setStatus(sizeWarning ? `⚠️ ${sizeWarning} — ${baseStatus}` : baseStatus);

  const api = new BeatAnalyzerAPI(getApiUrl());
  try {
    const result = await api.analyze(
      audioFile,
      { method, min_interval: minInterval },
      { onRetry: (attempt, max) => setStatus(`第 ${attempt}/${max} 次重试...`) },
    );
    lastResult = result;
    saveResult(result);
    setMeta(result);
    enableDownloads(true);
    setStatus("分析完成");

    try {
      await player.load({ audioFile, beatTimes: result.beat_times, duration: result.duration });
      $("play-btn").disabled = false;
      preview.bindWaveSurfer(player.ws);
    } catch (e) {
      $("play-btn").disabled = true;
      setStatus(`波形加载失败：${e?.message || String(e)}`);
    }

    $("clip-end").dataset.inited = "";
    refreshTimeline();
  } catch (e) {
    lastResult = null;
    lastAudioFile = null;
    enableDownloads(false);
    setStatus(`失败：${e?.message || String(e)}`);
    refreshTimeline();
  }
}

async function onExportVideo() {
  if (!lastResult || !lastAudioFile || imageFiles.length === 0) return;
  const startSec = Math.max(0, Number($("clip-start").value) || 0);
  const endSec = Math.min(Number(lastResult.duration), Number($("clip-end").value) || 0);
  if (endSec <= startSec) {
    setExportStatus("起始时间必须小于结束时间");
    return;
  }

  const btn = $("export-video-btn");
  btn.disabled = true;
  $("export-progress").style.display = "block";
  $("export-progress-bar").style.width = "0%";
  $("export-progress-lbl").textContent = "0%";
  preview.setRecording(true, "REC");

  try {
    const blob = await exportVideo({
      audioFile: lastAudioFile,
      segments: segmentsCache,
      startSec,
      endSec,
      onProgress: (p) => {
        const pct = Math.floor(p * 100);
        $("export-progress-bar").style.width = `${pct}%`;
        $("export-progress-lbl").textContent = `${pct}%`;
        $("stage-rec-label").textContent = `REC ${pct}%`;
      },
    });
    const base = (lastAudioFile.name || "output").replace(/\.[^.]+$/, "");
    const tag = `${startSec.toFixed(1)}-${endSec.toFixed(1)}s`;
    downloadBlob(blob, `${base}_${tag}.webm`);
    setExportStatus(`完成（${(blob.size / 1024 / 1024).toFixed(1)} MB）`);
  } catch (e) {
    setExportStatus(`失败：${e?.message || String(e)}`);
  } finally {
    $("export-progress").style.display = "none";
    preview.setRecording(false);
    refreshExportBtn();
  }
}

function updateAspect(next) {
  aspect = next;
  preview.setAspect(next);
  const resMap = { "9:16": "1080 × 1920", "1:1": "1080 × 1080", "16:9": "1920 × 1080" };
  $("pill-res").textContent = resMap[next] || "1080 × 1920";
  const btns = document.querySelectorAll("#aspect-seg button");
  btns.forEach((b) => b.classList.toggle("on", b.dataset.aspect === next));
}

function updateFit(next) {
  fitMode = next;
  preview.setFitMode(next);
  const btns = document.querySelectorAll("#fit-seg button");
  btns.forEach((b) => b.classList.toggle("on", b.dataset.fit === next));
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  saveString("theme", theme);
}

function wire() {
  // Theme
  applyTheme(loadString("theme", "dark"));
  $("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  // Audio upload feedback
  $("audio-file").addEventListener("change", () => {
    const files = $("audio-file").files;
    updateUploadState(files && files[0]);
  });

  // Analyze
  $("analyze-btn").addEventListener("click", () => {
    onAnalyze().catch((e) => setStatus(`失败：${e?.message || String(e)}`));
  });

  // Top "play/pause" button in panel 1
  const mainPlayBtn = $("play-btn");
  mainPlayBtn.addEventListener("click", () => {
    if (!player.isReady()) return;
    player.playPause();
  });
  // reflect state on the label
  const origLoad = player.load.bind(player);
  player.load = async (...args) => {
    const r = await origLoad(...args);
    player.ws?.on("play", () => { $("play-btn-label").textContent = "暂停"; });
    player.ws?.on("pause", () => { $("play-btn-label").textContent = "播放"; });
    player.ws?.on("finish", () => { $("play-btn-label").textContent = "播放"; });
    return r;
  };

  // Downloads
  $("download-json").addEventListener("click", () => lastResult && downloadBeatsJSON(lastResult));
  $("download-csv").addEventListener("click", () => lastResult && downloadBeatsCSV(lastResult));

  // Images
  $("image-files").addEventListener("change", () => {
    imageFiles = readImageFiles($("image-files"));
    renderGrid();
    refreshTimeline();
  });

  // Clip sliders
  $("clip-start").addEventListener("input", () => {
    const s = Number($("clip-start").value);
    const e = Number($("clip-end").value);
    if (s > e) $("clip-end").value = String(s);
    updateClipUI();
  });
  $("clip-end").addEventListener("input", () => {
    const s = Number($("clip-start").value);
    const e = Number($("clip-end").value);
    if (e < s) $("clip-start").value = String(e);
    updateClipUI();
  });
  $("clip-reset").addEventListener("click", () => {
    const dur = Number(lastResult?.duration) || 0;
    $("clip-start").value = "0";
    $("clip-end").value = String(dur.toFixed(2));
    updateClipUI();
  });

  // Export
  $("export-video-btn").addEventListener("click", onExportVideo);

  // Aspect / Fit segmented
  document.querySelectorAll("#aspect-seg button").forEach((b) => {
    b.addEventListener("click", () => updateAspect(b.dataset.aspect));
  });
  document.querySelectorAll("#fit-seg button").forEach((b) => {
    b.addEventListener("click", () => updateFit(b.dataset.fit));
  });

  // Space = play/pause (不在输入框内时)
  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "Space") {
      e.preventDefault();
      if (player.isReady()) player.playPause();
    }
  });

  updateAspect("9:16");
  updateFit("cover");
  renderGrid();
  restoreLastResult();
}

function renderGrid() {
  $("img-count").textContent = String(imageFiles.length);
  renderImagesGrid(
    $("images-grid"),
    imageFiles,
    (newOrder) => {
      imageFiles = newOrder;
      refreshTimeline();
      $("img-count").textContent = String(imageFiles.length);
    },
    (i) => {
      imageFiles = imageFiles.slice(0, i).concat(imageFiles.slice(i + 1));
      // 清空 input 的 files（没法精确移除单个），重新渲染即可
      renderGrid();
      refreshTimeline();
    },
  );
}

wire();
