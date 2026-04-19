/* =========================================================
   Beatflow · export.js  (real implementation)
   ---------------------------------------------------------
   真 MediaRecorder 实现，契约与设计稿 mock 一致：
     BeatflowExport.exportVideo(opts) → Promise<{ok, url?, blob?}>

   条件：track.file 必须存在（真实音频 File）。预置曲目没有
   真实文件，不能导出，直接 reject（UI 会显示错误）。
   ========================================================= */

(function (global) {
  "use strict";

  const ASPECT_SIZES = {
    "9:16": [720, 1280],
    "16:9": [1280, 720],
    "1:1":  [1080, 1080],
    "4:5":  [1080, 1350],
  };
  const MIME_CANDIDATES = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  function pickMimeType() {
    for (const m of MIME_CANDIDATES) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "video/webm";
  }

  function drawImage(ctx, img, w, h, fit, bitmapMap) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    if (!img) return;
    if (img.type === "swatch") {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, img.c1);
      g.addColorStop(1, img.c2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const bmp = bitmapMap.get(img.id);
    if (!bmp) return;
    if (fit === "stretch") {
      ctx.drawImage(bmp, 0, 0, w, h);
    } else if (fit === "contain") {
      const s = Math.min(w / bmp.width, h / bmp.height);
      const dw = bmp.width * s, dh = bmp.height * s;
      ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      // cover
      const s = Math.max(w / bmp.width, h / bmp.height);
      const dw = bmp.width * s, dh = bmp.height * s;
      ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
  }

  function beatIndexAt(t, beats) {
    // beats 升序：返回 <= t 的最大 index
    let idx = 0;
    for (let i = 0; i < beats.length; i += 1) {
      if (beats[i] <= t) idx = i; else break;
    }
    return idx;
  }

  async function exportVideo(opts) {
    const {
      track, images = [], beats = [], playRange = [0, 30],
      aspect = "9:16", fitMode = "cover",
      fps = 30, onProgress = () => {}, signal,
    } = opts || {};

    if (!track || !track.file) {
      throw new Error("导出需要真实音频。预置曲目只作预览，请上传自己的音频文件。");
    }
    if (!images.length) throw new Error("请先添加图片");

    const [w, h] = ASPECT_SIZES[aspect] || ASPECT_SIZES["9:16"];

    // 预解码真实图片为 ImageBitmap（swatch 不需要）
    // - 用户上传：img.file（File 对象）
    // - 预置图集：img.type === "url" + img.src（相对路径）
    const bitmapMap = new Map();
    for (const img of images) {
      if (!img) continue;
      if (img.file) {
        bitmapMap.set(img.id, await createImageBitmap(img.file));
      } else if (img.src && img.type !== "swatch") {
        const resp = await fetch(img.src);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        bitmapMap.set(img.id, await createImageBitmap(blob));
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);

    // 音频解码
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuf = await audioCtx.decodeAudioData((await track.file.arrayBuffer()).slice(0));
    const dest = audioCtx.createMediaStreamDestination();
    const src = audioCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(dest);

    const vStream = canvas.captureStream(fps);
    const stream = new MediaStream([
      ...vStream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };

    const clipStart = Math.max(0, Math.min(audioBuf.duration, playRange[0] || 0));
    const clipEnd = Math.max(clipStart, Math.min(audioBuf.duration, playRange[1] || audioBuf.duration));
    const clipDur = clipEnd - clipStart;
    if (clipDur <= 0) throw new Error("导出区间无效");

    return new Promise((resolve, reject) => {
      let raf = 0;
      let aborted = false;

      const cleanup = () => {
        cancelAnimationFrame(raf);
        try { src.stop(); } catch {}
        try { audioCtx.close(); } catch {}
        try { vStream.getTracks().forEach((t) => t.stop()); } catch {}
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        aborted = true;
        try { recorder.stop(); } catch {}
        cleanup();
        reject(new DOMException("Export aborted", "AbortError"));
      };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      recorder.onerror = (e) => { cleanup(); reject(e.error || new Error("MediaRecorder 错误")); };
      recorder.onstop = () => {
        if (aborted) return;
        cleanup();
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        // 触发下载
        const a = document.createElement("a");
        a.href = url;
        const base = (track.name || "beatflow").replace(/\.[^.]+$/, "");
        a.download = `${base}_${clipStart.toFixed(1)}-${clipEnd.toFixed(1)}s.webm`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        resolve({ ok: true, url, blob });
      };

      const t0 = performance.now();
      const draw = () => {
        if (aborted) return;
        const elapsed = (performance.now() - t0) / 1000;
        if (elapsed >= clipDur) { recorder.stop(); return; }
        const t = clipStart + elapsed;
        const idx = beatIndexAt(t, beats);
        const img = images[idx % images.length];
        drawImage(ctx, img, w, h, fitMode, bitmapMap);
        onProgress(Math.min(1, elapsed / clipDur));
        raf = requestAnimationFrame(draw);
      };

      recorder.start();
      src.start(0, clipStart, clipDur);
      raf = requestAnimationFrame(draw);
    });
  }

  global.BeatflowExport = { exportVideo };
})(window);
