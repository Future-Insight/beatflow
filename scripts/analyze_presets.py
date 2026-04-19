"""
离线为 frontend/presets/*.mp3 生成节拍分析 JSON，
文件输出到同名 ".beats.json"（与原音频放一起，方便静态托管）。

用法：
    cd v-autoflow-web
    ./api/venv/bin/python scripts/analyze_presets.py
    # 或指定自定义方法 / 间隔：
    METHOD=beat MIN_INTERVAL=0.3 ./api/venv/bin/python scripts/analyze_presets.py

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


def main():
    preset_dir = ROOT / "frontend" / "presets"
    method = os.environ.get("METHOD", "beat")
    min_interval = float(os.environ.get("MIN_INTERVAL", "0.3"))
    force = os.environ.get("FORCE", "") == "1"

    mp3s = sorted(glob.glob(str(preset_dir / "*.mp3")))
    if not mp3s:
        print(f"[!] 未找到音频：{preset_dir}")
        return

    for mp3 in mp3s:
        out = mp3 + ".beats.json"
        if os.path.exists(out) and not force:
            print(f"[skip] {os.path.basename(mp3)} → 已存在 .beats.json (FORCE=1 覆盖)")
            continue

        print(f"[…] 分析 {os.path.basename(mp3)} (method={method}, min_interval={min_interval})")
        r = analyze_beats(mp3, min_interval=min_interval, method=method)

        # 只保留前端真正用到的字段，保持 JSON 小
        payload = {
            "beat_times": r["beat_times"],
            "tempo": r["tempo"],
            "duration": r["duration"],
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
