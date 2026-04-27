"""Phase 0 探测脚本：实证 Jamendo API 字段、流派过滤、CDN 可用性。

自动加载同级 ../.env 中的 JAMENDO_CLIENT_ID（v-autoflow-web/api/.env）。
"""
import os
import sys
import json
from pathlib import Path

import requests


def _load_env():
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_load_env()

CLIENT_ID = os.environ.get("JAMENDO_CLIENT_ID")
if not CLIENT_ID:
    sys.exit("ERROR: JAMENDO_CLIENT_ID 未设置（既不在环境变量也不在 ../api/.env）")

BASE = "https://api.jamendo.com/v3.0"


def probe_popular():
    """0.3：基础热门列表 + 字段结构验证"""
    print("\n=== 0.3 popularity_total + 字段结构 ===")
    r = requests.get(f"{BASE}/tracks/", params={
        "client_id": CLIENT_ID,
        "format": "json",
        "order": "popularity_total",
        "limit": 3,
        "audioformat": "mp32",
        "include": "musicinfo licenses",
    }, timeout=10)
    print(f"HTTP {r.status_code}")
    data = r.json()
    print(f"status: {data['headers']['status']}")
    if data["headers"]["status"] != "success":
        print(f"FAILED: {data['headers']}")
        return False
    print(f"results_count: {data['headers']['results_count']}")
    for i, t in enumerate(data["results"][:3]):
        print(f"\n  [{i}] id={t.get('id')} name={t.get('name')!r}")
        print(f"      artist_name={t.get('artist_name')!r} duration={t.get('duration')}")
        print(f"      audio={t.get('audio')!r}")
        print(f"      audiodownload={t.get('audiodownload')!r}")
        print(f"      album_image={t.get('album_image')!r}")
        print(f"      license_ccurl={t.get('license_ccurl')!r}")
        mi = t.get("musicinfo", {})
        print(f"      musicinfo.tags={mi.get('tags')!r}")
    return True


def probe_genre():
    """0.4：tags 流派过滤验证"""
    print("\n=== 0.4 tags=ambient 过滤 ===")
    r = requests.get(f"{BASE}/tracks/", params={
        "client_id": CLIENT_ID,
        "format": "json",
        "order": "popularity_total",
        "limit": 3,
        "tags": "ambient",
        "include": "musicinfo",
    }, timeout=10)
    data = r.json()
    if data["headers"]["status"] != "success":
        print(f"FAILED: {data['headers']}")
        return False
    print(f"results_count: {data['headers']['results_count']}")
    for t in data["results"][:3]:
        tags = t.get("musicinfo", {}).get("tags", {}).get("genres", [])
        print(f"  {t.get('name')!r} → genres={tags}")
    return True


def probe_cdn():
    """0.5：CDN HEAD + Range 支持"""
    print("\n=== 0.5 CDN HEAD + Range 支持 ===")
    r = requests.get(f"{BASE}/tracks/", params={
        "client_id": CLIENT_ID, "format": "json", "limit": 1,
        "order": "popularity_total",
    }, timeout=10)
    data = r.json()
    if not data["results"]:
        print("FAILED: 无曲目")
        return False
    audio_url = data["results"][0].get("audio")
    print(f"试探试听 URL: {audio_url}")
    head = requests.head(audio_url, allow_redirects=True, timeout=10)
    print(f"HEAD {head.status_code} headers={dict(head.headers)}")
    rng = requests.get(audio_url, headers={"Range": "bytes=0-1023"}, timeout=10)
    print(f"Range bytes=0-1023 → HTTP {rng.status_code}, size={len(rng.content)}, "
          f"Content-Range={rng.headers.get('Content-Range')!r}")
    return rng.status_code in (200, 206)


if __name__ == "__main__":
    ok = all([probe_popular(), probe_genre(), probe_cdn()])
    sys.exit(0 if ok else 1)
