import json
import logging
import os
import tempfile
import time

import requests
from pathlib import Path

from flask import Flask, jsonify, request

from lib import analyze_beats

STATS_DIR = Path(os.environ.get("BEATFLOW_STATS_DIR", "/tmp/beatflow_stats"))
ANALYZED_LOG = STATS_DIR / "analyzed.jsonl"
EXPORTED_LOG = STATS_DIR / "exported.jsonl"


def _append_jsonl(path: Path, entry: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("beatflow")


def _create_app() -> Flask:
    app = Flask(__name__)

    # 允许前端跨域请求；生产可用 CORS_ORIGINS 限制为 GitHub Pages 域名。
    origins = os.environ.get("CORS_ORIGINS", "*")

    @app.after_request
    def _add_cors_headers(resp):
        # 仅给 API 路径加 CORS，避免影响其它静态资源/路由（如果未来扩展）。
        if request.path.startswith("/api/"):
            resp.headers["Access-Control-Allow-Origin"] = origins
            resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
            resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return resp

    @app.route("/api/<path:_any>", methods=["OPTIONS"])
    def _cors_preflight(_any):
        return ("", 204)

    # 默认 60MB，避免用户不小心上传超大文件撑爆内存/磁盘。
    app.config["MAX_CONTENT_LENGTH"] = int(os.environ.get("MAX_UPLOAD_BYTES", str(60 * 1024 * 1024)))

    @app.get("/api/health")
    def health():
        return jsonify({"ok": True})

    @app.post("/api/analyze")
    def analyze():
        if "audio" not in request.files:
            return jsonify({"error": "缺少音频文件字段 audio"}), 400

        audio_file = request.files["audio"]
        if not audio_file or not getattr(audio_file, "filename", ""):
            return jsonify({"error": "音频文件为空"}), 400

        method = (request.form.get("method", "beat") or "beat").strip().lower()
        if method not in {"beat", "onset"}:
            return jsonify({"error": "method 仅支持 beat/onset"}), 400

        try:
            min_interval = float(request.form.get("min_interval", 0.3))
        except (TypeError, ValueError):
            return jsonify({"error": "min_interval 必须是数字"}), 400

        if min_interval <= 0:
            return jsonify({"error": "min_interval 必须 > 0"}), 400

        suffix = os.path.splitext(audio_file.filename)[1] or ".mp3"
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                audio_file.save(tmp.name)
                tmp_path = tmp.name

            log.info("analyze: file=%s method=%s min_interval=%s", audio_file.filename, method, min_interval)
            result = analyze_beats(tmp_path, min_interval=min_interval, method=method)
            _append_jsonl(ANALYZED_LOG, {"ts": time.time(), "filename": audio_file.filename, "method": method})
            return jsonify(result)
        except Exception as e:
            # 保持错误信息可读，便于前端展示；生产环境可改为更保守的错误输出。
            return jsonify({"error": str(e)}), 500
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    @app.post("/api/export-log")
    def export_log():
        payload = request.get_json(silent=True) or {}
        entry = {"ts": time.time(), **{k: payload.get(k) for k in ("name", "duration", "aspect")}}
        _append_jsonl(EXPORTED_LOG, entry)
        log.info("export: %s", payload)
        return jsonify({"ok": True})

    @app.get("/api/stats")
    def stats():
        def count(p):
            if not p.exists():
                return 0
            with p.open("rb") as f:
                return sum(1 for _ in f)
        return jsonify({"analyzed": count(ANALYZED_LOG), "exported": count(EXPORTED_LOG)})

    # ---- Jamendo 音乐选曲 ----
    from jamendo_client import search_popular, get_track_meta, JamendoError

    ALLOWED_GENRES = {"ambient", "classical", "electronic", "hiphop", "jazz",
                      "lounge", "pop", "rock", "soundtrack", "world"}

    def _client_id_or_503():
        cid = os.environ.get("JAMENDO_CLIENT_ID")
        if not cid:
            return None
        return cid

    @app.get("/api/jamendo/popular")
    def jamendo_popular():
        cid = _client_id_or_503()
        if not cid:
            return jsonify({"error": "Jamendo 未配置（缺 JAMENDO_CLIENT_ID）"}), 503
        genre = (request.args.get("genre") or "").strip() or None
        if genre and genre not in ALLOWED_GENRES:
            return jsonify({"error": f"genre 必须为 {sorted(ALLOWED_GENRES)} 之一或留空"}), 400
        try:
            limit = int(request.args.get("limit", "30"))
        except ValueError:
            return jsonify({"error": "limit 必须是整数"}), 400
        try:
            return jsonify(search_popular(client_id=cid, genre=genre, limit=limit))
        except JamendoError as e:
            log.warning("Jamendo popular 失败: %s", e)
            return jsonify({"error": e.safe_message}), 503

    @app.get("/api/jamendo/stream")
    def jamendo_stream():
        cid = _client_id_or_503()
        if not cid:
            return jsonify({"error": "Jamendo 未配置"}), 503
        track_id = (request.args.get("track_id") or "").strip()
        if not track_id:
            return jsonify({"error": "缺少 track_id"}), 400
        try:
            meta = get_track_meta(client_id=cid, track_id=track_id, prefer_download=False)
        except JamendoError as e:
            log.warning("Jamendo stream meta 失败: %s", e)
            status = 404 if e.code == "not_found" else 503
            return jsonify({"error": e.safe_message}), status

        from flask import Response, stream_with_context
        forward_headers = {}
        for h in ("Range", "If-Range"):
            if request.headers.get(h):
                forward_headers[h] = request.headers[h]

        try:
            upstream = requests.get(
                meta["url"], headers=forward_headers, stream=True,
                timeout=(10, 60),  # (connect, read)：连接 10s；read 单 chunk 60s
            )
        except requests.RequestException as e:
            log.warning("Jamendo CDN 网络错误: %s", e)
            return jsonify({"error": "Jamendo CDN 暂不可用"}), 503

        # 透传必要的响应头给浏览器（让 <audio> 知道 Range / 总长度）
        resp_headers = {"Content-Type": "audio/mpeg"}
        for h in ("Content-Range", "Content-Length", "Accept-Ranges"):
            if h in upstream.headers:
                resp_headers[h] = upstream.headers[h]

        def gen():
            try:
                for chunk in upstream.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        yield chunk
            except requests.RequestException as e:
                log.warning("Jamendo stream 中断: %s", e)
            except GeneratorExit:
                log.info("Jamendo stream 客户端断开")
                raise
            finally:
                upstream.close()

        return Response(
            stream_with_context(gen()),
            status=upstream.status_code,
            headers=resp_headers,
        )

    @app.post("/api/jamendo/fetch")
    def jamendo_fetch():
        cid = _client_id_or_503()
        if not cid:
            return jsonify({"error": "Jamendo 未配置"}), 503
        payload = request.get_json(silent=True) or {}
        track_id = (payload.get("track_id") or "").strip()
        if not track_id:
            return jsonify({"error": "缺少 track_id"}), 400
        try:
            meta = get_track_meta(client_id=cid, track_id=track_id, prefer_download=True)
        except JamendoError as e:
            log.warning("Jamendo fetch meta 失败: %s", e)
            status = 404 if e.code == "not_found" else 503
            return jsonify({"error": e.safe_message}), status

        from flask import Response, stream_with_context
        try:
            upstream = requests.get(meta["url"], stream=True, timeout=(10, 60))
            upstream.raise_for_status()
        except requests.RequestException as e:
            log.warning("Jamendo CDN 下载失败: %s", e)
            return jsonify({"error": "Jamendo CDN 下载失败"}), 503

        # 文件名安全化（避免 ASCII 之外的字符 + 路径分隔符）
        import re
        safe_title = re.sub(r"[^\w\s.-]", "", meta["title"]).strip() or f"track_{track_id}"
        safe_title = safe_title[:80]  # 限长

        def gen():
            try:
                for chunk in upstream.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        yield chunk
            except requests.RequestException as e:
                log.warning("Jamendo fetch 中断: %s", e)
            except GeneratorExit:
                log.info("Jamendo fetch 客户端断开")
                raise
            finally:
                upstream.close()

        return Response(
            stream_with_context(gen()),
            status=200,
            headers={
                "Content-Type": "audio/mpeg",
                "Content-Disposition": f'attachment; filename="{safe_title}.mp3"',
            },
        )

    return app


app = _create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
