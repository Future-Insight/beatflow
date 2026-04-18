function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function readImageFiles(inputEl) {
  const files = inputEl?.files ? Array.from(inputEl.files) : [];
  return files.filter((f) => f && typeof f.type === "string" && f.type.startsWith("image/"));
}

let _sortable = null;

// onReorder(newOrder: File[]) 在拖拽完成后回调
// onRemove(index: number) 点击 × 删除
export function renderImagesGrid(containerEl, imageFiles, onReorder, onRemove) {
  clearChildren(containerEl);

  if (_sortable) {
    _sortable.destroy();
    _sortable = null;
  }

  const files = Array.isArray(imageFiles) ? imageFiles : [];

  files.forEach((f, i) => {
    const card = document.createElement("div");
    card.className = "thumb";
    card.dataset.index = String(i);

    const img = document.createElement("img");
    img.alt = f.name || "image";
    img.loading = "lazy";
    img.src = URL.createObjectURL(f);
    img.addEventListener("load", () => URL.revokeObjectURL(img.src));
    card.appendChild(img);

    const idx = document.createElement("div");
    idx.className = "idx";
    idx.textContent = String(i + 1);
    card.appendChild(idx);

    if (onRemove) {
      const del = document.createElement("div");
      del.className = "del";
      del.textContent = "×";
      del.title = "删除";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onRemove(Number(card.dataset.index));
      });
      card.appendChild(del);
    }

    const grip = document.createElement("div");
    grip.className = "drag-grip";
    grip.textContent = "⋮⋮";
    card.appendChild(grip);

    containerEl.appendChild(card);
  });

  // 末尾 + 按钮（点击触发 image-files input）
  const add = document.createElement("div");
  add.className = "thumb-add";
  add.innerHTML = '<div class="plus">+</div><div class="t">ADD</div>';
  add.addEventListener("click", () => {
    const input = document.getElementById("image-files");
    if (input) input.click();
  });
  containerEl.appendChild(add);

  const Sortable = window.Sortable;
  if (Sortable && onReorder) {
    _sortable = Sortable.create(containerEl, {
      animation: 150,
      ghostClass: "dragging",
      draggable: ".thumb",
      filter: ".thumb-add",
      onEnd() {
        const cards = Array.from(containerEl.querySelectorAll(".thumb"));
        const newOrder = cards.map((c) => files[Number(c.dataset.index)]);
        onReorder(newOrder);
      },
    });
  }
}

// 只更新 .thumb.active 标记，不重新渲染（避免闪烁）
export function highlightActiveThumb(containerEl, activeIndex) {
  const cards = containerEl.querySelectorAll(".thumb");
  for (let i = 0; i < cards.length; i += 1) {
    cards[i].classList.toggle("active", i === activeIndex);
  }
}
