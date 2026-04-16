import { BeatAnalyzerAPI } from "./core/api-client.js";
import { downloadBeatsCSV, downloadBeatsJSON } from "./core/beat-exporter.js";
import { BeatPlayer } from "./core/beat-player.js";
import { assignImagesToSegments, buildBeatSegments } from "./core/beat-mapper.js";
import { mustPickSingleFile, warnIfLarge } from "./ui/file-uploader.js";
import { readImageFiles, renderImagesGrid } from "./ui/image-picker.js";
import { renderTimeline } from "./ui/timeline.js";
import { loadString, saveString, saveResult, loadResult } from "./utils/storage.js";

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el;
}

function setStatus(text) {
  $("status").textContent = text || "";
}

function setResult(text) {
  $("result").textContent = text || "";
}

function setMeta(result) {
  if (!result) {
    $("meta").textContent = "";
    return;
  }
  const tempo = Number(result.tempo);
  const duration = Number(result.duration);
  const count = Array.isArray(result.beat_times) ? result.beat_times.length : 0;
  $("meta").textContent =
    `tempo=${Number.isFinite(tempo) ? tempo.toFixed(2) : "?"} BPM，` +
    `duration=${Number.isFinite(duration) ? duration.toFixed(2) : "?"}s，` +
    `beats=${count}`;
}

function enableDownloads(enabled) {
  $("download-json").disabled = !enabled;
  $("download-csv").disabled = !enabled;
}

let lastResult = null;
let lastAudioFile = null;
let imageFiles = [];

const player = new BeatPlayer({
  waveformEl: document.getElementById("waveform"),
  overlayEl: document.getElementById("beat-overlay"),
});

function refreshTimeline() {
  const segments = buildBeatSegments(lastResult?.beat_times, lastResult?.duration);
  const mapped = assignImagesToSegments(segments, imageFiles);
  renderTimeline($("timeline"), mapped);
}

function defaultApiUrl() {
  return loadString("apiUrl", "http://localhost:8080");
}

function normalizeApiUrl(v) {
  const s = String(v || "").trim();
  return s.replace(/\/+$/, "");
}

// 恢复上次分析结果（仅数据，不恢复音频播放器）
function restoreLastResult() {
  const cached = loadResult();
  if (!cached || !Array.isArray(cached.beat_times) || cached.beat_times.length === 0) return;
  lastResult = cached;
  setMeta(cached);
  setResult(JSON.stringify(cached, null, 2));
  enableDownloads(true);
  setStatus("已恢复上次分析结果（重新上传音频可刷新）");
  refreshTimeline();
}

async function onAnalyze() {
  enableDownloads(false);
  setMeta(null);
  setResult("");
  $("play-btn").disabled = true;
  $("play-status").textContent = "";
  player.destroy();

  const apiUrl = normalizeApiUrl($("api-url").value);
  saveString("apiUrl", apiUrl);

  const method = $("method").value;
  const minInterval = Number($("min-interval").value);
  if (!Number.isFinite(minInterval) || minInterval <= 0) throw new Error("最小间隔必须是 >0 的数字");

  const audioFile = mustPickSingleFile($("audio-file"));
  lastAudioFile = audioFile;

  const sizeWarning = warnIfLarge(audioFile);
  const baseStatus = "分析中（若是首次请求可能在唤醒服务器）...";
  setStatus(sizeWarning ? `⚠️ ${sizeWarning} — ${baseStatus}` : baseStatus);

  const api = new BeatAnalyzerAPI(apiUrl);
  try {
    const result = await api.analyze(
      audioFile,
      { method, min_interval: minInterval },
      { onRetry: (attempt, max) => setStatus(`第 ${attempt}/${max} 次重试...`) },
    );
    lastResult = result;
    saveResult(result);
    setMeta(result);
    setResult(JSON.stringify(result, null, 2));
    enableDownloads(true);
    setStatus("完成");

    try {
      await player.load({ audioFile, beatTimes: result.beat_times, duration: result.duration });
      $("play-btn").disabled = false;
      $("play-status").textContent = "已加载波形";
    } catch (e) {
      $("play-btn").disabled = true;
      $("play-status").textContent = `波形加载失败：${e?.message || String(e)}`;
    }

    refreshTimeline();
  } catch (e) {
    lastResult = null;
    lastAudioFile = null;
    enableDownloads(false);
    setStatus(`失败：${e?.message || String(e)}`);
    refreshTimeline();
  }
}

function wire() {
  $("api-url").value = defaultApiUrl();
  $("api-url").addEventListener("change", (e) => saveString("apiUrl", normalizeApiUrl(e.target.value)));

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

  renderTimeline($("timeline"), []);
  restoreLastResult();
}

wire();
