# Demo GIF / 视频录制指南

用于给 README 顶部、Show HN、Product Hunt 提交材料准备 demo 资源。

## 目标规格

| 用途              | 格式    | 建议参数                                  |
| ----------------- | ------- | ----------------------------------------- |
| README 顶部       | **GIF** | 宽 800–1000px · 8–12s · ≤ 4 MB · 12–15fps |
| Product Hunt 封面 | MP4     | 1920×1080 · ≤ 30s · H.264 · 5–10 MB       |
| Twitter / X 配图  | MP4     | 1280×720 · ≤ 45s · H.264                  |
| 抖音 / 小红书     | MP4     | 1080×1920 (9:16) · ≤ 60s                  |

> 文件大于 5MB 的 GIF，GitHub 移动端会加载很慢，用户等不及就划走了。**宁愿短也别大**。

## 录制前的脚本（很重要）

提前在浏览器里操作一遍，确认每一步 ≤ 2 秒，总 loop 8-10 秒：

1. **(0.5s)** 打开 `https://future-insight.github.io/beatflow/` — 首屏
2. **(2s)** 上传音乐（或点预置音频），波形 + BPM 出现
3. **(1.5s)** 拖拽或多选图片进来，缩略图排列出来
4. **(2s)** 点 Play，图片跟着节拍切换（这是**卖点高潮**，让它跑至少一个小节）
5. **(1s)** 点 Export，进度条走完
6. **(1s)** 视频缩略图出现在结果区

**一个反直觉技巧**：录制时把浏览器调成**深色主题**——GIF 调色板对深色背景更友好，压缩后画质明显更好。

## 方案 A：ffmpeg + x11grab（推荐，完全可控）

### 1. 查窗口坐标和大小

```bash
# 鼠标点一下要录制的窗口
xdotool getactivewindow getwindowgeometry
# 输出示例：
#   Position: 320,180 (screen: 0)
#   Geometry: 1200x800
```

### 2. 录制为 MP4（中间产物，质量高）

```bash
# 替换下面的 320,180 和 1200x800 为上一步的值
ffmpeg -y -video_size 1200x800 -framerate 30 \
  -f x11grab -i :0.0+320,180 \
  -c:v libx264 -preset ultrafast -qp 0 \
  demo-raw.mp4
```

按 `q` 或 `Ctrl+C` 停止。

### 3. 裁剪/修剪（可选）

```bash
# 只保留第 2s 到第 12s
ffmpeg -i demo-raw.mp4 -ss 2 -to 12 -c copy demo-trimmed.mp4
```

### 4. MP4 → 高质量 GIF（两遍法 · palettegen）

```bash
# 第一遍：生成最优调色板
ffmpeg -y -i demo-trimmed.mp4 \
  -vf "fps=12,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff" \
  palette.png

# 第二遍：用调色板编码 GIF
ffmpeg -y -i demo-trimmed.mp4 -i palette.png \
  -filter_complex "fps=12,scale=900:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  demo.gif
```

生成的 `demo.gif` 通常 2–4 MB，画质远超一遍压缩。

### 5. 检查大小

```bash
ls -lh demo.gif
```

如果 > 4 MB：降 `fps=10`、或 `scale=800:-1`，再跑第 4 步。

## 方案 B：peek（GUI，零门槛）

```bash
sudo apt install peek
peek  # 框选窗口，按 Record GIF
```

简单但画质和体积不如 ffmpeg。出来的 GIF 通常可以直接用，或再用上面第 4 步的 palette 法二次压缩。

## 方案 C：OBS（如果要同时录 MP4 和 GIF）

```bash
sudo apt install obs-studio
```

先用 OBS 录一个 1080p MP4，再跑方案 A 的第 4 步生成 GIF。一次录制产出两份素材。

## 放到 README

```markdown
<p align="center">
  <img src="./docs/assets/demo.gif" alt="Beatflow demo" width="800">
</p>
```

把 `demo.gif` 放到 `docs/assets/` 下（同时 `mkdir -p docs/assets`），避免污染根目录。

## 常见坑

- **GIF 动画不循环**：默认是循环的，如果没循环，是浏览器 cache 问题，强刷即可
- **上传到 GitHub 后变糊**：GitHub 会对 > 10MB 的资源做压缩，保持在 4MB 以下就不会
- **录制时 CPU 飙升**：加 `-preset ultrafast -qp 0` 是用磁盘换 CPU，中间 MP4 会很大（几百 MB），但中间文件会在第 4 步后删掉无所谓
- **光标出现在录制里**：加 `-draw_mouse 0` 到 x11grab 参数里
