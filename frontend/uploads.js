/* =========================================================
   Beatflow · uploads.js  (real implementation)
   ---------------------------------------------------------
   契约和设计稿 mock 保持一致：
     handleAudioUpload(file)  → Promise<track>
     handleImageUpload(files) → Promise<image[]>
     analyzeTrack(track)      → Promise<track>    (新增 · 真 API)

   真实版：
     • handleAudioUpload   读文件属性 + 用 <audio> 探测 duration，
                           返回尚未分析的 track（bpm=0, beat_times=null）
     • analyzeTrack        POST /api/analyze 拿到真实 bpm/beat_times
     • handleImageUpload   File → { type:"file", file, src:objectURL, label }

   预置曲目没有真实 file，"开始分析" 走 mock 合成节拍。
   预置图片集保留，仍用渐变 swatch。
   ========================================================= */

(function (global) {
  "use strict";

  // 预置曲目 · 音频文件放在 frontend/presets/，节拍 JSON 由
  // scripts/analyze_presets.py 离线生成（与 mp3 同目录的 .beats.json）。
  // 点击后真实 fetch 音频 + beats JSON，直接跳过分析。
  //
  // 添加新曲目流程：
  //   1. 把 mp3 放进 frontend/presets/
  //   2. 跑 ./api/venv/bin/python scripts/analyze_presets.py 生成 .beats.json
  //   3. 在下面的数组里加一行
  const PRESET_TRACKS = [
    {
      key: "morning",
      name: "harumachimusic-morning-calm-236192.mp3",
      size: "4.39 MB",
      bpm: 74,
      duration: 143.93,
      method: "onset",
      minInterval: 0.12,
      mood: "morning calm",
      genre: "AMBIENT",
      url: "./presets/harumachimusic-morning-calm-236192.mp3",
      beatsUrl: "./presets/harumachimusic-morning-calm-236192.mp3.beats.json",
    },
    {
      key: "christmas",
      name: "leberch-christmas-440431.mp3",
      size: "3.05 MB",
      bpm: 99,
      duration: 100.05,
      method: "beat",
      minInterval: 0.12,
      mood: "christmas",
      genre: "HOLIDAY",
      url: "./presets/leberch-christmas-440431.mp3",
      beatsUrl: "./presets/leberch-christmas-440431.mp3.beats.json",
    },
    {
      key: "samba",
      name: "tunetank-samba-348218.mp3",
      size: "4.41 MB",
      bpm: 125,
      duration: 144.43,
      method: "beat",
      minInterval: 0.12,
      mood: "samba",
      genre: "LATIN",
      url: "./presets/tunetank-samba-348218.mp3",
      beatsUrl: "./presets/tunetank-samba-348218.mp3.beats.json",
    },
  ];

  // 首次加载随机选中一个预置音乐
  const DEMO_TRACK = PRESET_TRACKS[Math.floor(Math.random() * PRESET_TRACKS.length)];
  const DEMO_SWATCHES = [
    { c1: "#ff3b4e", c2: "#ff9a3c", label: "SCENE_01 · neon dusk" },
    { c1: "#6b5cff", c2: "#d65cff", label: "SCENE_02 · violet bloom" },
    { c1: "#00d4ff", c2: "#0077ff", label: "SCENE_03 · tide break" },
    { c1: "#16c79a", c2: "#c7e857", label: "SCENE_04 · moss field" },
    { c1: "#ffd166", c2: "#ef476f", label: "SCENE_05 · sunset cut" },
    { c1: "#1a1a2e", c2: "#4a2e8a", label: "SCENE_06 · midnight" },
    { c1: "#ff6b9d", c2: "#c06c84", label: "SCENE_07 · dream pink" },
    { c1: "#38b6ff", c2: "#2ecc71", label: "SCENE_08 · aquaria" },
  ];

  // 预置图片集 · 图片放在 frontend/presets/images/<key>/NN.jpg
  // 来源：Unsplash（免费商用，无需署名）。详情见该目录下的 SOURCES.md。
  // 第一项为颜色预设：使用 DEMO_SWATCHES 渐变卡片，不加载图片文件。
  const PRESET_IMAGE_SETS = (() => {
    const mk = (key, count = 8) =>
      Array.from({ length: count }, (_, i) =>
        `./presets/images/${key}/${String(i + 1).padStart(2, "0")}.jpg`);
    return [
      { key: "colors",    name: "Colors",    tag: "8 张 · 颜色卡片", kind: "swatch", swatches: DEMO_SWATCHES },
      { key: "travel",    name: "Travel",    tag: "8 张 · 旅行",     images: mk("travel") },
      { key: "happiness", name: "Happiness", tag: "8 张 · 快乐",     images: mk("happiness") },
      { key: "abstract",  name: "Abstract",  tag: "8 张 · 抽象艺术", images: mk("abstract") },
    ];
  })();

  function prettySize(bytes) {
    if (!bytes || bytes < 1024) return (bytes || 0) + " B";
    const units = ["KB", "MB", "GB"];
    let n = bytes / 1024, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(2) + " " + units[i];
  }

  function getApiUrl() {
    try { return localStorage.getItem("bf_api_url") || "http://localhost:8088"; }
    catch { return "http://localhost:8088"; }
  }

  function probeAudioDuration(url) {
    return new Promise((resolve) => {
      const a = new Audio();
      a.preload = "metadata";
      a.src = url;
      a.addEventListener("loadedmetadata", () => {
        resolve(Number.isFinite(a.duration) ? a.duration : 0);
      }, { once: true });
      a.addEventListener("error", () => resolve(0), { once: true });
    });
  }

  async function handleAudioUpload(file) {
    if (!file) return { ...DEMO_TRACK };
    const audioUrl = URL.createObjectURL(file);
    const duration = await probeAudioDuration(audioUrl);
    return {
      key: "user_" + Date.now(),
      name: file.name,
      size: prettySize(file.size),
      bpm: 0,
      duration: duration || 30,
      method: "beat",
      minInterval: 0.3,
      mood: "custom",
      genre: "UPLOAD",
      file,
      audioUrl,
      beat_times: null,
    };
  }

  async function analyzeTrack(track) {
    if (!track) return track;
    if (!track.file) {
      // 预置曲目：无真实文件，保留原型"合成节拍"体验
      return { ...track, beat_times: null };
    }
    const url = `${getApiUrl().replace(/\/+$/, "")}/api/analyze`;
    const fd = new FormData();
    fd.append("audio", track.file, track.file.name);
    fd.append("method", track.method === "onset" ? "onset" : "beat");
    fd.append("min_interval", String(track.minInterval ?? 0.3));
    const resp = await fetch(url, { method: "POST", body: fd });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `分析失败 ${resp.status}`);
    return {
      ...track,
      bpm: Math.round(Number(data.tempo) || track.bpm || 0),
      duration: Number(data.duration) || track.duration,
      beat_times: Array.isArray(data.beat_times) ? data.beat_times : [],
    };
  }

  async function handleImageUpload(filesOrCount) {
    if (typeof filesOrCount === "number") {
      return Array.from({ length: filesOrCount }, (_, i) => {
        const pick = DEMO_SWATCHES[i % DEMO_SWATCHES.length];
        return { id: "img_" + Date.now() + "_" + i, type: "swatch", ...pick };
      });
    }
    const files = filesOrCount ? Array.from(filesOrCount) : [];
    if (files.length === 0) {
      const pick = DEMO_SWATCHES[Math.floor(Math.random() * DEMO_SWATCHES.length)];
      return [{ id: "img_" + Date.now(), type: "swatch", ...pick }];
    }
    return files.map((f, i) => ({
      id: "img_" + Date.now() + "_" + i,
      type: "file",
      file: f,
      src: URL.createObjectURL(f),
      label: (f.name || "image").toUpperCase(),
    }));
  }

  function getInitialImages() {
    return DEMO_SWATCHES.map((s, i) => ({
      id: "seed_" + i, type: "swatch", ...s,
    }));
  }

  function loadImageSet(set) {
    if (!set) return [];
    if (set.kind === "swatch" && Array.isArray(set.swatches)) {
      return set.swatches.map((s, i) => ({
        id: `${set.key}_${Date.now()}_${i}`,
        type: "swatch",
        ...s,
      }));
    }
    if (!Array.isArray(set.images)) return [];
    return set.images.map((src, i) => ({
      id:    `${set.key}_${Date.now()}_${i}`,
      type:  "url",
      src,
      label: `${set.name.toUpperCase()}_${String(i+1).padStart(2,"0")}`,
    }));
  }

  function getDefaultTrack() { return { ...DEMO_TRACK }; }

  /* ---------------------------------------------------------
     pickPreset(preset):
     - preset.url 存在 → fetch mp3 → 包装成 File → 返回含 audioUrl/file 的 track
       （等价于用户手动上传一次，后续"开始分析"会走真 API）
     - preset.url 为空或 fetch 失败 → 回退 mock：返回原 preset（UI 按 bpm/duration
       合成节拍，不能真正播放）
     --------------------------------------------------------- */
  async function pickPreset(preset) {
    if (!preset) return preset;
    if (!preset.url) {
      // Mock 模式：无真实音频，UI 按 bpm/duration 合成节拍
      return { ...preset, beat_times: null };
    }
    try {
      const resp = await fetch(preset.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const guessedName = preset.name || (preset.url.split("/").pop() || "preset.mp3");
      const file = new File([blob], guessedName, { type: blob.type || "audio/mpeg" });
      const audioUrl = URL.createObjectURL(file);
      const realDuration = await probeAudioDuration(audioUrl);

      // 若有预分析 JSON，直接并入（跳过"开始分析"这一步）
      let preAnalyzed = null;
      if (preset.beatsUrl) {
        try {
          const bResp = await fetch(preset.beatsUrl);
          if (bResp.ok) preAnalyzed = await bResp.json();
        } catch (e) {
          console.warn(`[Beatflow] 读取预分析 JSON 失败：`, e);
        }
      }

      return {
        ...preset,
        file,
        audioUrl,
        name: guessedName,
        size: prettySize(file.size),
        duration: (preAnalyzed && preAnalyzed.duration) || realDuration || preset.duration,
        bpm: preAnalyzed ? Math.round(Number(preAnalyzed.tempo) || 0) : 0,
        beat_times: Array.isArray(preAnalyzed && preAnalyzed.beat_times) ? preAnalyzed.beat_times : null,
      };
    } catch (e) {
      console.warn(`[Beatflow] pickPreset fetch 失败，回退 mock：`, e);
      return { ...preset, beat_times: null };
    }
  }

  global.BeatflowUploads = {
    handleAudioUpload,
    handleImageUpload,
    analyzeTrack,
    pickPreset,
    PRESET_TRACKS,
    PRESET_IMAGE_SETS,
    getDefaultTrack,
    getInitialImages,
    loadImageSet,
    _DEMO_TRACK: DEMO_TRACK,
    _DEMO_SWATCHES: DEMO_SWATCHES,
  };
})(window);
