---
title: V-AutoFlow API
emoji: 🎵
colorFrom: indigo
colorTo: pink
sdk: docker
app_port: 8080
pinned: false
license: mit
---

# V-AutoFlow API

Beat detection API powering [V-AutoFlow](https://github.com/Future-Insight/beatflow).

This Space is automatically synced from the `api/` directory of the upstream
GitHub repository — do not edit files here directly.

## Endpoints

- `GET  /api/health` — health check
- `POST /api/analyze` — analyze an uploaded audio file, returns beat times

See the [main repository](https://github.com/Future-Insight/beatflow) for
request/response details and the frontend that consumes this API.
