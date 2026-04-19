"""
离线为 frontend/presets/*.mp3 生成节拍分析 JSON，
文件输出到同名 ".beats.json"（与原音频放一起，方便静态托管）。

每首曲目使用其"推荐检测方法"（与 frontend/uploads.js 的 PRESET_TRACKS
里的 method 字段保持一致）：
  - AMBIENT/氛围类    → onset（能量突变，更适合无强鼓点）
  - 其它（流行/舞曲） → beat （强拍定位）

用法：
    cd v-autoflow-web
    ./api/venv/bin/python scripts/analyze_presets.py
    # 覆盖已存在 JSON：
    FORCE=1 ./api/venv/bin/python scripts/analyze_presets.py
    # 未在下方 PRESET_METHODS 列出的 mp3 使用默认方法：
    DEFAULT_METHOD=beat MIN_INTERVAL=0.3 ./api/venv/bin/python scripts/analyze_presets.py

依赖：api 的 venv（含 librosa 等）。
"""

import glob
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "api"))

from lib import analyze_beats  # noqa: E402  (sys.path 注入后才能 import)


# 文件名 → 推荐检测方法。与 frontend/uploads.js 的 PRESET_TRACKS.method 对齐。
PRESET_METHODS = {
    "harumachimusic-morning-calm-236192.mp3": "onset",
    "leberch-christmas-440431.mp3": "beat",
    "tunetank-samba-348218.mp3": "beat",
}


def main():
    preset_dir = ROOT / "frontend" / "presets"
    default_method = os.environ.get("DEFAULT_METHOD", "beat")
    min_interval = float(os.environ.get("MIN_INTERVAL", "0.3"))
    force = os.environ.get("FORCE", "") == "1"

    mp3s = sorted(glob.glob(str(preset_dir / "*.mp3")))
    if not mp3s:
        print(f"[!] 未找到音频：{preset_dir}")
        return

    for mp3 in mp3s:
        out = mp3 + ".beats.json"
        basename = os.path.basename(mp3)
        method = PRESET_METHODS.get(basename, default_method)

        if os.path.exists(out) and not force:
            print(f"[skip] {basename} → 已存在 .beats.json (FORCE=1 覆盖)")
            continue

        print(f"[…] 分析 {basename} (method={method}, min_interval={min_interval})")
        r = analyze_beats(mp3, min_interval=min_interval, method=method)

        payload = {
            "beat_times": r["beat_times"],
            "tempo": r["tempo"],
            "duration": r["duration"],
            "method": method,
        }
        with open(out, "w") as f:
            json.dump(payload, f, separators=(",", ":"))

        print(
            f"    → {os.path.basename(out)} "
            f"({len(payload['beat_times'])} beats, "
            f"{payload['duration']:.2f}s, "
            f"{payload['tempo']:.1f} BPM)"
        )


if __name__ == "__main__":
    main()
