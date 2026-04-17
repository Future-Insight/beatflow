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
export async function exportVideo({
  audioFile,
  segments,
  width = 720,
  height = 1280,
  fps = 30,
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
  const totalSec = Math.min(audioBuf.duration, lastSeg.end || audioBuf.duration);

  return new Promise((resolve, reject) => {
    let rafId = 0;
    let segIdx = 0;

    function cleanup() {
      cancelAnimationFrame(rafId);
      try { source.stop(); } catch {}
      try { audioCtx.close(); } catch {}
      try {
        canvasStream.getTracks().forEach((t) => t.stop());
      } catch {}
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
      const t = (performance.now() - t0) / 1000;
      if (t >= totalSec) {
        recorder.stop();
        return;
      }

      // 顺序推进指针，避免每帧 O(n) 查找
      while (segIdx + 1 < segments.length && t >= segments[segIdx + 1].start) segIdx += 1;
      const seg = segments[segIdx];

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
      if (seg && seg.image) {
        const bmp = bitmaps.get(seg.image);
        if (bmp) drawCover(ctx, bmp, width, height);
      }

      if (onProgress) onProgress(Math.min(1, t / totalSec));
      rafId = requestAnimationFrame(frame);
    }

    recorder.start();
    source.start(0);
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
