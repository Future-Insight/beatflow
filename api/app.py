import json
import logging
import os
import tempfile
import time
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

    return app


app = _create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
