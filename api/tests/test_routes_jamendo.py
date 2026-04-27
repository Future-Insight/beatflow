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
