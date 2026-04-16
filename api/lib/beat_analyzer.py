"""
音频节拍分析模块
支持beat和onset两种检测方法
"""
import os
import subprocess
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np


_LIBROSA = None


def _get_librosa():
    global _LIBROSA
    if _LIBROSA is None:
        import librosa  # type: ignore

        _LIBROSA = librosa
    return _LIBROSA


def analyze_beats(
    music_path: str,
    min_interval: float = 0.3,
    method: str = 'beat',
    *,
    backend: str = 'local',
    api_url: Optional[str] = None,
    api_key: Optional[str] = None,
    api_model: Optional[str] = None,
    api_timeout: float = 60.0,
) -> Dict:
    """
    分析音频节拍

    Args:
        music_path: 音频文件路径
        min_interval: 最小节拍间隔(秒),用于过滤密集节拍
        method: 节拍检测方法
            - 'beat': 标准节拍检测(强拍点),适合流行音乐
            - 'onset': 波峰检测(能量突变点),适合古典音乐和复杂节奏
        backend: 分析后端(local/api)
        api_url: API 接口地址(backend=api时使用)
        api_key: API 密钥(backend=api时使用)
        api_model: API 模型名称(backend=api时使用)
        api_timeout: API 请求超时(秒)

    Returns:
        {
            'beat_times': [0.0, 0.5, 1.2, ...],  # 节拍时间戳列表
            'tempo': 120.0,                       # BPM值
            'duration': 180.5                     # 音频时长
        }
    """
    backend = (backend or 'local').strip().lower()
    if backend in {'api', 'remote'}:
        return _analyze_beats_via_api(
            music_path,
            min_interval=min_interval,
            api_url=api_url,
            api_key=api_key,
            api_model=api_model,
            api_timeout=api_timeout,
        )

    # librosa 默认使用 soundfile 后端读取音频；缺失时会在导入/运行期触发 ModuleNotFoundError。
    # 这里提前拦截并给出更明确的提示，便于 Web UI 直接返回可读错误信息。
    try:
        import soundfile  # type: ignore  # noqa: F401
    except ModuleNotFoundError as e:
        raise ModuleNotFoundError(
            "缺少依赖：soundfile。请执行 `pip install -r requirements.txt`（或单独安装 `pip install soundfile`）"
        ) from e

    # 延迟导入：避免 soundfile 缺失导致模块 import 失败，从而被 lib/__init__.py 的兜底提示覆盖。
    librosa = _get_librosa()

    # 加载音频：
    # - 优先用 soundfile（无额外 stderr 噪音）
    # - 对于“扩展名是 mp3 但实际是 mp4/m4a(AAC/ALAC)”等 soundfile 不支持的容器，回退 ffmpeg 解码
    y, sr = _load_audio_best_effort(music_path)
    duration = librosa.get_duration(y=y, sr=sr)

    # 根据方法检测节拍
    if method == 'onset':
        tempo, beat_times = _detect_onsets(y, sr)
    else:  # 默认使用beat方法
        tempo, beat_times = _detect_beats(y, sr)

    # 过滤密集节拍
    beat_times = _filter_beats(beat_times, y, sr, tempo, min_interval)

    # 边界保护
    beat_times = _ensure_boundaries(beat_times, duration, min_interval)

    return {
        'beat_times': beat_times.tolist(),
        'tempo': float(tempo),
        'duration': float(duration)
    }


def _load_audio_best_effort(path: str) -> tuple[np.ndarray, int]:
    """
    返回：(mono_float32_samples, sample_rate)

    说明：
    - 一些平台的 libsndfile 不支持 mp3/mp4 容器；librosa 会走 audioread/mpg123 并输出大量警告/错误信息。
    - 这里优先尝试 soundfile；失败则用 ffmpeg 解码，尽量避免噪音并提高格式兼容性。
    """
    # 针对“文件名后缀是 mp3，但实际并非 MPEG 音频（例如 mp4/m4a 容器）”：
    # libsndfile 会尝试按 mp3 解码并在底层输出 mpg123 的 stderr 噪音。
    # 这里做一个轻量级头部探测，命中后直接走 ffmpeg，避免污染日志。
    if _should_skip_soundfile(path):
        return _load_audio_ffmpeg(path, target_sr=44100)

    try:
        import soundfile as sf  # type: ignore

        y2d, sr = sf.read(path, dtype="float32", always_2d=True)
        if isinstance(sr, int) and sr > 0 and hasattr(y2d, "shape") and y2d.size:
            y = np.asarray(y2d, dtype=np.float32)
            # always_2d=True => (n, ch)
            if y.ndim == 2 and y.shape[1] > 1:
                y = y.mean(axis=1)
            else:
                y = y.reshape(-1)
            return y, int(sr)
    except Exception:
        pass

    try:
        return _load_audio_ffmpeg(path, target_sr=44100)
    except Exception:
        # 最后兜底：仍然尝试 librosa.load（可能触发 audioread 的 warning）
        librosa = _get_librosa()
        y, sr = librosa.load(path, sr=None, mono=True)
        return np.asarray(y, dtype=np.float32), int(sr)


def _should_skip_soundfile(path: str) -> bool:
    """
    返回 True 表示跳过 soundfile，直接用 ffmpeg。

    目前只针对 .mp3 做启发式判断（尽量最小化影响面）：
    - 其实是 MP4/M4A 容器（ftyp）
    - ID3 tag 特别大（mpg123 可能在 64KiB junk 后放弃）
    - 头部既不是 ID3 也不像 MPEG frame sync（大概率不是 mp3）
    """
    try:
        if Path(path).suffix.lower() != ".mp3":
            return False
        with open(path, "rb") as f:
            head = f.read(64)
    except Exception:
        return False

    if not head:
        return False
    if b"ftyp" in head[:32]:
        return True

    if head.startswith(b"ID3") and len(head) >= 10:
        # ID3v2 size 为 syncsafe int（不含 header 自身的 10 bytes）
        b0, b1, b2, b3 = head[6], head[7], head[8], head[9]
        if (b0 | b1 | b2 | b3) & 0x80:
            return False
        tag_size = (b0 << 21) | (b1 << 14) | (b2 << 7) | b3
        return tag_size > 65536

    # MPEG frame sync: 0xFFEx (most common: 0xFFFB)
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return False
    return True


def _load_audio_ffmpeg(path: str, *, target_sr: int = 44100) -> tuple[np.ndarray, int]:
    """使用 ffmpeg 将音频解码成 mono float32 PCM，再转为 numpy 数组。"""
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-i",
        path,
        "-vn",
        "-sn",
        "-map",
        "a:0",
        "-ac",
        "1",
        "-ar",
        str(int(target_sr)),
        "-f",
        "f32le",
        "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=False)
    if proc.returncode != 0:
        err = (proc.stderr or b"").decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"ffmpeg 解码音频失败: {err or 'unknown error'}")
    raw = proc.stdout or b""
    if not raw:
        raise RuntimeError("ffmpeg 解码音频失败: empty output")
    y = np.frombuffer(raw, dtype=np.float32)
    if y.size == 0:
        raise RuntimeError("ffmpeg 解码音频失败: empty samples")
    return y, int(target_sr)


def _analyze_beats_via_api(
    music_path: str,
    *,
    min_interval: float,
    api_url: Optional[str],
    api_key: Optional[str],
    api_model: Optional[str],
    api_timeout: float,
) -> Dict:
    import requests

    resolved_url = (api_url or os.environ.get("MUSIC_ANALYSIS_API_URL") or "http://localhost:8000/analyze").strip()
    resolved_model = (api_model or os.environ.get("MUSIC_ANALYSIS_API_MODEL") or "harmonix-all").strip()
    resolved_key = (api_key or os.environ.get("MUSIC_ANALYSIS_API_KEY") or "").strip()

    headers = {}
    if resolved_key:
        headers["X-API-Key"] = f"{resolved_key}"

    data = {}
    if resolved_model:
        data["model"] = resolved_model

    with open(music_path, "rb") as f:
        response = requests.post(
            resolved_url,
            headers=headers,
            files={"file": f},
            data=data,
            timeout=api_timeout,
        )
    if response.status_code in (401, 403):
        raise RuntimeError(
            f"音乐分析 API 鉴权失败({response.status_code})：url={resolved_url}；"
            "请检查 config.yaml 的 audio.api_key 或环境变量 MUSIC_ANALYSIS_API_KEY"
        )
    response.raise_for_status()
    payload = response.json()

    beat_times, tempo, duration, extras = _extract_api_result(payload)

    beat_times = _filter_beats_by_interval(beat_times, min_interval)
    if not beat_times or beat_times[0] > 0.5:
        beat_times = [0.0] + list(beat_times)
    if duration is None:
        # API 可能不返回音频时长；此时用 ffprobe 本地兜底，避免节拍末尾缺失导致视频比音频短。
        duration = _probe_audio_duration_ffprobe(music_path)
    if duration is not None:
        beat_times = _ensure_boundaries_simple(beat_times, duration, min_interval)

    resolved_duration = duration
    if resolved_duration is None:
        resolved_duration = float(beat_times[-1]) if beat_times else 0.0

    result = {
        'beat_times': beat_times,
        'tempo': float(tempo or 0.0),
        'duration': float(resolved_duration),
    }
    if extras:
        result.update(extras)
    return result


def _probe_audio_duration_ffprobe(path: str) -> Optional[float]:
    """使用 ffprobe 获取音频时长(秒)。失败则返回 None。"""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None
    text = (result.stdout or "").strip()
    if not text:
        return None
    try:
        value = float(text)
    except Exception:
        return None
    if value <= 0:
        return None
    return value


def _extract_api_result(payload: dict) -> tuple[list[float], Optional[float], Optional[float], dict]:
    processing_time = _coerce_number(payload.get("processing_time")) if isinstance(payload, dict) else None
    candidates: List[dict] = []
    if isinstance(payload, dict):
        candidates.append(payload)
        for key in ("data", "result"):
            value = payload.get(key)
            if isinstance(value, dict):
                candidates.append(value)

    for item in candidates:
        beat_times_raw = (
            item.get("beat_times")
            or item.get("beats")
            or item.get("beat")
            or item.get("onsets")
        )
        if beat_times_raw is None:
            continue
        beat_times = _coerce_beat_times(beat_times_raw)
        if not beat_times:
            continue

        tempo = _coerce_number(item.get("tempo") or item.get("bpm"))
        duration = _coerce_number(item.get("duration") or item.get("audio_duration") or item.get("length"))
        downbeats = _coerce_float_list(item.get("downbeats"))
        beat_positions = _coerce_int_list(item.get("beat_positions"))
        segments = _coerce_segments(item.get("segments"))
        if duration is None and segments:
            duration = max(seg["end"] for seg in segments if isinstance(seg.get("end"), (int, float)))

        extras = {}
        if downbeats:
            extras["downbeats"] = downbeats
        if beat_positions:
            extras["beat_positions"] = beat_positions
        if segments:
            extras["segments"] = segments
        if processing_time is not None:
            extras["processing_time"] = processing_time

        return beat_times, tempo, duration, extras

    raise ValueError("API 返回结果缺少可用的节拍数据")


def _coerce_beat_times(raw: Iterable) -> list[float]:
    beat_times: list[float] = []
    for item in raw:
        if isinstance(item, (int, float)):
            beat_times.append(float(item))
            continue
        if isinstance(item, dict):
            t = item.get("time") or item.get("timestamp")
            if isinstance(t, (int, float)):
                beat_times.append(float(t))
    return sorted(beat_times)


def _coerce_number(value: object) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(value)
    except Exception:
        return None


def _coerce_float_list(value: object) -> list[float]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[float] = []
    for item in value:
        if isinstance(item, (int, float)):
            out.append(float(item))
    return out


def _coerce_int_list(value: object) -> list[int]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[int] = []
    for item in value:
        if isinstance(item, (int, float)):
            out.append(int(item))
    return out


def _coerce_segments(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    out: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        start = _coerce_number(item.get("start"))
        end = _coerce_number(item.get("end"))
        label = item.get("label")
        if start is None or end is None:
            continue
        seg = {"start": float(start), "end": float(end)}
        if label is not None:
            seg["label"] = str(label)
        out.append(seg)
    return out


def _filter_beats_by_interval(beat_times: list[float], min_interval: float) -> list[float]:
    if min_interval <= 0:
        return beat_times
    filtered: list[float] = []
    last = None
    for t in beat_times:
        if last is None or t - last >= min_interval:
            filtered.append(float(t))
            last = t
    return filtered


def _ensure_boundaries_simple(beat_times: list[float], duration: float, min_interval: float) -> list[float]:
    beats = list(beat_times)
    if not beats or beats[0] > 0.5:
        beats.insert(0, 0.0)
    # 末尾无论是否达到 min_interval，都尽量补齐到音频时长，避免“秒数不够”导致无片段/视频过短。
    if duration > beats[-1] + 1e-6:
        beats.append(duration)
    return beats


def _detect_beats(y: np.ndarray, sr: int) -> tuple:
    """标准节拍检测(强拍点)"""
    librosa = _get_librosa()
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    return tempo, beat_times


def _detect_onsets(y: np.ndarray, sr: int) -> tuple:
    """波峰检测(能量突变点)"""
    librosa = _get_librosa()
    # 检测onset(声音起始点)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, backtrack=True)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)

    # 估算tempo
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)

    return tempo, onset_times


def _filter_beats(beat_times: np.ndarray, y: np.ndarray, sr: int, tempo: float, min_interval: float) -> np.ndarray:
    """
    过滤过于密集的节拍

    Args:
        beat_times: 原始节拍时间戳数组
        y: 音频波形数据
        sr: 采样率
        tempo: BPM值
        min_interval: 最小节拍间隔

    Returns:
        过滤后的节拍时间戳数组
    """
    if len(beat_times) == 0:
        return beat_times

    # 动态降频: 如果BPM过快,自动降低采样率
    if tempo > 150:
        downsample_factor = int(tempo / 120)
        beat_times = beat_times[::downsample_factor]

    if min_interval <= 0:
        return beat_times

    return _filter_beats_by_energy(beat_times, y, sr, min_interval)


def _filter_beats_by_energy(beat_times: np.ndarray, y: np.ndarray, sr: int, min_interval: float) -> np.ndarray:
    """
    基于能量强度的节拍过滤：将过密节拍按间隔聚类，每组只保留能量最强的那个点

    说明：
    - 先用 onset strength envelope 作为能量强度参考
    - 将相邻节拍间隔 < min_interval 视为同一组候选
    - 每组选择能量强度最大的节拍时间
    """
    if len(beat_times) <= 1:
        return beat_times

    librosa = _get_librosa()
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    if len(onset_env) == 0:
        return beat_times
    times = librosa.times_like(onset_env, sr=sr)

    def strength_at(t: float) -> float:
        idx = int(np.argmin(np.abs(times - t)))
        return float(onset_env[idx])

    filtered_beats = []
    current_group = [float(beat_times[0])]
    prev = float(beat_times[0])

    for t in beat_times[1:]:
        t = float(t)
        if t - prev < min_interval:
            current_group.append(t)
        else:
            filtered_beats.append(max(current_group, key=strength_at))
            current_group = [t]
        prev = t

    filtered_beats.append(max(current_group, key=strength_at))
    return np.array(filtered_beats)


def _ensure_boundaries(beat_times: np.ndarray, duration: float, min_interval: float) -> np.ndarray:
    """
    确保首尾有节拍点

    Args:
        beat_times: 节拍时间戳数组
        duration: 音频时长
        min_interval: 最小节拍间隔

    Returns:
        处理后的节拍时间戳数组
    """
    beats = list(beat_times)

    # 确保开头有节拍
    if len(beats) == 0 or beats[0] > 0.5:
        beats.insert(0, 0.0)

    # 确保结尾有节拍
    # 末尾无论是否达到 min_interval，都尽量补齐到音频时长，避免“秒数不够”导致无片段/视频过短。
    if len(beats) > 0 and duration > beats[-1] + 1e-6:
        beats.append(duration)

    return np.array(beats)
