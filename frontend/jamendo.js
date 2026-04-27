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

  const GENRES = [
    null, "ambient", "classical", "electronic", "hiphop", "jazz",
    "lounge", "pop", "rock", "soundtrack", "world",
  ];

  function fmtDur(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function licenseLabel(lic) {
    if (!lic || lic === "unknown") return "";
    return "CC " + lic.toUpperCase();
  }

  function PickerModal(props) {
    const { React } = global;
    const { useState, useEffect, useRef } = React;
    const { open, onClose, onPick } = props;

    const [genre, setGenre] = useState(null);
    const [tracks, setTracks] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [error, setError] = useState(null);
    const [playingId, setPlayingId] = useState(null);
    const [selectingId, setSelectingId] = useState(null);
    const audioRef = useRef(null);

    // 加载/刷新列表
    useEffect(() => {
      if (!open) return;
      let cancelled = false;
      setLoadingList(true);
      setError(null);
      fetchPopular({ genre, limit: 30 })
        .then((data) => { if (!cancelled) setTracks(data.tracks || []); })
        .catch((e) => { if (!cancelled) setError(e.message || String(e)); })
        .finally(() => { if (!cancelled) setLoadingList(false); });
      return () => { cancelled = true; };
    }, [open, genre]);

    // Modal 关闭时停止试听
    useEffect(() => {
      if (!open && audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        setPlayingId(null);
      }
    }, [open]);

    // Esc 关闭
    useEffect(() => {
      if (!open) return;
      const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;

    const onPickClick = async (t) => {
      if (selectingId) return;
      setSelectingId(t.id);
      try {
        const { blob, filename } = await fetchTrackBlob(t.id);
        const file = new File([blob], filename, { type: blob.type || "audio/mpeg" });
        // 停掉试听
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = "";
        }
        setPlayingId(null);
        onPick && onPick(file);
        onClose && onClose();
      } catch (err) {
        alert("下载失败：" + (err.message || err));
      } finally {
        setSelectingId(null);
      }
    };

    const e = React.createElement;

    const chipsRow = e("div", { className: "jamendo-chips" },
      GENRES.map((g) => e("button", {
        key: g || "all",
        type: "button",
        className: "jamendo-chip" + (genre === g ? " active" : ""),
        disabled: loadingList,
        onClick: () => setGenre(g),
      }, g || "全部"))
    );

    const Fragment = global.React.Fragment;
    const listBody = error
      ? e("div", { className: "jamendo-error" }, "加载失败：" + error)
      : loadingList
        ? e("div", { className: "jamendo-loading" }, "加载中…")
        : tracks.length === 0
          ? e("div", { className: "jamendo-empty" }, "无结果")
          : e("ul", { className: "jamendo-list" },
              tracks.map((t) => e(Fragment, { key: t.id }, renderTrackRow(t, {
                playingId, setPlayingId, selectingId, setSelectingId,
                audioRef, onClose, onPick, onPickClick,
              }))));

    return e("div", {
      className: "jamendo-modal-backdrop",
      onClick: onClose,
    }, e("div", {
      className: "jamendo-modal",
      onClick: (ev) => ev.stopPropagation(),
    },
      e("header", { className: "jamendo-header" },
        e("span", null, "Jamendo 热门音乐"),
        e("button", {
          type: "button", "aria-label": "关闭",
          className: "jamendo-close", onClick: onClose,
        }, "×")
      ),
      chipsRow,
      e("div", { className: "jamendo-body" }, listBody),
      e("audio", {
        ref: audioRef, preload: "none", style: { display: "none" },
        onEnded: () => setPlayingId(null),
      })
    ));
  }

  function renderTrackRow(t, ctx) {
    const { React } = global;
    const e = React.createElement;
    const { playingId, setPlayingId, audioRef } = ctx;
    const isPlaying = playingId === t.id;

    const onTogglePlay = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (isPlaying) {
        audio.pause();
        setPlayingId(null);
      } else {
        // 切换到新曲：先停掉当前
        audio.pause();
        audio.src = streamUrl(t.id);
        audio.play().then(() => setPlayingId(t.id)).catch((err) => {
          console.warn("试听失败", err);
          setPlayingId(null);
        });
      }
    };

    return e("li", { className: "jamendo-row" + (isPlaying ? " playing" : "") },
      e("img", {
        className: "jamendo-cover",
        src: t.cover_url || "", alt: "",
        onError: (ev) => { ev.target.style.visibility = "hidden"; },
      }),
      e("div", { className: "jamendo-meta" },
        e("div", { className: "jamendo-title" }, t.title || "(无标题)"),
        e("div", { className: "jamendo-artist" }, t.artist || ""),
        licenseLabel(t.license)
          ? e("div", { className: "jamendo-license" }, licenseLabel(t.license))
          : null
      ),
      e("div", { className: "jamendo-dur" }, fmtDur(t.duration)),
      e("button", {
        type: "button",
        className: "jamendo-play",
        "aria-label": isPlaying ? "暂停" : "试听",
        onClick: onTogglePlay,
      }, isPlaying ? "⏸" : "▶"),
      e("button", {
        type: "button",
        className: "jamendo-pick",
        onClick: () => ctx.onPickClick && ctx.onPickClick(t),
        disabled: ctx.selectingId === t.id || !ctx.onPickClick,
      }, ctx.selectingId === t.id ? "下载中…" : "选用")
    );
  }

  global.BeatflowJamendo = {
    fetchPopular,
    streamUrl,
    fetchTrackBlob,
    PickerModal,
  };
})(window);
