"""Jamendo API client（纯函数式，无 Flask 依赖）。

设计原则：
- 不暴露 mp3 URL 给调用方；URL 仅用于内部 stream/fetch
- 错误统一抛 JamendoError，由路由层翻译为 HTTP 响应
- 所有 HTTP 调用都带超时
"""
import logging
import requests

log = logging.getLogger(__name__)

BASE = "https://api.jamendo.com/v3.0"
DEFAULT_TIMEOUT = 15


class JamendoError(Exception):
    """Jamendo API 调用失败（client_id 无效、上游 5xx、上游错误码等）。"""


def _parse_license(ccurl: str) -> str:
    """从 license_ccurl 提取协议短名。
    例：'http://creativecommons.org/licenses/by-nc-sa/3.0/' → 'by-nc-sa'
    """
    if not ccurl:
        return "unknown"
    for part in ccurl.rstrip("/").split("/"):
        if part.startswith("by"):
            return part
    return "unknown"


def _map_track(raw: dict) -> dict:
    """Jamendo 原始字段 → 我们的对外格式（不含 mp3 URL）。"""
    mi = raw.get("musicinfo", {}) or {}
    tags_obj = mi.get("tags", {}) or {}
    tags = list({*(tags_obj.get("genres") or []), *(tags_obj.get("vartags") or [])})
    return {
        "id": str(raw.get("id", "")),
        "title": raw.get("name", "") or "",
        "artist": raw.get("artist_name", "") or "",
        "duration": int(raw.get("duration") or 0),
        "cover_url": raw.get("album_image", "") or "",
        "license": _parse_license(raw.get("license_ccurl", "")),
        "tags": tags,
    }


def search_popular(*, client_id: str, genre: str | None = None, limit: int = 30) -> dict:
    """获取热门曲目列表（按 popularity_total 排序）。

    Args:
        client_id: Jamendo client_id
        genre: 流派 tag（如 "ambient"）；None = 不过滤
        limit: 1-100

    Returns:
        {"tracks": [{id, title, artist, duration, cover_url, license, tags}], "total": int}

    Raises:
        JamendoError: 上游错误
    """
    params = {
        "client_id": client_id,
        "format": "json",
        "order": "popularity_total",
        "limit": max(1, min(100, int(limit))),
        "audioformat": "mp32",
        "include": "musicinfo licenses",
    }
    if genre:
        params["tags"] = genre
    try:
        r = requests.get(f"{BASE}/tracks/", params=params, timeout=DEFAULT_TIMEOUT)
        r.raise_for_status()
    except requests.RequestException as e:
        raise JamendoError(f"Jamendo 网络错误: {e}") from e
    data = r.json()
    headers = data.get("headers", {})
    if headers.get("status") != "success":
        raise JamendoError(headers.get("error_message", "Jamendo 上游失败"))
    tracks = [_map_track(t) for t in data.get("results", [])]
    return {"tracks": tracks, "total": headers.get("results_count", len(tracks))}
