const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export class BeatAnalyzerAPI {
  constructor(apiBaseUrl) {
    this.apiBaseUrl = (apiBaseUrl || "").replace(/\/+$/, "");
  }

  _mustUrl() {
    if (!this.apiBaseUrl) throw new Error("请先填写 API 地址");
    return this.apiBaseUrl;
  }

  async _doRequest(audioFile, { method, min_interval }) {
    const base = this._mustUrl();
    const url = base.endsWith("/api") ? `${base}/analyze` : `${base}/api/analyze`;

    const fd = new FormData();
    fd.append("audio", audioFile);
    fd.append("method", method);
    fd.append("min_interval", String(min_interval));

    const resp = await fetch(url, { method: "POST", body: fd });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || `请求失败：${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  // onRetry(attempt, max) 在每次重试前调用，可用于更新 UI 状态
  async analyze(audioFile, { method = "beat", min_interval = 0.3 } = {}, { onRetry } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this._doRequest(audioFile, { method, min_interval });
      } catch (e) {
        lastError = e;
        // 4xx 客户端错误（文件格式错误、参数错误）不重试
        if (e.status && e.status >= 400 && e.status < 500) throw e;
        if (attempt < MAX_RETRIES) {
          if (onRetry) onRetry(attempt, MAX_RETRIES);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    throw lastError;
  }
}
