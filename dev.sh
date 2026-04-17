#!/usr/bin/env bash
# 一键启动 beatflow 本地开发环境：Flask API + 静态前端
#
# 用法：
#   ./dev.sh                      默认 API 8080 / 前端 5173
#   API_PORT=8088 ./dev.sh        换 API 端口（8080 被占时用这个）
#   WEB_PORT=3000 ./dev.sh        换前端端口
#
# 按 Ctrl+C 同时停止两个服务。日志保存到 .dev-logs/ 下。

set -euo pipefail
cd "$(dirname "$0")"

API_PORT="${API_PORT:-8080}"
WEB_PORT="${WEB_PORT:-5173}"
LOG_DIR=".dev-logs"
API_LOG="$LOG_DIR/api.log"
WEB_LOG="$LOG_DIR/web.log"

port_busy() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE ":$1$"
}

if port_busy "$API_PORT"; then
  echo "[错误] API 端口 $API_PORT 已被占用；换端口重试：API_PORT=8088 $0" >&2
  exit 1
fi
if port_busy "$WEB_PORT"; then
  echo "[错误] 前端端口 $WEB_PORT 已被占用；换端口重试：WEB_PORT=3000 $0" >&2
  exit 1
fi

# venv 与依赖（幂等）：首次创建，每次都补齐缺失依赖
# 网络慢可设置镜像：PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple ./dev.sh
if [ ! -d api/venv ]; then
  echo "[准备] 创建 api/venv..."
  python3 -m venv api/venv
fi
if [ ! -f api/venv/.deps-ok ] || [ api/requirements.txt -nt api/venv/.deps-ok ]; then
  echo "[准备] 安装/更新依赖（首次或依赖变更，约 1-3 分钟）..."
  PIP_ARGS=(--timeout 120 --retries 10)
  [ -n "${PIP_INDEX_URL:-}" ] && PIP_ARGS+=(--index-url "$PIP_INDEX_URL")
  api/venv/bin/pip install "${PIP_ARGS[@]}" --upgrade pip
  api/venv/bin/pip install "${PIP_ARGS[@]}" -r api/requirements.txt
  touch api/venv/.deps-ok
fi

mkdir -p "$LOG_DIR"
: >"$API_LOG"
: >"$WEB_LOG"

# 用 exec 让 subshell 直接变成目标进程，这样 $! 就是 python 本身的 PID，
# cleanup 时 kill 能直接终止（不会卡在 subshell 壳子里）
(cd api && exec env PORT="$API_PORT" ./venv/bin/python app.py) >"$API_LOG" 2>&1 &
API_PID=$!
(cd frontend && exec python3 -m http.server "$WEB_PORT") >"$WEB_LOG" 2>&1 &
WEB_PID=$!

cleanup() {
  echo
  echo "[退出] 停止服务..."
  kill "$API_PID" "$WEB_PID" "${TAIL_PID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 等 API 健康检查，最多 15s
printf "[等待] API 就绪 "
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$API_PORT/api/health" >/dev/null 2>&1; then
    echo "OK"
    break
  fi
  printf "."
  sleep 0.5
  if [ "$i" -eq 30 ]; then
    echo
    echo "[错误] API 启动失败，最后 20 行日志：" >&2
    tail -n 20 "$API_LOG" >&2
    exit 1
  fi
done

cat <<EOF

==================================================
  API       http://localhost:$API_PORT/api/health
  Frontend  http://localhost:$WEB_PORT/
==================================================
EOF

if [ "$API_PORT" != "8080" ]; then
  echo "提示：API 端口不是默认 8080，请在前端页面把 API 地址改为 http://localhost:$API_PORT"
  echo
fi

echo "实时日志（Ctrl+C 停止全部服务）："
echo "--------------------------------------------------"

# tail 后台跑 + wait：这样 Ctrl+C / TERM 能立刻进入 trap 清理
tail -n 0 -f "$API_LOG" "$WEB_LOG" &
TAIL_PID=$!
wait "$TAIL_PID"
