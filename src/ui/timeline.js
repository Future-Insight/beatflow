function fmt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(3) : "";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderTimeline(containerEl, segmentsWithImages) {
  const segs = Array.isArray(segmentsWithImages) ? segmentsWithImages : [];
  if (segs.length === 0) {
    containerEl.innerHTML = "<div style=\"padding:10px;color:var(--muted)\">暂无时间线（先分析音频并选择图片）</div>";
    return;
  }

  const rows = segs
    .slice(0, 5000) // 简单上限，避免极端情况下渲染卡死
    .map((s) => {
      const name = s.image ? (s.image.name || "(未命名)") : "(无图片)";
      return (
        "<tr>" +
        `<td>${s.index}</td>` +
        `<td>${fmt(s.start)}</td>` +
        `<td>${fmt(s.end)}</td>` +
        `<td>${fmt(s.duration)}</td>` +
        `<td>${escapeHtml(name)}</td>` +
        "</tr>"
      );
    })
    .join("");

  containerEl.innerHTML =
    "<table>" +
    "<thead><tr><th>#</th><th>Start(s)</th><th>End(s)</th><th>Dur(s)</th><th>Image</th></tr></thead>" +
    `<tbody>${rows}</tbody>` +
    "</table>";
}

