FROM node:22-alpine AS webbuild
WORKDIR /web
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STATIC_DIR=/app/static DATABASE_PATH=/app/data/personalmanagement.db
WORKDIR /app
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY backend/app.py /app/app.py
COPY --from=webbuild /web/dist/ /app/static/
RUN mkdir -p /app/data && useradd -r -u 10001 planner && chown -R planner:planner /app
USER planner
EXPOSE 8000
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000"]
