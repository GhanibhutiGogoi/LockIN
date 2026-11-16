FROM ghcr.io/astral-sh/uv:0.11.19 AS uv
FROM python:3.12-slim-bookworm AS base
COPY --from=uv /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 libsox-dev portaudio19-dev git build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . /app
RUN uv sync --frozen --no-dev
ENV PATH="/app/.venv/bin:$PATH" \
    LOCKIN_DATA_DIR=/data LOCKIN_MODEL_ROOT=/models \
    HF_HOME=/hf-cache PYTHONUNBUFFERED=1

FROM base AS api
EXPOSE 8011
CMD ["lockin-media", "serve", "--host", "0.0.0.0"]

FROM base AS voice
RUN lockin-media setup-runtime voice --execute
CMD ["lockin-media", "serve-voice", "--host", "0.0.0.0"]

FROM base AS aligner
RUN lockin-media setup-runtime aligner --execute
CMD ["lockin-media", "serve-aligner", "--host", "0.0.0.0"]

FROM base AS video
RUN lockin-media setup-runtime video --execute
ENTRYPOINT ["lockin-media"]
CMD ["generate-video", "--preset", "marble"]
