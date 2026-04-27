import pytest
import requests
import responses
from jamendo_client import search_popular, JamendoError


@responses.activate
def test_search_popular_happy_path():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "code": 0, "results_count": 1},
            "results": [{
                "id": "1781603",
                "name": "Epic Cinematic",
                "artist_name": "TestArtist",
                "duration": 142,
                "album_image": "https://cdn/cover.jpg",
                "audio": "https://cdn/preview.mp3",
                "audiodownload": "https://cdn/full.mp3",
                "license_ccurl": "http://creativecommons.org/licenses/by-nc-sa/3.0/",
                "musicinfo": {"tags": {"genres": ["epic", "cinematic"], "vartags": ["trailer"]}},
            }],
        },
        status=200,
    )
    result = search_popular(client_id="x", limit=10)
    assert result["total"] == 1
    track = result["tracks"][0]
    assert track["id"] == "1781603"
    assert track["title"] == "Epic Cinematic"
    assert track["artist"] == "TestArtist"
    assert track["duration"] == 142
    assert track["cover_url"] == "https://cdn/cover.jpg"
    assert track["license"] == "by-nc-sa"
    assert set(track["tags"]) == {"epic", "cinematic", "trailer"}
    assert "audio" not in track  # 安全：不能泄露 mp3 URL
    assert "audiodownload" not in track


@responses.activate
def test_search_popular_invalid_client_id():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "failed", "code": 5,
                        "error_message": "Invalid Client Id"},
            "results": [],
        },
        status=200,
    )
    with pytest.raises(JamendoError, match="Invalid Client Id"):
        search_popular(client_id="bad")


@responses.activate
def test_search_popular_network_error():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        body=requests.ConnectionError("dns fail"),
    )
    with pytest.raises(JamendoError, match="网络错误"):
        search_popular(client_id="x")


@responses.activate
def test_search_popular_with_genre():
    captured = {}

    def callback(request):
        from urllib.parse import urlparse, parse_qs
        captured["params"] = parse_qs(urlparse(request.url).query)
        return (200, {}, '{"headers":{"status":"success","results_count":0},"results":[]}')

    responses.add_callback(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        callback=callback,
    )
    search_popular(client_id="x", genre="ambient", limit=20)
    assert captured["params"]["tags"] == ["ambient"]
    assert captured["params"]["limit"] == ["20"]


def test_parse_license_known():
    from jamendo_client import _parse_license
    assert _parse_license("http://creativecommons.org/licenses/by-nc-sa/3.0/") == "by-nc-sa"
    assert _parse_license("http://creativecommons.org/licenses/by/4.0/") == "by"
    assert _parse_license("") == "unknown"
    assert _parse_license("http://example.com/") == "unknown"


from jamendo_client import get_track_url


@responses.activate
def test_get_track_url_for_streaming():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 1},
            "results": [{
                "id": "999", "audio": "https://cdn/preview.mp3",
                "audiodownload": "https://cdn/full.mp3",
                "name": "X",
            }],
        },
        status=200,
    )
    # 默认（试听场景）：拿 audio
    assert get_track_url(client_id="x", track_id="999") == "https://cdn/preview.mp3"


@responses.activate
def test_get_track_url_for_download():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 1},
            "results": [{
                "id": "999", "audio": "https://cdn/preview.mp3",
                "audiodownload": "https://cdn/full.mp3",
                "name": "X",
            }],
        },
        status=200,
    )
    # prefer_download=True：拿 audiodownload
    assert get_track_url(client_id="x", track_id="999", prefer_download=True) \
        == "https://cdn/full.mp3"


@responses.activate
def test_get_track_url_download_falls_back_to_audio():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 1},
            "results": [{
                "id": "999", "audio": "https://cdn/preview.mp3",
                # 无 audiodownload
                "name": "X",
            }],
        },
        status=200,
    )
    assert get_track_url(client_id="x", track_id="999", prefer_download=True) \
        == "https://cdn/preview.mp3"


@responses.activate
def test_get_track_url_not_found():
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 0},
            "results": [],
        },
        status=200,
    )
    with pytest.raises(JamendoError, match="未找到"):
        get_track_url(client_id="x", track_id="missing")


@responses.activate
def test_get_track_url_with_title():
    """get_track_meta 同时返回 url 与 title（用于 fetch 的 Content-Disposition）"""
    from jamendo_client import get_track_meta
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 1},
            "results": [{
                "id": "999", "audio": "https://cdn/preview.mp3",
                "audiodownload": "https://cdn/full.mp3",
                "name": "Cool Track",
            }],
        },
        status=200,
    )
    meta = get_track_meta(client_id="x", track_id="999", prefer_download=True)
    assert meta["url"] == "https://cdn/full.mp3"
    assert meta["title"] == "Cool Track"


@responses.activate
def test_get_track_url_no_audio_url():
    """results 非空但 audio/audiodownload 都缺失 → 抛 JamendoError"""
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 1},
            "results": [{"id": "999", "name": "X"}],  # 无 audio / audiodownload
        },
        status=200,
    )
    with pytest.raises(JamendoError, match="无可用 mp3 URL"):
        get_track_url(client_id="x", track_id="999")
