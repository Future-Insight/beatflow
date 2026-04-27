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
