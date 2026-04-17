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

async function decodeBitmaps(segments) {
  const map = new Map();
  for (const s of segments) {
    if (s.image && !map.has(s.image)) {
      map.set(s.image, await createImageBitmap(s.image));
    }
  }
  return map;
}

function drawCover(ctx, bmp, w, h) {
  const scale = Math.max(w / bmp.width, h / bmp.height);
  const dw = bmp.width * scale;
  const dh = bmp.height * scale;
  ctx.drawImage(bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// 在浏览器里把"音频 + 按节拍切换的图片"录制为 webm Blob。
//
// 实现是"实时录制"：导出 1 分钟的视频需要 1 分钟（由 MediaRecorder 决定）。
// 想要离线加速，得换 WebCodecs + mp4-muxer。
// startSec / endSec 可选，表示只导出 [startSec, endSec) 区间：
// - 音频用 AudioBufferSourceNode.start(0, offset, duration) 从 startSec 开始并限制时长
// - 画面按"原始时间轴"找当前 segment（不会把 startSec 后的时间重映射为 0），
//   这样用户看到什么就导出什么
export async function exportVideo({
  audioFile,
  segments,
  width = 720,
  height = 1280,
  fps = 30,
  startSec = 0,
  endSec,
  onProgress,
}) {
  if (!audioFile) throw new Error("缺少音频文件");
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("缺少节拍段");
  if (!segments.some((s) => s.image)) throw new Error("时间线里没有图片");

  const bitmaps = await decodeBitmaps(segments);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const canvasStream = canvas.captureStream(fps);

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const arrayBuf = await audioFile.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(arrayBuf.slice(0));
  const dest = audioCtx.createMediaStreamDestination();
  const source = audioCtx.createBufferSource();
  source.buffer = audioBuf;
  source.connect(dest);

  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const lastSeg = segments[segments.length - 1];
  const rawEnd = Number.isFinite(endSec) && endSec > 0 ? endSec : (lastSeg.end || audioBuf.duration);
  const clipStart = Math.max(0, Math.min(audioBuf.duration, Number(startSec) || 0));
  const clipEnd = Math.max(clipStart, Math.min(audioBuf.duration, rawEnd));
  const clipDur = clipEnd - clipStart;
  if (clipDur <= 0) throw new Error("导出区间无效：起始 ≥ 结束");

  return new Promise((resolve, reject) => {
    let rafId = 0;

    function cleanup() {
      cancelAnimationFrame(rafId);
      try { source.stop(); } catch {}
      try { audioCtx.close(); } catch {}
      try { canvasStream.getTracks().forEach((t) => t.stop()); } catch {}
    }

    recorder.onerror = (e) => {
      cleanup();
      reject(e.error || new Error("MediaRecorder 错误"));
    };
    recorder.onstop = () => {
      cleanup();
      resolve(new Blob(chunks, { type: mimeType }));
    };

    const t0 = performance.now();

    function frame() {
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed >= clipDur) {
        recorder.stop();
        return;
      }
      const t = clipStart + elapsed; // 原始时间轴上的绝对时间

      // 二分找当前 segment（segments 按 start 升序）
      let lo = 0, hi = segments.length - 1, idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (segments[mid].start <= t) { idx = mid; lo = mid + 1; }
        else hi = mid - 1;
      }
      const seg = segments[idx];

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (seg && seg.image) {
        const bmp = bitmaps.get(seg.image);
        if (bmp) drawCover(ctx, bmp, width, height);
      }

      if (onProgress) onProgress(Math.min(1, elapsed / clipDur));
      rafId = requestAnimationFrame(frame);
    }

    recorder.start();
    source.start(0, clipStart, clipDur);
    rafId = requestAnimationFrame(frame);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
