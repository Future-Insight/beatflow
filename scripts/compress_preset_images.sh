#!/usr/bin/env bash
# 压缩 frontend/presets/images/**/*.jpg
#
# 用法：
#   ./scripts/compress_preset_images.sh              默认 Q=4 MAX_W=1080
#   Q=6 ./scripts/compress_preset_images.sh          更激进（更小但画质下降）
#   MAX_W=720 ./scripts/compress_preset_images.sh    缩得更小
#   RESTORE=1 ./scripts/compress_preset_images.sh    从 .bak 恢复
#
# Q:     ffmpeg -q:v，2=近无损，4≈75%，6≈65%（数字越大越小越糊）
# MAX_W: 宽度上限，不放大小图，只缩大图

set -euo pipefail
cd "$(dirname "$0")/.."

IMG_ROOT="frontend/presets/images"
BAK_ROOT="$IMG_ROOT/.bak"
Q="${Q:-4}"
MAX_W="${MAX_W:-1080}"
RESTORE="${RESTORE:-0}"

command -v ffmpeg >/dev/null || { echo "缺少 ffmpeg" >&2; exit 1; }
[ -d "$IMG_ROOT" ] || { echo "找不到 $IMG_ROOT" >&2; exit 1; }

if [ "$RESTORE" = "1" ]; then
  [ -d "$BAK_ROOT" ] || { echo "没有 $BAK_ROOT，无需恢复" >&2; exit 0; }
  echo "[恢复] 从 $BAK_ROOT 覆盖 $IMG_ROOT/"
  (cd "$BAK_ROOT" && find . -name '*.jpg' -print | while read -r f; do
    mkdir -p "$(dirname "../${f#./}")"
    cp -f "$f" "../${f#./}"
  done)
  echo "[恢复] 完成"
  exit 0
fi

total_before=0
total_after=0
count=0

find "$IMG_ROOT" -path "$BAK_ROOT" -prune -o -name '*.jpg' -print | while read -r src; do
  rel="${src#$IMG_ROOT/}"
  bak="$BAK_ROOT/$rel"
  mkdir -p "$(dirname "$bak")"
  [ -f "$bak" ] || cp -f "$src" "$bak"

  before=$(stat -c%s "$src")
  tmp="${src%.jpg}.tmp.jpg"

  # scale='min(MAX_W,iw)':-2  → 只缩不放大，高度按比例（-2 保持 2 的倍数）
  ffmpeg -hide_banner -loglevel error -y \
    -i "$bak" \
    -vf "scale='min(${MAX_W},iw)':-2" \
    -q:v "$Q" \
    -map_metadata -1 \
    "$tmp"

  mv -f "$tmp" "$src"
  after=$(stat -c%s "$src")
  pct=$(awk -v b="$before" -v a="$after" 'BEGIN{printf "%.0f%%", (1-a/b)*100}')
  printf "  %-45s  %7d → %7d B  (-%s)\n" "$rel" "$before" "$after" "$pct"
done

echo "[完成] 备份在 $BAK_ROOT/，需还原用 RESTORE=1 $0"
du -sh "$IMG_ROOT" --exclude=".bak"
