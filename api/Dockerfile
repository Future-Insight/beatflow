FROM python:3.11-slim

WORKDIR /app

# librosa/soundfile + ffmpeg 解码回退
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["gunicorn", "-b", "0.0.0.0:8080", "-w", "1", "--timeout", "300", "--graceful-timeout", "30", "app:app"]

