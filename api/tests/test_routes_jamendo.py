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
