# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ── Stage 2: run the Flask backend ───────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Install Python deps (including gunicorn for production)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copy application code
COPY agent/ ./agent/
COPY server.py main.py ./

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/client/dist ./client/dist

# /data is the mount point for Railway's persistent volume.
# token.json and chats.db live here so they survive redeploys.
RUN mkdir -p /data

# Non-root user for security
RUN useradd -m appuser && chown -R appuser /app /data
USER appuser

EXPOSE 5000

# Use gunicorn in production; falls back gracefully if PORT is unset
# NOTE: rate limits, agent sessions, and OAuth confirmations live in process
# memory, so this app MUST run with exactly one worker. Scale with threads only.
CMD gunicorn --bind 0.0.0.0:${PORT:-5000} --workers 1 --threads 4 --timeout 120 server:app
