FROM node:22-bookworm-slim AS webbuild
WORKDIR /web
COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    STATIC_DIR=/usr/src/personalmanagement/static \
    PORT=3000
WORKDIR /usr/src/personalmanagement
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app.py backend/telegram_digest.py backend/push_reminders.py ./
COPY --from=webbuild /web/dist/ ./static/
# Bothost may mount source files on /app; code stays outside this directory.
# Database credentials arrive only through Bothost's DATABASE_URL variable.
RUN useradd -r -u 10001 planner \
    && chown -R planner:planner /usr/src/personalmanagement
USER planner
EXPOSE 3000
CMD ["sh","-c","exec uvicorn app:app --host 0.0.0.0 --port \"${PORT:-3000}\""]
