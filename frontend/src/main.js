import { BeatAnalyzerAPI } from "./core/api-client.js";
import { downloadBeatsCSV, downloadBeatsJSON } from "./core/beat-exporter.js";
import { BeatPlayer } from "./core/beat-player.js";
import { assignImagesToSegments, buildBeatSegments } from "./core/beat-mapper.js";
import { downloadBlob, exportVideo } from "./core/video-recorder.js";
import { mustPickSingleFile, warnIfLarge } from "./ui/file-uploader.js";
import { readImageFiles, renderImagesGrid } from "./ui/image-picker.js";
import { PreviewPlayer } from "./ui/preview-player.js";
import { loadResult, loadString, saveResult } from "./utils/storage.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el;
}

function setStatus(text) { $("status").textContent = text || ""; }
function setExportStatus(text) { $("export-status").textContent = text || ""; }

function setMeta(result) {
  const tempo = Number(result?.tempo);
  const duration = Number(result?.duration);
  const beats = Array.isArray(result?.beat_times) ? result.beat_times.length : 0;
  $("m-bpm").textContent = Number.isFinite(tempo) && tempo > 0 ? tempo.toFixed(1) : "—";
  $("m-dur").textContent = Number.isFinite(duration) && duration > 0 ? `${duration.toFixed(2)}s` : "—";
  $("m-beats").textContent = beats || "—";
}

function enableDownloads(enabled) {
  $("download-json").disabled = !enabled;
  $("download-csv").disabled = !enabled;
}

let lastResult = null;
let lastAudioFile = null;
let imageFiles = [];
let segmentsCache = [];

const player = new BeatPlayer({
  waveformEl: document.getElementById("waveform"),
  overlayEl: document.getElementById("beat-overlay"),
});

const preview = new PreviewPlayer({
  stageEl: $("preview-stage"),
  scrubEl: $("preview-scrub"),
  fillEl: $("scrub-fill"),
  beatsEl: $("scrub-beats"),
  playheadEl: $("scrub-playhead"),
  timeEl: $("preview-time"),
  stageTimeEl: $("stage-time"),
  stageHudEl: $("stage-hud"),
  stageEmptyEl: $("stage-empty"),
  playBtn: $("preview-play"),
});

function refreshTimeline() {
  const segments = buildBeatSegments(lastResult?.beat_times, lastResult?.duration);
  segmentsCache = assignImagesToSegments(segments, imageFiles);
  preview.setSegments(segmentsCache, lastResult?.duration || 0);
  refreshExportBtn();
  refreshClipSliders();
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
  // 首次初始化：结束默认为全时长
  if (!end.dataset.inited || Number(end.value) <= Number(start.value)) {
    end.value = String(dur.toFixed(2));
    end.dataset.inited = "1";
  }
  updateClipLabels();
}

function updateClipLabels() {
  const s = Number($("clip-start").value) || 0;
  const e = Number($("clip-end").value) || 0;
  $("clip-start-label").textContent = s.toFixed(2);
  $("clip-end-label").textContent = e.toFixed(2);
  const d = Math.max(0, e - s);
  $("clip-duration-chip").textContent = `片段 ${d.toFixed(2)}s`;
}

// API URL：从 localStorage 读取，允许高级用户覆盖；UI 里不暴露
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

async function onAnalyze() {
  enableDownloads(false);
  setMeta(null);
  $("play-btn").disabled = true;
  $("play-status").textContent = "";
  preview.bindWaveSurfer(null);
  player.destroy();

  const method = $("method").value;
  const minInterval = Number($("min-interval").value);
  if (!Number.isFinite(minInterval) || minInterval <= 0) throw new Error("最小间隔必须是 >0 的数字");

  const audioFile = mustPickSingleFile($("audio-file"));
  lastAudioFile = audioFile;

  const sizeWarning = warnIfLarge(audioFile);
  const baseStatus = "分析中（若是首次请求可能在唤醒服务器）...";
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
    setStatus("完成");

    try {
      await player.load({ audioFile, beatTimes: result.beat_times, duration: result.duration });
      $("play-btn").disabled = false;
      $("play-status").textContent = "已加载波形";
      preview.bindWaveSurfer(player.ws);
    } catch (e) {
      $("play-btn").disabled = true;
      $("play-status").textContent = `波形加载失败：${e?.message || String(e)}`;
    }

    // 首次分析完成，重置裁剪终点为全时长
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
  setExportStatus("准备中...");

  try {
    const blob = await exportVideo({
      audioFile: lastAudioFile,
      segments: segmentsCache,
      startSec,
      endSec,
      onProgress: (p) => setExportStatus(`录制中 ${Math.floor(p * 100)}%`),
    });
    const base = (lastAudioFile.name || "output").replace(/\.[^.]+$/, "");
    const tag = `${startSec.toFixed(1)}-${endSec.toFixed(1)}s`;
    downloadBlob(blob, `${base}_${tag}.webm`);
    setExportStatus(`完成（${(blob.size / 1024 / 1024).toFixed(1)} MB）`);
  } catch (e) {
    setExportStatus(`失败：${e?.message || String(e)}`);
  } finally {
    refreshExportBtn();
  }
}

function wire() {
  $("analyze-btn").addEventListener("click", () => {
    onAnalyze().catch((e) => setStatus(`失败：${e?.message || String(e)}`));
  });

  $("download-json").addEventListener("click", () => {
    if (!lastResult) return;
    downloadBeatsJSON(lastResult);
  });
  $("download-csv").addEventListener("click", () => {
    if (!lastResult) return;
    downloadBeatsCSV(lastResult);
  });

  $("play-btn").addEventListener("click", () => {
    if (!player.isReady()) return;
    player.playPause();
  });

  $("image-files").addEventListener("change", () => {
    imageFiles = readImageFiles($("image-files"));
    renderImagesGrid($("images-grid"), imageFiles, (newOrder) => {
      imageFiles = newOrder;
      refreshTimeline();
    });
    refreshTimeline();
  });

  $("clip-start").addEventListener("input", () => {
    const s = Number($("clip-start").value);
    const e = Number($("clip-end").value);
    if (s > e) $("clip-end").value = String(s);
    updateClipLabels();
  });
  $("clip-end").addEventListener("input", () => {
    const s = Number($("clip-start").value);
    const e = Number($("clip-end").value);
    if (e < s) $("clip-start").value = String(e);
    updateClipLabels();
  });

  $("export-video-btn").addEventListener("click", onExportVideo);

  restoreLastResult();
}

wire();
