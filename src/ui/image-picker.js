function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function readImageFiles(inputEl) {
  const files = inputEl?.files ? Array.from(inputEl.files) : [];
  return files.filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/"));
}

let _sortable = null;

// onReorder(newOrder: File[]) 在拖拽完成后回调，newOrder 是重新排序后的文件数组
export function renderImagesGrid(containerEl, imageFiles, onReorder) {
  clearChildren(containerEl);

  if (_sortable) {
    _sortable.destroy();
    _sortable = null;
  }

  const files = Array.isArray(imageFiles) ? imageFiles : [];
  if (files.length === 0) return;

  files.forEach((f, i) => {
    const card = document.createElement("div");
    card.className = "img-card";
    card.dataset.index = String(i);

    const img = document.createElement("img");
    img.alt = f.name || "image";
    img.loading = "lazy";
    img.src = URL.createObjectURL(f);
    img.addEventListener("load", () => {
      URL.revokeObjectURL(img.src);
    });

    const cap = document.createElement("div");
    cap.className = "cap";
    cap.textContent = f.name || "(未命名)";

    card.appendChild(img);
    card.appendChild(cap);
    containerEl.appendChild(card);
  });

  const Sortable = window.Sortable;
  if (Sortable && onReorder) {
    _sortable = Sortable.create(containerEl, {
      animation: 150,
      ghostClass: "img-card--ghost",
      onEnd() {
        const cards = Array.from(containerEl.querySelectorAll(".img-card"));
        const newOrder = cards.map((c) => files[Number(c.dataset.index)]);
        onReorder(newOrder);
      },
    });
  }
}
