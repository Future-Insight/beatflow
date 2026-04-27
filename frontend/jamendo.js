/* =========================================================
   Beatflow · jamendo.js
   ---------------------------------------------------------
   暴露 window.BeatflowJamendo 命名空间，封装后端 Jamendo 端点：
     fetchPopular({genre, limit})  → Promise<{tracks, total}>
     streamUrl(trackId)            → string  (试听代理 URL)
     fetchTrackBlob(trackId)       → Promise<{blob, filename}>

   依赖 uploads.js 暴露的 BeatflowUploads.getApiUrl()。
   ========================================================= */

(function (global) {
  "use strict";

  function getApiUrl() {
    // 复用 uploads.js 已有的 API URL 逻辑
    return (global.BeatflowUploads && global.BeatflowUploads.getApiUrl
      ? global.BeatflowUploads.getApiUrl()
      : (global.location.origin)
    ).replace(/\/+$/, "");
  }

  async function fetchPopular({ genre = null, limit = 30 } = {}) {
    const params = new URLSearchParams();
    if (genre) params.set("genre", genre);
    params.set("limit", String(limit));
    const url = `${getApiUrl()}/api/jamendo/popular?${params}`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `加载失败 ${resp.status}`);
    return data; // {tracks: [...], total}
  }

  function streamUrl(trackId) {
    return `${getApiUrl()}/api/jamendo/stream?track_id=${encodeURIComponent(trackId)}`;
  }

  async function fetchTrackBlob(trackId) {
    const url = `${getApiUrl()}/api/jamendo/fetch`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: trackId }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `下载失败 ${resp.status}`);
    }
    const blob = await resp.blob();
    // 从 Content-Disposition 提取建议文件名
    // 后端用 RFC 5987 双 filename 语法返回 `filename="ascii.mp3"; filename*=UTF-8''<encoded>`
    // 这里取 ASCII fallback 即可（够用于 File 名字，浏览器拿 blob 不需要原始中文名）
    const cd = resp.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename="([^"]+)"/);
    const filename = m ? m[1] : `jamendo_${trackId}.mp3`;
    return { blob, filename };
  }

  global.BeatflowJamendo = {
    fetchPopular,
    streamUrl,
    fetchTrackBlob,
  };
})(window);
