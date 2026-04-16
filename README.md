# V-AutoFlow Web（开源化实现）

本目录是 `docs/plan_20260118_开源化方案.md` 的落地代码（最小可跑版本）：

- `frontend/`：纯静态页面（可用于 GitHub Pages）
- `api/`：Fly.io 友好的 Flask API（Docker 部署），仅提供节拍分析

已实现的前端能力（最小版）：
- 上传音频 -> 调用 API -> 展示节拍结果
- 波形预览（WaveSurfer.js）+ 播放/暂停 + 节拍标记/高亮
- 选择本地图片（多选）+ 缩略图预览
- 根据节拍区间生成时间线，并循环分配图片

## 本地运行（API）

```bash
cd v-autoflow-web/api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

健康检查：
```bash
curl http://localhost:8080/api/health
```

分析接口：
```bash
curl -F "audio=@your.mp3" -F "method=beat" -F "min_interval=0.3" http://localhost:8080/api/analyze
```

## 本地运行（前端）

```bash
cd v-autoflow-web/frontend
python3 -m http.server 5173
```

然后浏览器打开：
`http://localhost:5173/`
