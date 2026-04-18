#!/usr/bin/env bash
# 停止 beatflow 本地开发环境（与 dev.sh 配对）
#
# 用法：
#   ./stop.sh                     停止默认端口 8088 / 5173 的服务
#   API_PORT=9000 ./stop.sh       按指定 API 端口停止
#   WEB_PORT=3000 ./stop.sh
#   ./stop.sh --force             直接发送 SIGKILL，不等待优雅退出

set -u
cd "$(dirname "$0")"

API_PORT="${API_PORT:-8088}"
WEB_PORT="${WEB_PORT:-5173}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

pids_on_port() {
  lsof -ti tcp:"$1" 2>/dev/null || true
}

kill_port() {
  local port="$1" label="$2"
  local pids
  pids="$(pids_on_port "$port")"
  if [ -z "$pids" ]; then
    echo "[跳过] $label 端口 $port 无进程"
    return
  fi

  if [ "$FORCE" -eq 1 ]; then
    echo "[强杀] $label 端口 $port -> PID: $(echo $pids | tr '\n' ' ')"
    kill -9 $pids 2>/dev/null || true
    return
  fi

  echo "[停止] $label 端口 $port -> PID: $(echo $pids | tr '\n' ' ')"
  kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5 6; do
    sleep 0.5
    pids="$(pids_on_port "$port")"
    [ -z "$pids" ] && return
  done

  echo "[强制] $label 未在 3s 内退出，发送 SIGKILL"
  kill -9 $pids 2>/dev/null || true
}

kill_port "$API_PORT" "API"
kill_port "$WEB_PORT" "Frontend"

echo "[完成] 停止脚本结束"
