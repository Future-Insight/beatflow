import pytest
import responses
from app import _create_app


ALLOWED_GENRES = {None, "ambient", "classical", "electronic", "hiphop", "jazz",
                  "lounge", "pop", "rock", "soundtrack", "world"}


@pytest.fixture
def client():
    app = _create_app()
    app.config["TESTING"] = True
    return app.test_client()


@responses.activate
def test_popular_returns_tracks(client):
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={
            "headers": {"status": "success", "results_count": 1},
            "results": [{
                "id": "1", "name": "T", "artist_name": "A", "duration": 100,
                "album_image": "https://cdn/c.jpg",
                "license_ccurl": "http://creativecommons.org/licenses/by/4.0/",
                "audio": "https://cdn/p.mp3",
                "audiodownload": "https://cdn/f.mp3",
                "musicinfo": {"tags": {"genres": ["pop"]}},
            }],
        },
        status=200,
    )
    resp = client.get("/api/jamendo/popular")
    assert resp.status_code == 200
    body = resp.get_json()
    assert len(body["tracks"]) == 1
    assert body["tracks"][0]["title"] == "T"
    assert "audio" not in body["tracks"][0]


def test_popular_invalid_genre_400(client):
    resp = client.get("/api/jamendo/popular?genre=notarealgenre")
    assert resp.status_code == 400


def test_popular_no_client_id_503(client, monkeypatch):
    monkeypatch.delenv("JAMENDO_CLIENT_ID", raising=False)
    resp = client.get("/api/jamendo/popular")
    assert resp.status_code == 503
    assert "Jamendo" in resp.get_json()["error"]


@responses.activate
def test_popular_upstream_failure_503(client):
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "failed", "error_message": "Quota exceeded"},
              "results": []},
        status=200,
    )
    resp = client.get("/api/jamendo/popular")
    assert resp.status_code == 503
    assert "Quota" in resp.get_json()["error"]


@responses.activate
def test_stream_proxies_full(client):
    # 1) get_track_meta 调用
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 1},
              "results": [{"id": "1", "audio": "https://cdn/preview.mp3", "name": "X"}]},
        status=200,
    )
    # 2) CDN 直接拉
    responses.add(
        responses.GET, "https://cdn/preview.mp3",
        body=b"FAKEAUDIO", status=200,
        content_type="audio/mpeg",
    )
    resp = client.get("/api/jamendo/stream?track_id=1")
    assert resp.status_code == 200
    assert resp.mimetype == "audio/mpeg"
    assert resp.data == b"FAKEAUDIO"


@responses.activate
def test_stream_passes_range_header(client):
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 1},
              "results": [{"id": "1", "audio": "https://cdn/preview.mp3", "name": "X"}]},
        status=200,
    )

    captured = {}

    def cdn_callback(request):
        captured["range"] = request.headers.get("Range")
        return (206, {"Content-Range": "bytes 0-1023/100000",
                      "Content-Type": "audio/mpeg"},
                b"PARTIAL")

    responses.add_callback(
        responses.GET, "https://cdn/preview.mp3", callback=cdn_callback,
    )
    resp = client.get("/api/jamendo/stream?track_id=1",
                      headers={"Range": "bytes=0-1023"})
    assert resp.status_code == 206
    assert resp.headers.get("Content-Range") == "bytes 0-1023/100000"
    assert captured["range"] == "bytes=0-1023"


def test_stream_missing_track_id_400(client):
    resp = client.get("/api/jamendo/stream")
    assert resp.status_code == 400


@responses.activate
def test_stream_track_not_found_404(client):
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 0}, "results": []},
        status=200,
    )
    resp = client.get("/api/jamendo/stream?track_id=999")
    assert resp.status_code == 404


@responses.activate
def test_fetch_returns_full_mp3(client):
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 1},
              "results": [{"id": "1", "name": "Cool Track",
                           "audio": "https://cdn/p.mp3",
                           "audiodownload": "https://cdn/full.mp3"}]},
        status=200,
    )
    responses.add(
        responses.GET, "https://cdn/full.mp3",
        body=b"FULLAUDIODATA", status=200, content_type="audio/mpeg",
    )
    resp = client.post("/api/jamendo/fetch", json={"track_id": "1"})
    assert resp.status_code == 200
    assert resp.mimetype == "audio/mpeg"
    assert resp.data == b"FULLAUDIODATA"
    assert "Cool Track" in resp.headers.get("Content-Disposition", "")


def test_fetch_missing_track_id_400(client):
    resp = client.post("/api/jamendo/fetch", json={})
    assert resp.status_code == 400


@responses.activate
def test_fetch_falls_back_to_audio_when_no_download(client):
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 1},
              "results": [{"id": "1", "name": "X",
                           "audio": "https://cdn/p.mp3"}]},  # 无 audiodownload
        status=200,
    )
    responses.add(
        responses.GET, "https://cdn/p.mp3",
        body=b"PREVIEWASFULL", status=200, content_type="audio/mpeg",
    )
    resp = client.post("/api/jamendo/fetch", json={"track_id": "1"})
    assert resp.status_code == 200
    assert resp.data == b"PREVIEWASFULL"


@responses.activate
def test_fetch_track_not_found_404(client):
    """track_id 不存在时返回 404（与 stream 路由对称）"""
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 0}, "results": []},
        status=200,
    )
    resp = client.post("/api/jamendo/fetch", json={"track_id": "999"})
    assert resp.status_code == 404


@responses.activate
def test_fetch_handles_cjk_title(client):
    """非 ASCII 标题（如中文）也能成功，Content-Disposition 含 RFC 5987 filename*"""
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 1},
              "results": [{"id": "1", "name": "夜的钢琴曲",
                           "audio": "https://cdn/p.mp3",
                           "audiodownload": "https://cdn/full.mp3"}]},
        status=200,
    )
    responses.add(
        responses.GET, "https://cdn/full.mp3",
        body=b"AUDIODATA", status=200, content_type="audio/mpeg",
    )
    resp = client.post("/api/jamendo/fetch", json={"track_id": "1"})
    assert resp.status_code == 200
    cd = resp.headers.get("Content-Disposition", "")
    # ASCII fallback 部分（filename=）应不含中文
    assert 'filename="' in cd
    # RFC 5987 部分（filename*=UTF-8''）应含 URL-encoded 中文
    assert "filename*=UTF-8''" in cd
    # URL-encoded "夜的钢琴曲" = %E5%A4%9C%E7%9A%84%E9%92%A2%E7%90%B4%E6%9B%B2
    assert "%E5%A4%9C" in cd  # "夜" 的 URL-encode 前缀


@responses.activate
def test_fetch_strips_control_chars_in_title(client):
    """标题里的 \\r\\n 等控制字符不会让 Werkzeug 抛 ValueError"""
    responses.add(
        responses.GET,
        "https://api.jamendo.com/v3.0/tracks/",
        json={"headers": {"status": "success", "results_count": 1},
              "results": [{"id": "1", "name": "evil\r\nX-Header: pwned",
                           "audio": "https://cdn/p.mp3",
                           "audiodownload": "https://cdn/full.mp3"}]},
        status=200,
    )
    responses.add(
        responses.GET, "https://cdn/full.mp3",
        body=b"DATA", status=200, content_type="audio/mpeg",
    )
    resp = client.post("/api/jamendo/fetch", json={"track_id": "1"})
    assert resp.status_code == 200
    cd = resp.headers.get("Content-Disposition", "")
    assert "X-Header" not in cd or "\r" not in cd
    # 验证响应头里没有注入的 X-Header
    assert resp.headers.get("X-Header") is None


def test_health_reports_jamendo_configured(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["jamendo"] is True


def test_health_reports_jamendo_not_configured(client, monkeypatch):
    monkeypatch.delenv("JAMENDO_CLIENT_ID", raising=False)
    resp = client.get("/api/health")
    body = resp.get_json()
    assert body["jamendo"] is False
