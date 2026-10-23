# Build from the repository root:
#   docker compose up -d --build   (see docker-compose.yml)
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini .
# Source dataset baked in so the one-time import can run inside the container.
COPY ["SHOPS MAP v2.kml", "/data/shops-map-v2.kml"]

RUN mkdir -p /app/media

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
