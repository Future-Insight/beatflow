import os
import tempfile

from flask import Flask, jsonify, request

from lib import analyze_beats


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

    @app.options("/api/<path:_any>")
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

            result = analyze_beats(tmp_path, min_interval=min_interval, method=method)
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

    return app


app = _create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
