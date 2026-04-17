# V-AutoFlow Web（开源化实现）

一个**音乐节拍驱动的视频时间线生成工具**。给定一首音乐和一批图片，工具会自动分析音频节拍、把图片按节拍段切分排列，用于制作"卡点视频"的素材编排预览。

## 项目组成

- `frontend/`：纯静态前端页面（可直接部署到 GitHub Pages，无需服务器）
- `api/`：Flask API 服务（Docker 部署，Fly.io 友好），负责音频节拍分析

## 后端能力（Flask API）

- 接收上传的音频文件，分析节拍时间点
- 支持两种检测方法：
  - `beat` —— 适合流行音乐（强拍明显）
  - `onset` —— 适合古典音乐（细节丰富）
- 可部署在 Fly.io / Docker 上

## 前端能力（纯静态页面）

- 上传音频 -> 调用 API -> 展示节拍结果
- 波形预览（WaveSurfer.js）+ 播放/暂停 + 节拍标记/高亮
- 选择本地图片（多选）+ 缩略图预览，支持**拖拽重排**
- 根据节拍区间自动生成时间线，将图片循环分配到各节拍段
- API 请求自动重试、上传大文件尺寸提示、分析结果本地缓存恢复

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
