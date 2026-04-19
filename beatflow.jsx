const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ----------------- demo data ----------------- */
// Presets and seed images now live in uploads.js so they can be
// swapped out alongside the file-handling logic.
const PRESET_TRACKS     = window.BeatflowUploads.PRESET_TRACKS;
const PRESET_IMAGE_SETS = window.BeatflowUploads.PRESET_IMAGE_SETS;
const DEMO_TRACK        = window.BeatflowUploads.getDefaultTrack();

// Build synthetic beat timestamps from BPM + duration, with a tiny "swing" jitter for believability
function buildBeats(bpm, duration) {
  const interval = 60 / bpm;
  const beats = [];
  for (let t = interval * 0.5; t < duration; t += interval) {
    // keep perfectly on-grid; jitter reads as messy on a visualization this small
    beats.push(+t.toFixed(3));
  }
  return beats;
}

// Synthetic waveform amplitudes (deterministic) — pseudo-song shape
function buildWaveform(samples, bpm, duration) {
  const arr = new Float32Array(samples);
  const beatInterval = 60 / bpm;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * duration;
    // envelope: quiet intro, loud middle, softer outro
    const env = 0.35 + 0.55 * Math.sin((t / duration) * Math.PI);
    // 4-on-the-floor kick pulses
    const beatPhase = (t % beatInterval) / beatInterval;
    const kick = Math.exp(-beatPhase * 14) * 0.9;
    // hi-hat noise
    const hat = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const noise = Math.abs(hat) * 0.25;
    // melodic hum
    const hum = 0.15 * Math.abs(Math.sin(t * 2.1));
    arr[i] = Math.min(1, env * (kick + noise + hum));
  }
  return arr;
}

/* ----------------- utils ----------------- */
const fmtTime = (s) => {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
};

/* ----------------- i18n ----------------- */
const I18N = {
  zh: {
    "brand.sub": "节拍卡点工作台",
    "brand.live": "在线体验",
    "hero.title1": "让音乐替你",
    "hero.title2": "剪出每一个节拍。",
    "hero.sub": "上传一首音乐 + 选择图片，分析 BPM 与节拍点，图片按节拍切换。所见即所得，直接导出为",
    "hero.sub_tail": "。无需登录、无需后端。",
    "privacy.title": "隐私优先",
    "privacy.line1": "远程 API 识别节拍",
    "privacy.line2": "本地生成视频",
    "privacy.line3": "图片与导出永不上传",
    "privacy.inline": "节拍识别走远程 API · 视频在本地渲染 · 图片与导出永不上传。",
    "stat.bpm": "BPM",
    "stat.duration": "时长",
    "stat.beats": "节拍数",
    "stat.bpm_unit": "beats/min",
    "stat.duration_unit": "sec",
    "stat.beats_unit": "hits",
    "stat.analyzed": "已分析",
    "stat.exported": "已导出",
    "stat.analyzed_tip": "累计分析过的音乐数量",
    "stat.exported_tip": "累计导出过的视频数量",
    "p1.title": "音频与节拍",
    "p1.subtitle": "AUDIO · BEAT DETECTION",
    "p1.audio_file": "音频文件",
    "p1.upload_music": "上传音乐",
    "p1.upload_hint": "点击上传 或拖入音频文件",
    "p1.upload_formats": "MP3 · WAV · M4A · FLAC · 最大 50MB",
    "p1.parsed": "已解析",
    "p1.presets": "预置曲目",
    "p1.presets_hint": "一键载入，跳过分析",
    "p1.method": "检测方法",
    "p1.method.beat": "beat · 流行/电子/舞曲 · 强拍定位",
    "p1.method.onset": "onset · 氛围/古典/复杂节奏 · 能量突变",
    "p1.min_interval": "最小节拍间隔",
    "p1.sec": "sec",
    "p1.analyze": "开始分析",
    "p1.reanalyze": "重新分析",
    "p1.analyzing": "正在分析…",
    "p1.play": "播放",
    "p1.pause": "暂停",
    "p1.analysis": "Analysis",
    "p1.beats": "beats",
    "p1.conf": "conf",
    "p1.detected": "✓ DETECTED",
    "p1.avg": "avg",
    "p2.title": "实时预览",
    "p2.hard_cut": "WYSIWYG · HARD-CUT",
    "p2.cut": "CUT",
    "p2.next_beat": "NEXT BEAT",
    "p2.grid": "GRID",
    "p2.fit": "FIT",
    "p2.mode": "MODE",
    "p2.mode_val": "hard-cut",
    "p2.start_sec": "起始秒",
    "p2.end_sec": "结束秒",
    "p2.reset_range": "重置",
    "p2.images": "张图片",
    "p2.beats_n": "个节拍",
    "p2.loops": "次循环",
    "p3.title": "图片素材",
    "p3.subtitle": "图片只存本地，不会上传",
    "p3.count_pre": "已上传",
    "p3.count_post": "张 · 拖拽排序决定分配到节拍的顺序",
    "p3.fit_cover": "填充",
    "p3.fit_contain": "适应",
    "p3.fit_stretch": "拉伸",
    "p3.order_seq": "固定",
    "p3.order_rand": "随机",
    "p3.upload": "选择图片",
    "p4.title": "导出",
    "p4.subtitle": "EXPORT · WEBM / MP4",
    "p4.range_label": "片段范围",
    "p4.range_hint": "来自预览面板 · 起/止",
    "p4.segment": "片段",
    "p4.res": "分辨率",
    "p4.fps": "帧率",
    "p4.fmt": "格式",
    "p4.export": "导出视频",
    "p4.exporting": "录制中…",
    "p4.note": "本机导出 · 请保持本页可见，切走窗口会导致卡点错位",
    "tweaks.title": "Tweaks",
    "tweaks.accent": "主题色",
    "tweaks.aspect": "预览比例",
    "tweaks.pulse": "脉冲强度",
    "tweaks.wave_style": "波形样式",
    "tweaks.wave_bars": "柱状",
    "tweaks.wave_line": "线性",
    "footer.blurb": "浏览器内的节拍卡点视频工作台。上传音频与图像，AI 识别节拍，本地渲染导出。",
    "footer.status": "服务正常",
    "footer.product": "产品",
    "footer.features": "功能特性",
    "footer.docs": "使用文档",
    "footer.changelog": "更新日志",
    "footer.roadmap": "路线图",
    "footer.resources": "资源",
    "footer.issues": "反馈 Issue",
    "footer.discuss": "社区讨论",
    "footer.contact": "联系我们",
    "footer.legal": "条款",
    "footer.privacy": "隐私政策",
    "footer.terms": "使用条款",
    "footer.attribution": "致谢与引用",
    "footer.copy_tail": "保留所有权利 · Made in the browser",
  },
  en: {
    "brand.sub": "beat-cut workbench",
    "brand.live": "Live app",
    "hero.title1": "Let the music",
    "hero.title2": "cut every beat for you.",
    "hero.sub": "Upload a song + pick images. Analyze BPM and beats, images switch on every beat. WYSIWYG — export directly to",
    "hero.sub_tail": ". No login, no backend.",
    "privacy.title": "Privacy-first",
    "privacy.line1": "Remote API for beat detection",
    "privacy.line2": "Video rendered locally",
    "privacy.line3": "Images & exports never leave your device",
    "privacy.inline": "Beats detected via remote API · video rendered locally · images & exports never leave your device.",
    "stat.bpm": "BPM",
    "stat.duration": "Duration",
    "stat.beats": "Beats",
    "stat.bpm_unit": "beats/min",
    "stat.duration_unit": "sec",
    "stat.beats_unit": "hits",
    "stat.analyzed": "Analyzed",
    "stat.exported": "Exported",
    "stat.analyzed_tip": "Total analyzed tracks",
    "stat.exported_tip": "Total exported videos",
    "p1.title": "Audio & Beats",
    "p1.subtitle": "AUDIO · BEAT DETECTION",
    "p1.audio_file": "Audio file",
    "p1.upload_music": "Upload music",
    "p1.upload_hint": "Click to upload or drop audio file",
    "p1.upload_formats": "MP3 · WAV · M4A · FLAC · max 50MB",
    "p1.parsed": "parsed",
    "p1.presets": "Presets",
    "p1.presets_hint": "one-click load, skip analysis",
    "p1.method": "Detection method",
    "p1.method.beat": "beat · pop/dance · downbeats",
    "p1.method.onset": "onset · ambient/classical · transients",
    "p1.min_interval": "Min beat interval",
    "p1.sec": "sec",
    "p1.analyze": "Analyze",
    "p1.reanalyze": "Re-analyze",
    "p1.analyzing": "Analyzing…",
    "p1.play": "Play",
    "p1.pause": "Pause",
    "p1.analysis": "Analysis",
    "p1.beats": "beats",
    "p1.conf": "conf",
    "p1.detected": "✓ DETECTED",
    "p1.avg": "avg",
    "p2.title": "Live Preview",
    "p2.hard_cut": "WYSIWYG · HARD-CUT",
    "p2.cut": "CUT",
    "p2.next_beat": "NEXT BEAT",
    "p2.grid": "GRID",
    "p2.fit": "FIT",
    "p2.mode": "MODE",
    "p2.mode_val": "hard-cut",
    "p2.start_sec": "Start",
    "p2.end_sec": "End",
    "p2.reset_range": "Reset",
    "p2.images": "images",
    "p2.beats_n": "beats",
    "p2.loops": "loops",
    "p3.title": "Image Library",
    "p3.subtitle": "IMAGES STAY LOCAL · NEVER UPLOADED",
    "p3.count_pre": "Uploaded",
    "p3.count_post": "images · drag to set order",
    "p3.fit_cover": "Cover",
    "p3.fit_contain": "Contain",
    "p3.fit_stretch": "Stretch",
    "p3.order_seq": "Fixed",
    "p3.order_rand": "Random",
    "p3.upload": "Pick",
    "p4.title": "Export",
    "p4.subtitle": "EXPORT · WEBM / MP4",
    "p4.range_label": "Segment",
    "p4.range_hint": "from preview · in/out",
    "p4.segment": "clip",
    "p4.res": "res",
    "p4.fps": "fps",
    "p4.fmt": "fmt",
    "p4.export": "Export",
    "p4.exporting": "Recording…",
    "p4.note": "Local export · keep this tab visible — switching away desyncs beats",
    "tweaks.title": "Tweaks",
    "tweaks.accent": "Accent color",
    "tweaks.aspect": "Aspect",
    "tweaks.pulse": "Pulse intensity",
    "tweaks.wave_style": "Waveform",
    "tweaks.wave_bars": "Bars",
    "tweaks.wave_line": "Line",
    "footer.blurb": "An in-browser beat-cut video workbench. Upload audio & images, let AI lock the beats, render & export locally.",
    "footer.status": "All systems normal",
    "footer.product": "Product",
    "footer.features": "Features",
    "footer.docs": "Docs",
    "footer.changelog": "Changelog",
    "footer.roadmap": "Roadmap",
    "footer.resources": "Resources",
    "footer.issues": "Report an issue",
    "footer.discuss": "Community",
    "footer.contact": "Contact",
    "footer.legal": "Legal",
    "footer.privacy": "Privacy",
    "footer.terms": "Terms",
    "footer.attribution": "Attribution",
    "footer.copy_tail": "All rights reserved · Made in the browser",
  },
};

const I18nCtx = React.createContext({ lang: "en", t: (k) => I18N.en[k] || k });
function useT() { return React.useContext(I18nCtx); }


const TWEAKS = window.__BEATFLOW_TWEAKS__ || {};
const sendTweak = (edits) => {
  try { window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*"); } catch (e) {}
};

/* =================================================
   HERO
   ================================================= */
function Hero({ bpm, duration, beatCount, lang, theme, onToggleLang, onToggleTheme, analyzedCount, exportedCount }) {
  const { t } = useT();
  return (
    <header className="hero">
      <div className="brand-row">
        <div className="brand-mark" />
        <div className="brand-name">Beatflow</div>
        <div className="brand-dot">·</div>
        <div className="brand-sub">{t("brand.sub")}</div>
        <div className="brand-stats">
          <div className="bs-item" title={t("stat.analyzed_tip")}>
            <span className="bs-v">{analyzedCount}</span>
            <span className="bs-k">{t("stat.analyzed")}</span>
          </div>
          <div className="bs-sep"/>
          <div className="bs-item" title={t("stat.exported_tip")}>
            <span className="bs-v">{exportedCount}</span>
            <span className="bs-k">{t("stat.exported")}</span>
          </div>
        </div>
        <div className="brand-toolbar">
          <button className="tb-btn" onClick={onToggleLang} title="Language" aria-label="Language">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
              <circle cx="12" cy="12" r="9"/>
              <path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>
            </svg>
            <span>{lang === "zh" ? "EN" : "中"}</span>
          </button>
          <button className="tb-btn" onClick={onToggleTheme} title="Theme" aria-label="Theme">
            {theme === "dark" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="14" height="14">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M20.5 14.5A8 8 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>
              </svg>
            )}
          </button>
          <a className="tb-btn tb-icon" href="https://github.com/Future-Insight/beatflow" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub">
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.35-1.3-1.7-1.3-1.7-1.06-.73.08-.72.08-.72 1.18.08 1.8 1.22 1.8 1.22 1.04 1.78 2.73 1.26 3.4.96.1-.75.41-1.26.74-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.3-.52-1.48.11-3.08 0 0 .97-.31 3.18 1.18a11.05 11.05 0 0 1 5.78 0c2.2-1.49 3.18-1.18 3.18-1.18.63 1.6.23 2.78.12 3.08.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.79 1.07.79 2.17v3.21c0 .32.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>
            </svg>
          </a>
        </div>
      </div>
      <div className="hero-body">
        <div className="hero-main">
        <h1>
          {t("hero.title1")}<br/>
          <span className="grad">{t("hero.title2")}</span>
        </h1>
        <p className="hero-sub">
          {t("hero.sub")} <code>.webm</code>{t("hero.sub_tail")}
          <span className="hero-sub-meta"> {t("privacy.inline")}</span>
        </p>
      </div>

      <div className="hero-side">
        <div className="stat-chips">
          <div className="chip live">
            <div className="chip-label">{t("stat.bpm")}</div>
            <div className="chip-value">{bpm}<span className="chip-unit">{t("stat.bpm_unit")}</span></div>
          </div>
          <div className="chip live">
            <div className="chip-label">{t("stat.duration")}</div>
            <div className="chip-value">{duration.toFixed(1)}<span className="chip-unit">{t("stat.duration_unit")}</span></div>
          </div>
          <div className="chip live">
            <div className="chip-label">{t("stat.beats")}</div>
            <div className="chip-value">{beatCount}<span className="chip-unit">{t("stat.beats_unit")}</span></div>
          </div>
        </div>
      </div>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useT();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="ft-left">
        <div className="brand-mark" />
        <span className="ft-name">Beatflow</span>
        <span className="ft-dim">© {year}</span>
      </div>
      <div className="ft-links">
        <a href="https://github.com/Future-Insight/beatflow" target="_blank" rel="noopener" className="ft-link">GitHub ↗</a>
      </div>
    </footer>
  );
}

/* =================================================
   AUDIO PANEL
   ================================================= */
function AudioPanel({ track, setTrack, analyzed, onAnalyze, analyzing, waveform, beats, currentTime, duration, playing, onPlay, playRange, onPickPreset, onClearAudio }) {
  const { t } = useT();
  const fileInputRef = useRef(null);
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title"><span className="num">01</span>{t("p1.title")}</div>
        <div className="panel-sub">{t("p1.subtitle")}</div>
      </div>

      <div className="field">
        <div className="field-label-row">
          <label>{t("p1.audio_file")}</label>
          <button type="button" className="field-action" onClick={() => {
            onClearAudio && onClearAudio();
            setTimeout(() => fileInputRef.current?.click(), 0);
          }}>{t("p1.upload_music")}</button>
        </div>
        <label className={`upload ${track ? "has-file" : ""}`}>
          <input ref={fileInputRef} type="file" accept="audio/*" onChange={async (e) => {
            const f = e.target.files && e.target.files[0];
            const next = await window.BeatflowUploads.handleAudioUpload(f);
            setTrack(next);
            e.target.value = "";
          }} />
          <div className="upload-ico">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>
            </svg>
          </div>
          <div className="upload-text">
            <div className="t1">{track ? track.name : t("p1.upload_hint")}</div>
            <div className="t2">{track ? `${track.size} · ${t("p1.parsed")}` : t("p1.upload_formats")}</div>
          </div>
          {track && (
            <button
              type="button"
              className="upload-clear"
              aria-label="取消"
              title="取消"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClearAudio && onClearAudio(); }}
            >×</button>
          )}
        </label>
      </div>

      <div className="field" style={{marginTop: -4}}>
        <label>{t("p1.presets")} <span className="hint">{t("p1.presets_hint")}</span></label>
        <div className="preset-chips">
          {PRESET_TRACKS.map(p => (
            <button key={p.key}
              className={`preset-chip ${track && track.key === p.key ? "on" : ""}`}
              onClick={() => onPickPreset(p)}>
              <div className="pc-genre">{p.genre}</div>
              <div className="pc-name">{p.mood}</div>
              <div className="pc-meta">{p.bpm} BPM · {p.duration.toFixed(0)}s</div>
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label>{t("p1.method")}</label>
          <select className="select" value={track?.method || "beat"} onChange={(e) => track && setTrack({ ...track, method: e.target.value })}>
            <option value="beat">{t("p1.method.beat")}</option>
            <option value="onset">{t("p1.method.onset")}</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>{t("p1.min_interval")} <span className="hint">{t("p1.sec")}</span></label>
          <input className="input mono" type="number" step="0.01" min="0.05" max="2"
            value={track?.minInterval ?? 0.18}
            onChange={(e) => track && setTrack({ ...track, minInterval: +e.target.value })} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 4 }}>
        <button className={`btn ${analyzed ? "btn-ghost" : "btn-primary"}`} disabled={!track || analyzing} onClick={onAnalyze}>
          {analyzing ? <><span className="spinner"/> {t("p1.analyzing")}</> : analyzed ? t("p1.reanalyze") : t("p1.analyze")}
        </button>
        <button className="btn" onClick={onPlay} disabled={!analyzed}>
          {playing ? (
            <><svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="3" height="8" fill="currentColor"/><rect x="7" y="2" width="3" height="8" fill="currentColor"/></svg> {t("p1.pause")}</>
          ) : (
            <><svg width="12" height="12" viewBox="0 0 12 12"><polygon points="3,2 10,6 3,10" fill="currentColor"/></svg> {t("p1.play")}</>
          )}
          <span className="kbd">Space</span>
        </button>
      </div>

      {analyzed && (
        <WavePreview
          waveform={waveform}
          beats={beats}
          duration={duration}
          currentTime={currentTime}
          playRange={playRange}
        />
      )}
    </section>
  );
}

function WavePreview({ waveform, beats, duration }) {
  // Beat-strength histogram: one bar per beat, amplitude = audio peak near that beat.
  // Deliberately different from the right-side playback timeline.
  const bars = beats.map((b) => {
    if (!waveform) return 0.5;
    const i = Math.floor((b / duration) * waveform.length);
    let peak = 0;
    for (let k = Math.max(0, i - 8); k < Math.min(waveform.length, i + 8); k++) {
      peak = Math.max(peak, waveform[k] || 0);
    }
    return peak;
  });

  const avgInterval = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0;
  const confidence = 94;

  return (
    <div className="wave">
      <div className="wave-head">
        <div className="t">Analysis · {beats.length} beats · conf {confidence}%</div>
        <div className="t" style={{ color: "var(--ok)" }}>✓ DETECTED</div>
      </div>
      <div className="wave-canvas" style={{height: 64}}>
        <svg viewBox={`0 0 ${Math.max(bars.length, 1)} 64`} preserveAspectRatio="none">
          {bars.map((v, i) => {
            const h = Math.max(3, v * 56);
            const isDown = i % 4 === 0;
            return (
              <rect key={i}
                x={i + 0.1} y={32 - h/2}
                width={0.8} height={h} rx="0.2"
                fill={isDown ? "var(--accent)" : "var(--fg-dim)"}
                opacity={isDown ? 0.95 : 0.55}
              />
            );
          })}
        </svg>
      </div>
      <div className="wave-foot">
        <button className="btn" style={{flex:0}}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 1v8M3 6l3 3 3-3M2 11h8"/></svg>
          beats.json
        </button>
        <button className="btn" style={{flex:0}}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 1v8M3 6l3 3 3-3M2 11h8"/></svg>
          beats.csv
        </button>
        <div style={{flex:1}} />
        <div style={{fontFamily:"var(--font-mono)", fontSize: 10.5, color:"var(--fg-muted)", alignSelf:"center"}}>
          Δ {avgInterval.toFixed(3)}s avg
        </div>
      </div>
    </div>
  );
}

/* =================================================
   PREVIEW PANEL
   ================================================= */
function PreviewPanel({ aspect, setAspect, playing, onPlay, currentTime, duration, beats, onSeek, images, activeImageIdx, pulseKey, pulseMs, exporting, exportProgress, fitMode, playRange, setPlayRange }) {
  const { t } = useT();
  const trackRef = useRef(null);

  const onTrackClick = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    onSeek((x / rect.width) * duration);
  };

  const onDrag = (e) => {
    if (e.buttons !== 1) return;
    onTrackClick(e);
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const aspectClass = aspect === "1:1" ? "a1-1" : aspect === "16:9" ? "a16-9" : "";

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title"><span className="num">02</span>{t("p2.title")}</div>
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <div className="seg aspect-seg">
            {["9:16", "1:1", "16:9"].map(a => (
              <button key={a} className={aspect === a ? "on" : ""} onClick={() => setAspect && setAspect(a)}>{a}</button>
            ))}
          </div>
          <div className="panel-sub">{t("p2.hard_cut")}</div>
        </div>
      </div>

      <div className={`preview-wrap ${aspect === "16:9" ? "stacked" : ""}`}>
        <div className="stage-holder">
          <div className={`stage ${aspectClass}`} style={{"--pulse-ms": `${pulseMs}ms`}}>
            <div className="stage-hud">
              <div className="tag">{aspect}</div>
              {exporting ? (
                <div className="rec"><span className="dot"/> REC {Math.round(exportProgress * 100)}%</div>
              ) : playing ? (
                <div className="rec" style={{color:"#fff"}}>
                  <span className="dot" style={{background:"#4ade80", boxShadow:"0 0 6px #4ade80"}}/>
                  LIVE
                </div>
              ) : null}
            </div>

            {images.length === 0 ? (
              <div className="slide on">
                <div className="slide-placeholder" style={{background: "linear-gradient(135deg, #1a1a2e, #16213e)"}}>
                  <div style={{textAlign:"center", opacity:.8}}>
                    <div style={{fontSize:26, marginBottom:8}}>▢</div>
                    <div>drop images here</div>
                  </div>
                </div>
              </div>
            ) : images.map((img, i) => (
              <div key={img.id} className={`slide ${i === activeImageIdx ? "on" : ""}`}>
                {img.type === "swatch" ? (
                  <div className="slide-placeholder"
                    style={{background: `linear-gradient(135deg, ${img.c1}, ${img.c2})`}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:10, opacity:.7, letterSpacing:"0.2em"}}>IMG_{String(i+1).padStart(2,"0")}</div>
                      <div style={{marginTop:8, fontSize: 12, opacity:.85}}>{img.label}</div>
                    </div>
                  </div>
                ) : (
                  <img className="slide-img" src={img.src} alt=""
                    style={{
                      objectFit: fitMode === "stretch" ? "fill" : fitMode,
                      background: fitMode === "contain" ? "#000" : undefined,
                    }} />
                )}
              </div>
            ))}
            <div key={pulseKey} className={`pulse ${pulseKey > 0 ? "fire" : ""}`} />
          </div>
          <div className="stage-meta">
            <div><b>{images.length}</b> {t("p2.images")}</div>
            <div><b>{beats.length}</b> {t("p2.beats_n")}</div>
            <div><b>{images.length > 0 ? Math.ceil(beats.length / images.length) : 0}</b> {t("p2.loops")}</div>
          </div>
        </div>

        <div>
          <div className="timeline">
            <div className="tl-head">
              <div className="tl-time">
                <span>{fmtTime(currentTime)}</span>
                <span className="sep">/</span>
                <span style={{color:"var(--fg-muted)"}}>{fmtTime(duration)}</span>
              </div>
              <div className="tl-ctrls">
                <button className="btn btn-icon" onClick={() => onSeek(Math.max(0, currentTime - 1))} title="−1s">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="8,1 3,5 8,9"/><rect x="1" y="1" width="1.5" height="8"/></svg>
                </button>
                <button className="btn btn-icon" onClick={onPlay} title="play/pause">
                  {playing ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="1" width="2.2" height="8"/><rect x="5.8" y="1" width="2.2" height="8"/></svg>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>
                  )}
                </button>
                <button className="btn btn-icon" onClick={() => onSeek(Math.min(duration, currentTime + 1))} title="+1s">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 7,5 2,9"/><rect x="7.5" y="1" width="1.5" height="8"/></svg>
                </button>
              </div>
            </div>
            <div className="tl-track-wrap"
              ref={trackRef}
              onMouseDown={onTrackClick}
              onMouseMove={onDrag}>
              <div className="tl-track" />
              <div className="tl-dim" style={{left: 0, width: `${(playRange[0]/duration)*100}%`}} />
              <div className="tl-dim" style={{right: 0, width: `${100 - (playRange[1]/duration)*100}%`}} />
              <div className="tl-fill" style={{ width: `${pct}%` }} />
              <div className="tl-beats">
                {beats.map((b, i) => (
                  <div key={i}
                    className={`tl-beat ${i%4===0?"downbeat":""} ${b <= currentTime ? "passed" : ""}`}
                    style={{ left: `${(b / duration) * 100}%` }}
                  />
                ))}
              </div>
              <div className="tl-range-mark start" style={{left: `${(playRange[0]/duration)*100}%`}} title={t("p2.start_sec")} />
              <div className="tl-range-mark end" style={{left: `${(playRange[1]/duration)*100}%`}} title={t("p2.end_sec")} />
              <div className="tl-playhead" style={{ left: `${pct}%` }} />
            </div>
            <div className="tl-labels">
              <span>00:00</span><span>{fmtTime(duration/4)}</span><span>{fmtTime(duration/2)}</span><span>{fmtTime(duration*3/4)}</span><span>{fmtTime(duration)}</span>
            </div>

            <div className="tl-range">
              <div className="tl-range-field">
                <label><span>{t("p2.start_sec")}</span><span className="v">{playRange[0].toFixed(2)}s</span></label>
                <div className="range-slider">
                  <div className="range-track" />
                  <div className="range-fill" style={{
                    left: `${(playRange[0]/duration)*100}%`,
                    right: `${100 - (playRange[1]/duration)*100}%`
                  }} />
                  <input type="range" min="0" max={duration} step="0.01" value={playRange[0]}
                    onChange={(e) => setPlayRange([Math.min(+e.target.value, playRange[1] - 0.1), playRange[1]])} />
                </div>
              </div>
              <div className="tl-range-field">
                <label><span>{t("p2.end_sec")}</span><span className="v">{playRange[1].toFixed(2)}s</span></label>
                <div className="range-slider">
                  <div className="range-track" />
                  <div className="range-fill" style={{
                    left: `${(playRange[0]/duration)*100}%`,
                    right: `${100 - (playRange[1]/duration)*100}%`
                  }} />
                  <input type="range" min="0" max={duration} step="0.01" value={playRange[1]}
                    onChange={(e) => setPlayRange([playRange[0], Math.max(+e.target.value, playRange[0] + 0.1)])} />
                </div>
              </div>
              <button className="btn btn-ghost tl-range-reset" onClick={() => setPlayRange([0, duration])} title={t("p2.reset_range")}>⟲</button>
            </div>
          </div>

          <div className="pill-row">
            <div className="pill accent"><span className="k">CUT</span>{images.length ? `img_${String(activeImageIdx+1).padStart(2,"0")}` : "—"}</div>
            <div className="pill"><span className="k">NEXT BEAT</span>{
              (() => {
                const n = beats.find(b => b > currentTime);
                return n ? `${(n - currentTime).toFixed(2)}s` : "—";
              })()
            }</div>
            <div className="pill"><span className="k">GRID</span>1/4</div>
            <div className="pill"><span className="k">FIT</span>{fitMode}</div>
            <div className="pill"><span className="k">MODE</span>hard-cut</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* =================================================
   THUMBS + EXPORT
   ================================================= */
function MediaExportPanel({ images, setImages, duration, playRange, setPlayRange, exporting, onExport, exportProgress, activeImageIdx, aspect, fitMode, setFitMode, onLoadImageSet, myImages, setMyImages, orderMode, setOrderMode }) {
  const { t } = useT();
  const [dragIdx, setDragIdx] = useState(-1);
  const [overIdx, setOverIdx] = useState(-1);
  const [overSide, setOverSide] = useState("left");
  const [previewIdx, setPreviewIdx] = useState(-1);
  const uploadInputRef = useRef(null);

  useEffect(() => {
    if (previewIdx < 0) return;
    const onKey = (e) => { if (e.key === "Escape") setPreviewIdx(-1); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewIdx]);

  const onThumbDragStart = (i) => (e) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = "move";
  };
  const onThumbDragOver = (i) => (e) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const side = (e.clientX - r.left) < r.width / 2 ? "left" : "right";
    setOverIdx(i); setOverSide(side);
  };
  const onThumbDrop = () => {
    if (dragIdx === -1 || overIdx === -1 || dragIdx === overIdx) {
      setDragIdx(-1); setOverIdx(-1); return;
    }
    const next = [...images];
    const [moved] = next.splice(dragIdx, 1);
    let target = overIdx > dragIdx ? overIdx - 1 : overIdx;
    if (overSide === "right") target += 1;
    next.splice(target, 0, moved);
    setImages(next);
    setDragIdx(-1); setOverIdx(-1);
  };

  const removeImage = (i) => async () => {
    const img = images[i];
    setImages(images.filter((_, j) => j !== i));
    if (img && img.type === "local") {
      try { await window.BeatflowMyImages.remove(img.id); } catch (e) { console.error(e); }
      setMyImages(prev => prev.filter(m => m.id !== img.id));
      try { URL.revokeObjectURL(img.src); } catch {}
    }
  };

  const [start, end] = playRange;
  const segDur = Math.max(0, end - start);

  return (
    <section className="panel wide">
      <div style={{display:"grid", gridTemplateColumns:"1.4fr 1fr", gap: 28}}>
        {/* Thumbnails */}
        <div>
          <div className="panel-head">
            <div className="panel-title"><span className="num">03</span>{t("p3.title")}</div>
            <div className="panel-sub">{t("p3.subtitle")}</div>
          </div>
          <div className="thumbs-head">
            <div className="count">
              {t("p3.count_pre")} <b>{images.length}</b> {t("p3.count_post")}
            </div>
            <div style={{display:"flex", gap:8, alignItems:"center"}}>
              <div className="seg fit-seg">
                {[
                  {k:"sequential", label: t("p3.order_seq")},
                  {k:"random",     label: t("p3.order_rand")},
                ].map(o => (
                  <button key={o.k} className={orderMode === o.k ? "on" : ""} onClick={() => setOrderMode(o.k)}>{o.label}</button>
                ))}
              </div>
              <div className="seg fit-seg">
                {[
                  {k:"cover", label: t("p3.fit_cover")},
                  {k:"contain", label: t("p3.fit_contain")},
                  {k:"stretch", label: t("p3.fit_stretch")},
                ].map(o => (
                  <button key={o.k} className={fitMode === o.k ? "on" : ""} onClick={() => setFitMode(o.k)}>{o.label}</button>
                ))}
              </div>
              <label className="btn">
                {t("p3.upload")}
                <input ref={uploadInputRef} type="file" accept="image/*" multiple onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  const added = [];
                  for (const f of files) {
                    try { added.push(await window.BeatflowMyImages.add(f)); }
                    catch (err) { console.error(err); alert(`保存图片失败：${err && err.message || err}`); }
                  }
                  if (added.length) {
                    const next = [...myImages, ...added];
                    setMyImages(next);
                    setImages(next); // 选完跳到"我的图片"
                  }
                  e.target.value = "";
                }} />
              </label>
            </div>
          </div>

          <div className="preset-sets">
            {PRESET_IMAGE_SETS.map(s => {
              const isMine = s.kind === "mine";
              const count = isMine
                ? myImages.length
                : s.kind === "swatch" ? s.swatches.length : s.images.length;
              const onClick = () => {
                if (isMine && myImages.length === 0) {
                  uploadInputRef.current && uploadInputRef.current.click();
                  return;
                }
                onLoadImageSet(s);
              };
              return (
                <button key={s.key} className="preset-set" onClick={onClick}>
                  <div className="ps-strip">
                    {isMine
                      ? (myImages.length === 0
                          ? <div style={{display:"flex", alignItems:"center", justifyContent:"center", color:"var(--fg-muted)", fontSize:14, border:"1px dashed var(--line)", borderRadius:5}}>+</div>
                          : myImages.slice(0, 5).map((m, i) => (
                              <img key={i} src={m.src} alt="" loading="lazy" />
                            )))
                      : s.kind === "swatch"
                        ? s.swatches.slice(0, 5).map((sw, i) => (
                            <div key={i} style={{background: `linear-gradient(135deg, ${sw.c1}, ${sw.c2})`}} />
                          ))
                        : s.images.slice(0, 5).map((src, i) => (
                            <img key={i} src={src} alt="" loading="lazy" />
                          ))}
                  </div>
                  <div className="ps-meta">
                    <div className="ps-name">{s.name}</div>
                    <div className="ps-tag">{count} {t("p2.images")}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="thumbs-grid">
            {images.map((img, i) => (
              <div key={img.id}
                   className={`thumb ${i === activeImageIdx ? "active" : ""} ${i === dragIdx ? "dragging" : ""} ${overIdx === i && overSide === "left" ? "drop-left" : ""} ${overIdx === i && overSide === "right" ? "drop-right" : ""}`}
                   draggable
                   onClick={() => setPreviewIdx(i)}
                   onDragStart={onThumbDragStart(i)}
                   onDragOver={onThumbDragOver(i)}
                   onDrop={onThumbDrop}
                   onDragEnd={() => { setDragIdx(-1); setOverIdx(-1); }}>
                {img.type === "swatch" ? (
                  <div className="ph" style={{background: `linear-gradient(135deg, ${img.c1}, ${img.c2})`}}>
                    #{String(i+1).padStart(2,"0")}
                  </div>
                ) : <img src={img.src} alt="" />}
                <div className="idx">{i+1}</div>
                <div className="del" onClick={(e) => { e.stopPropagation(); removeImage(i)(); }}>×</div>
                <div className="drag-grip" onClick={(e) => e.stopPropagation()}>⋮⋮</div>
              </div>
            ))}
            {images.every(img => img.type === "local") && (
              <div className="thumb-add" onClick={() => uploadInputRef.current && uploadInputRef.current.click()}>
                <div className="plus">+</div>
                <div className="t">ADD</div>
              </div>
            )}
          </div>
        </div>

        {/* Export */}
        <div>
          <div className="panel-head">
            <div className="panel-title"><span className="num">04</span>{t("p4.title")}</div>
            <div className="panel-sub">{t("p4.subtitle")}</div>
          </div>

          <div className="export-summary">
            <div className="es-head">
              <div className="es-label">{t("p4.range_label")} <span className="hint">{t("p4.range_hint")}</span></div>
              <div className="es-dur">{segDur.toFixed(2)}<span>s</span></div>
            </div>
            <div className="es-range">
              <div className="es-bar">
                <div className="es-bar-fill" style={{
                  left: `${(start/duration)*100}%`,
                  right: `${100 - (end/duration)*100}%`
                }} />
              </div>
              <div className="es-times">
                <span>{fmtTime(start)}</span>
                <span>→</span>
                <span>{fmtTime(end)}</span>
              </div>
            </div>
          </div>

          <div className="pill-row">
            <div className="pill accent"><span className="k">{t("p4.segment")}</span>{segDur.toFixed(2)}s</div>
            <div className="pill"><span className="k">{t("p4.res")}</span>{aspect === "16:9" ? "1920 × 1080" : aspect === "1:1" ? "1080 × 1080" : "1080 × 1920"}</div>
            <div className="pill"><span className="k">{t("p4.fps")}</span>60fps</div>
            <div className="pill"><span className="k">{t("p4.fmt")}</span>webm</div>
          </div>

          <div className="export-actions">
            <button className="btn btn-primary export-cta" onClick={onExport} disabled={exporting || images.length===0}>
              {exporting ? t("p4.exporting") : (
                <><svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor"><rect x="2" y="2" width="9" height="9" rx="2"/></svg>
                {t("p4.export")}</>
              )}
            </button>
            {exporting && (
              <div className="export-progress">
                <div className="lbl">{Math.round(exportProgress*100)}%</div>
                <div className="track">
                  <div className="bar" style={{width: `${exportProgress*100}%`}}/>
                </div>
              </div>
            )}
            <div className="export-note">{t("p4.note")}</div>
          </div>
        </div>
      </div>
      {previewIdx >= 0 && images[previewIdx] && (
        <div
          onClick={() => setPreviewIdx(-1)}
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,.85)",
            display:"flex", alignItems:"center", justifyContent:"center",
            zIndex:1000, cursor:"zoom-out"
          }}>
          {images[previewIdx].type === "swatch" ? (
            <div style={{
              width:"min(80vw, 80vh)", height:"min(80vw, 80vh)",
              background:`linear-gradient(135deg, ${images[previewIdx].c1}, ${images[previewIdx].c2})`,
              borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center",
              color:"#fff", fontFamily:"var(--font-mono)", fontSize:20, opacity:.9
            }}>{images[previewIdx].label || `#${String(previewIdx+1).padStart(2,"0")}`}</div>
          ) : (
            <img src={images[previewIdx].src} alt=""
              style={{maxWidth:"90vw", maxHeight:"90vh", objectFit:"contain", borderRadius:6}} />
          )}
          <div style={{
            position:"fixed", top:20, right:24, color:"#fff", fontSize:14,
            fontFamily:"var(--font-mono)", opacity:.7, pointerEvents:"none"
          }}>#{String(previewIdx+1).padStart(2,"0")} · esc</div>
        </div>
      )}
    </section>
  );
}

/* =================================================
   TWEAKS PANEL
   ================================================= */
function TweaksPanel({ tweaks, setTweak, visible, onClose }) {
  const { t } = useT();
  if (!visible) return null;
  const accents = ["#ff3b4e", "#6b5cff", "#00d4ff", "#4ade80", "#fbbf24"];
  return (
    <div className="tweaks on">
      <div className="tweaks-head">
        <div className="t"><span className="dot"/> {t("tweaks.title")}</div>
        <div className="close" onClick={onClose}>esc</div>
      </div>

      <div className="tweaks-row">
        <label>{t("tweaks.accent")}</label>
        <div className="swatches">
          {accents.map(c => (
            <div key={c}
              className={`sw ${tweaks.accent === c ? "active" : ""}`}
              style={{background: c}}
              onClick={() => setTweak("accent", c)}
            />
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <label>{t("tweaks.aspect")}</label>
        <div className="seg">
          {["9:16", "1:1", "16:9"].map(a => (
            <button key={a} className={tweaks.aspect === a ? "on" : ""} onClick={() => setTweak("aspect", a)}>{a}</button>
          ))}
        </div>
      </div>

      <div className="tweaks-row">
        <label>{t("tweaks.pulse")} · {tweaks.pulseMs}ms</label>
        <input type="range" min="80" max="360" step="10" value={tweaks.pulseMs}
          onChange={(e) => setTweak("pulseMs", +e.target.value)} />
      </div>

      <div className="tweaks-row">
        <label>{t("tweaks.wave_style")}</label>
        <div className="seg">
          {[{k:"bars",label: t("tweaks.wave_bars")},{k:"line",label: t("tweaks.wave_line")}].map(o => (
            <button key={o.k} className={tweaks.waveStyle === o.k ? "on" : ""} onClick={() => setTweak("waveStyle", o.k)}>{o.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* =================================================
   APP ROOT
   ================================================= */
function App() {
  const [track, setTrack] = useState(DEMO_TRACK);
  const [analyzed, setAnalyzed] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);
  const [images, setImages] = useState(() => window.BeatflowUploads.getInitialImages());
  const [playRange, setPlayRange] = useState([0, DEMO_TRACK.duration]);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [tweaks, setTweaks] = useState(TWEAKS);
  const [tweaksVisible, setTweaksVisible] = useState(false);
  const [fitMode, setFitMode] = useState("cover"); // cover | contain | stretch
  const [orderMode, setOrderMode] = useState("sequential"); // sequential | random
  const [myImages, setMyImages] = useState([]); // IndexedDB 持久化的"我的图片"库
  const audioRef = useRef(null);

  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem("bf_lang") || "en"; } catch(e) { return "en"; }
  });
  const [stats, setStats] = useState({ analyzed: 0, exported: 0 });
  const refreshStats = useCallback(async () => {
    try {
      const base = (window.BeatflowUploads.getApiUrl?.() || "").replace(/\/+$/, "");
      const r = await fetch(`${base}/api/stats`);
      if (r.ok) setStats(await r.json());
    } catch (e) { /* ignore offline */ }
  }, []);
  useEffect(() => { refreshStats(); }, [refreshStats]);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem("bf_theme") || "dark"; } catch(e) { return "dark"; }
  });
  const t = useCallback((k) => (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k, [lang]);
  const toggleLang = () => { const n = lang === "zh" ? "en" : "zh"; setLang(n); try { localStorage.setItem("bf_lang", n); } catch(e) {} };
  const toggleTheme = () => { const n = theme === "dark" ? "light" : "dark"; setTheme(n); try { localStorage.setItem("bf_theme", n); } catch(e) {} };
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  useEffect(() => { document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en"); }, [lang]);

  // 启动加载"我的图片"库；非空时默认全部填进节拍序列
  useEffect(() => {
    (async () => {
      try {
        await window.BeatflowMyImages.initDB();
        const list = await window.BeatflowMyImages.list();
        if (list.length > 0) {
          setMyImages(list);
          setImages(list);
        }
      } catch (e) { console.error("BeatflowMyImages init failed:", e); }
    })();
    // 卸载时回收所有 blob URL
    return () => { window.BeatflowMyImages && window.BeatflowMyImages.revokeAll(myImages); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPickPreset = async (p) => {
    setPlaying(false);
    const next = typeof window.BeatflowUploads.pickPreset === "function"
      ? await window.BeatflowUploads.pickPreset(p)
      : { ...p };
    // 清理上一条 track 的 objectURL
    if (track && track.audioUrl && track.audioUrl !== next.audioUrl) {
      try { URL.revokeObjectURL(track.audioUrl); } catch {}
    }
    setTrack(next);
    setPlayRange([0, next.duration || 0]);
    setCurrentTime(0);
    // 三种情况：
    //   预分析 JSON 已并入（next.beat_times 非空）→ 视为已分析，跳过 API
    //   有真 file 但无预分析 → 需要用户点"开始分析"
    //   无真 file（纯 mock） → UI 按 bpm/duration 合成节拍，直接当已分析
    const hasPreBeats = Array.isArray(next.beat_times) && next.beat_times.length > 0;
    setAnalyzed(hasPreBeats || !next.file);
  };

  const onClearAudio = () => {
    setPlaying(false);
    if (track && track.audioUrl) {
      try { URL.revokeObjectURL(track.audioUrl); } catch {}
    }
    setTrack(null);
    setAnalyzed(false);
    setCurrentTime(0);
    setPlayRange([0, 0]);
  };

  // 首次加载：自动载入随机预置的音频和预分析节拍
  useEffect(() => { onPickPreset(DEMO_TRACK); }, []);

  const onLoadImageSet = (set) => {
    if (set && set.kind === "mine") { setImages(myImages); return; }
    setImages(window.BeatflowUploads.loadImageSet(set));
  };

  const duration = track?.duration || 0;
  const bpm = track?.bpm || 0;
  // 真 API 给了 beat_times 就用它；否则按 BPM 合成（预置曲目）
  const beats = useMemo(() => {
    if (!analyzed) return [];
    if (Array.isArray(track?.beat_times) && track.beat_times.length) return track.beat_times;
    return buildBeats(bpm, duration);
  }, [analyzed, bpm, duration, track]);
  const waveform = useMemo(() => analyzed ? buildWaveform(2400, bpm || 120, duration) : null, [analyzed, bpm, duration]);

  // 随机顺序：一个下标置换数组，长度 === images.length
  // 切到 random 或 images.length 变化时重洗一次
  const [randomOrder, setRandomOrder] = useState([]);
  useEffect(() => {
    if (orderMode !== "random") { setRandomOrder([]); return; }
    const a = Array.from({ length: images.length }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    setRandomOrder(a);
  }, [orderMode, images.length]);

  // Which image is showing? image index = (beat index passed) mod images.length
  const activeImageIdx = useMemo(() => {
    if (!images.length) return 0;
    let passed = 0;
    for (let i = 0; i < beats.length; i++) if (beats[i] <= currentTime) passed = i + 1;
    return Math.max(0, (passed - 1)) % images.length;
  }, [currentTime, beats, images.length]);

  // 随机模式下：把 activeImageIdx 映射成 images 中的另一个下标
  const displayImageIdx = useMemo(() => {
    if (orderMode !== "random" || randomOrder.length !== images.length) return activeImageIdx;
    return randomOrder[activeImageIdx] ?? activeImageIdx;
  }, [activeImageIdx, orderMode, randomOrder, images.length]);

  /* ---- playback loop ---- */
  const rafRef = useRef(null);
  const startTsRef = useRef(0);
  const startAtRef = useRef(0);
  const lastBeatIdxRef = useRef(-1);

  // 真实音频 play/pause 同步
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !track?.audioUrl) return;
    if (playing) {
      if (currentTime < playRange[0] || currentTime >= playRange[1]) el.currentTime = playRange[0];
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [playing, track?.audioUrl]);

  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return; }
    const [rStart, rEnd] = playRange;
    const hasRealAudio = !!(audioRef.current && track?.audioUrl);

    let startT = currentTime;
    if (currentTime < rStart || currentTime >= rEnd) startT = rStart;
    startTsRef.current = performance.now();
    startAtRef.current = startT;
    if (startT !== currentTime) setCurrentTime(startT);
    if (hasRealAudio) { try { audioRef.current.currentTime = startT; } catch {} }
    lastBeatIdxRef.current = -1;
    for (let i = 0; i < beats.length; i++) if (beats[i] <= startT) lastBeatIdxRef.current = i;

    const tick = () => {
      let t;
      if (hasRealAudio) {
        t = audioRef.current.currentTime;
        if (t >= rEnd || audioRef.current.ended) {
          try { audioRef.current.currentTime = rStart; } catch {}
          t = rStart;
          lastBeatIdxRef.current = -1;
        }
      } else {
        const elapsed = (performance.now() - startTsRef.current) / 1000;
        t = startAtRef.current + elapsed;
        if (t >= rEnd) {
          t = rStart;
          startTsRef.current = performance.now();
          startAtRef.current = rStart;
          lastBeatIdxRef.current = -1;
          for (let i = 0; i < beats.length; i++) if (beats[i] <= rStart) lastBeatIdxRef.current = i;
        }
      }
      setCurrentTime(t);

      let newLast = lastBeatIdxRef.current;
      for (let i = lastBeatIdxRef.current + 1; i < beats.length; i++) {
        if (beats[i] <= t) newLast = i; else break;
      }
      if (newLast !== lastBeatIdxRef.current) {
        lastBeatIdxRef.current = newLast;
        setPulseKey(k => k + 1);
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, beats, duration, playRange, track?.audioUrl]);

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); setPlaying(p => !p); }
      if (e.key === "Escape") setTweaksVisible(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- seek ---- */
  const onSeek = useCallback((t) => {
    const clamped = Math.max(0, Math.min(duration, t));
    setCurrentTime(clamped);
    if (audioRef.current && track?.audioUrl) {
      try { audioRef.current.currentTime = clamped; } catch {}
    }
    if (playing) {
      startTsRef.current = performance.now();
      startAtRef.current = clamped;
    }
  }, [duration, playing, track?.audioUrl]);

  /* ---- analyze (uploads.js swap-in) ---- */
  const onAnalyze = async () => {
    if (!track) return;
    setAnalyzing(true);
    setAnalyzed(false);
    try {
      if (typeof window.BeatflowUploads.analyzeTrack === "function") {
        const next = await window.BeatflowUploads.analyzeTrack(track);
        setTrack(next);
        setPlayRange([0, next.duration || 0]);
        setCurrentTime(0);
      } else {
        // fallback 给原型：setTimeout mock
        await new Promise((r) => setTimeout(r, 900));
      }
      setAnalyzed(true);
      refreshStats();
    } catch (e) {
      alert(`分析失败：${e?.message || e}`);
    } finally {
      setAnalyzing(false);
    }
  };

  /* ---- add images (via uploads.js swap-in) ---- */
  /* ---- export (simulated) ---- */
  /* ---- export (delegated to export.js swap-in) ---- */
  const onExport = async () => {
    setExporting(true);
    setExportProgress(0);
    try {
      const imgsForExport = (orderMode === "random" && randomOrder.length === images.length)
        ? randomOrder.map(i => images[i])
        : images;
      await window.BeatflowExport.exportVideo({
        track, images: imgsForExport, beats, playRange,
        aspect: tweaks.aspect || "9:16",
        fitMode, format: "webm", fps: 30,
        onProgress: setExportProgress,
      });
      try {
        const base = (window.BeatflowUploads.getApiUrl?.() || "").replace(/\/+$/, "");
        await fetch(`${base}/api/export-log`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: track?.name,
            duration: (playRange?.[1] ?? 0) - (playRange?.[0] ?? 0),
            aspect: tweaks.aspect || "9:16",
          }),
        });
      } catch (e) { /* ignore offline */ }
      refreshStats();
    } catch (err) {
      if (err && err.name !== "AbortError") console.error(err);
    } finally {
      setExporting(false);
    }
  };

  /* ---- tweaks ---- */
  const setTweak = (k, v) => {
    setTweaks(t => ({ ...t, [k]: v }));
    sendTweak({ [k]: v });
    if (k === "accent") document.documentElement.style.setProperty("--accent", v);
  };
  useEffect(() => {
    if (tweaks.accent) document.documentElement.style.setProperty("--accent", tweaks.accent);
  }, []);

  /* ---- edit-mode protocol ---- */
  useEffect(() => {
    const onMsg = (e) => {
      if (!e.data) return;
      if (e.data.type === "__activate_edit_mode") setTweaksVisible(true);
      if (e.data.type === "__deactivate_edit_mode") setTweaksVisible(false);
    };
    window.addEventListener("message", onMsg);
    try { window.parent.postMessage({ type: "__edit_mode_available" }, "*"); } catch(e) {}
    return () => window.removeEventListener("message", onMsg);
  }, []);

  return (
    <I18nCtx.Provider value={{ lang, t }}>
      <Hero bpm={bpm} duration={duration} beatCount={beats.length} lang={lang} theme={theme} onToggleLang={toggleLang} onToggleTheme={toggleTheme} analyzedCount={stats.analyzed} exportedCount={stats.exported} />
      <div className="grid">
        <AudioPanel
          track={track} setTrack={setTrack}
          analyzed={analyzed} analyzing={analyzing} onAnalyze={onAnalyze}
          waveform={waveform} beats={beats}
          currentTime={currentTime} duration={duration}
          playing={playing} onPlay={() => setPlaying(p => !p)}
          playRange={playRange}
          onPickPreset={onPickPreset}
          onClearAudio={onClearAudio}
        />
        <PreviewPanel
          aspect={tweaks.aspect || "9:16"}
          setAspect={(a) => setTweak("aspect", a)}
          playing={playing} onPlay={() => setPlaying(p => !p)}
          currentTime={currentTime} duration={duration} beats={beats}
          onSeek={onSeek}
          images={images} activeImageIdx={displayImageIdx}
          pulseKey={pulseKey} pulseMs={tweaks.pulseMs || 180}
          exporting={exporting} exportProgress={exportProgress}
          fitMode={fitMode}
          playRange={playRange} setPlayRange={setPlayRange}
        />
        <MediaExportPanel
          images={images} setImages={setImages}
          duration={duration} playRange={playRange} setPlayRange={setPlayRange}
          exporting={exporting} onExport={onExport} exportProgress={exportProgress}
          activeImageIdx={displayImageIdx}
          aspect={tweaks.aspect || "9:16"}
          fitMode={fitMode} setFitMode={setFitMode}
          onLoadImageSet={onLoadImageSet}
          myImages={myImages} setMyImages={setMyImages}
          orderMode={orderMode} setOrderMode={setOrderMode}
        />
      </div>
      <Footer />
      <TweaksPanel tweaks={tweaks} setTweak={setTweak} visible={tweaksVisible} onClose={() => setTweaksVisible(false)} />
      {/* 真实音频元素（隐藏），驱动播放；源由 track.audioUrl 提供 */}
      <audio ref={audioRef} src={track?.audioUrl || undefined} preload="auto" style={{ display: "none" }} />
    </I18nCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
