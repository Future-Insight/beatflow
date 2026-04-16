"""V-AutoFlow Web API 使用的最小核心库（仅包含节拍分析）。"""

from .beat_analyzer import analyze_beats

__all__ = ["analyze_beats"]

