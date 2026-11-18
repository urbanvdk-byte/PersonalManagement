"""PersonalManagement API: one SQLite database for all planning entities."""
from __future__ import annotations

import base64
import hmac
import json
import os
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

app = FastAPI(title="PersonalManagement", version="0.1.0", docs_url=None, redoc_url=None)

SCHEMA = """
CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4689db',
  emoji TEXT NOT NULL DEFAULT '📁',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT, due_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  period_start TEXT, period_end TEXT,
  start_value REAL NOT NULL DEFAULT 0,
  target_value REAL NOT NULL DEFAULT 1,
  current_value REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 4 CHECK (priority BETWEEN 1 AND 4),
  important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0,1)),
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0,1)),
  status TEXT NOT NULL DEFAULT 'inbox',
  scheduled_at TEXT, due_at TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  recurrence TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3466d9',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f3bb28',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_events_starts ON events(starts_at);
"""

FIELDS = {
    "areas": {"title", "color", "emoji"},
    "projects": {"area_id", "title", "description", "status", "start_date", "due_date"},
    "goals": {"area_id", "project_id", "title", "description", "period_start", "period_end", "start_value", "target_value", "current_value", "unit"},
    "tasks": {"area_id", "project_id", "goal_id", "parent_id", "title", "notes", "priority", "important", "urgent", "status", "scheduled_at", "due_at", "duration_minutes", "recurrence", "color"},
    "events": {"area_id", "project_id", "title", "notes", "starts_at", "ends_at", "color"},
}
STATUS = {"inbox", "planned", "in_progress", "waiting", "done", "someday", "cancelled"}
PROJECT_STATUS = {"active", "paused", "done", "archived"}
TASK_COLORS = {"#3466d9", "#16a2dc", "#12aaa1", "#39aa6f", "#e4b636", "#ff963b", "#e7635e", "#9463d6"}
DATETIME_KEYS = {"scheduled_at", "due_at", "starts_at", "ends_at"}
DATE_KEYS = {"start_date", "due_date", "period_start", "period_end"}
ID_KEYS = {"area_id", "project_id", "goal_id", "parent_id"}

def db_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", "/app/data/personalmanagement.db"))

@contextmanager
def connection():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def setup() -> None:
    if not os.environ.get("APP_PASSWORD"):
        raise RuntimeError("APP_PASSWORD is required. Set it in your deployment environment.")
    with connection() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        # Non-destructive migrations for existing data.
        for table, column, definition in (
            ("areas", "emoji", "TEXT NOT NULL DEFAULT '📁'"),
            ("tasks", "color", "TEXT NOT NULL DEFAULT '#3466d9'"),
        ):
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

@app.on_event("startup")
def startup() -> None:
    setup()

@app.middleware("http")
async def authenticate(request: Request, call_next):
    if request.url.path == "/api/health":
        return await call_next(request)
    raw = request.headers.get("authorization", "")
    username = os.environ.get("APP_USERNAME", "owner")
    password = os.environ.get("APP_PASSWORD", "")
    valid = False
    if raw.startswith("Basic ") and password:
        try:
            parsed = base64.b64decode(raw[6:], validate=True).decode("utf-8")
            name, secret = parsed.split(":", 1)
            valid = hmac.compare_digest(name, username) and hmac.compare_digest(secret, password)
        except (ValueError, UnicodeDecodeError):
            pass
    if not valid:
        return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="PersonalManagement"', "Cache-Control": "no-store"})
    return await call_next(request)

def validate(kind: str, payload: dict[str, Any], creating: bool = False) -> dict[str, Any]:
    if kind not in FIELDS:
        raise HTTPException(404, "Неизвестный тип записи")
    unknown = set(payload) - FIELDS[kind]
    if unknown:
        raise HTTPException(422, f"Неизвестные поля: {', '.join(sorted(unknown))}")
    if creating and (not isinstance(payload.get("title"), str) or not payload["title"].strip()):
        raise HTTPException(422, "Укажите название")
    for key, value in payload.items():
        if key == "title":
            if not isinstance(value, str) or not value.strip() or len(value) > 250:
                raise HTTPException(422, "Название: от 1 до 250 символов")
            payload[key] = value.strip()
        elif key in ("notes", "description"):
            if not isinstance(value, str) or len(value) > 20000:
                raise HTTPException(422, f"Некорректное поле {key}")
        elif key in ("unit", "recurrence"):
            if not isinstance(value, str) or len(value) > 120:
                raise HTTPException(422, f"Некорректное поле {key}")
        elif key == "status":
            if value not in (PROJECT_STATUS if kind == "projects" else STATUS):
                raise HTTPException(422, "Некорректный статус")
        elif key == "priority":
            if type(value) is not int or value not in (1, 2, 3, 4):
                raise HTTPException(422, "Приоритет должен быть P1–P4")
        elif key in ("important", "urgent"):
            if type(value) not in (int, bool) or value not in (0, 1, False, True):
                raise HTTPException(422, f"Некорректное поле {key}")
            payload[key] = int(value)
        elif key in ("start_value", "target_value", "current_value"):
            if type(value) not in (float, int) or abs(value) > 1e12:
                raise HTTPException(422, f"Некорректное число {key}")
        elif key == "duration_minutes":
            if type(value) is not int or not 1 <= value <= 1440:
                raise HTTPException(422, "Продолжительность от 1 до 1440 минут")
        elif key in ID_KEYS:
            if value is not None and (type(value) is not int or value < 1):
                raise HTTPException(422, f"Некорректный идентификатор {key}")
        elif key in DATETIME_KEYS:
            if value is not None:
                try:
                    if not isinstance(value, str) or len(value) > 32:
                        raise ValueError()
                    datetime.fromisoformat(value)
                except ValueError:
                    raise HTTPException(422, f"Некорректная дата и время {key}")
        elif key in DATE_KEYS:
            if value is not None:
                try:
                    if not isinstance(value, str):
                        raise ValueError()
                    date.fromisoformat(value)
                except ValueError:
                    raise HTTPException(422, f"Некорректная дата {key}")
        elif key == "emoji":
            if not isinstance(value, str) or not value.strip() or len(value) > 32:
                raise HTTPException(422, "Укажите emoji длиной до 32 символов")
        elif key == "color":
            if kind == "tasks" and (not isinstance(value, str) or value.lower() not in TASK_COLORS):
                raise HTTPException(422, "Выберите один из 8 доступных цветов задачи")
            if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
                raise HTTPException(422, "Цвет должен иметь формат #RRGGBB")
    if kind == "events" and creating and (not payload.get("starts_at") or not payload.get("ends_at")):
        raise HTTPException(422, "Нужно указать начало и окончание события")
    if kind == "events" and payload.get("starts_at") and payload.get("ends_at") and payload["starts_at"] >= payload["ends_at"]:
        raise HTTPException(422, "Окончание должно быть позднее начала")
    return payload

def fetch_one(conn: sqlite3.Connection, kind: str, item_id: int):
    row = conn.execute(f"SELECT * FROM {kind} WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Запись не найдена")
    return dict(row)

def sql_error(exc: sqlite3.IntegrityError):
    raise HTTPException(409, "Невозможно сохранить: проверьте связи и обязательные поля") from exc

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}

@app.get("/api/bootstrap")
def bootstrap():
    with connection() as conn:
        return {
            name: [dict(r) for r in conn.execute(f"SELECT * FROM {name} ORDER BY id DESC")]
            for name in FIELDS
        }

@app.post("/api/{kind}", status_code=201)
def create(kind: str, payload: dict[str, Any]):
    values = validate(kind, payload.copy(), creating=True)
    if not values:
        raise HTTPException(422, "Пустой запрос")
    cols = ", ".join(values)
    params = ", ".join("?" for _ in values)
    with connection() as conn:
        try:
            cursor = conn.execute(f"INSERT INTO {kind} ({cols}) VALUES ({params})", tuple(values.values()))
        except sqlite3.IntegrityError as exc:
            sql_error(exc)
        return fetch_one(conn, kind, cursor.lastrowid)

@app.patch("/api/{kind}/{item_id}")
def update(kind: str, item_id: int, payload: dict[str, Any]):
    values = validate(kind, payload.copy())
    with connection() as conn:
        fetch_one(conn, kind, item_id)
        if values:
            if kind == "tasks":
                values["updated_at"] = datetime.now().isoformat(timespec="seconds")
            assignments = ", ".join(f"{col} = ?" for col in values)
            try:
                conn.execute(f"UPDATE {kind} SET {assignments} WHERE id = ?", (*values.values(), item_id))
            except sqlite3.IntegrityError as exc:
                sql_error(exc)
        return fetch_one(conn, kind, item_id)

@app.delete("/api/{kind}/{item_id}", status_code=204)
def delete(kind: str, item_id: int):
    if kind not in FIELDS:
        raise HTTPException(404, "Неизвестный тип записи")
    with connection() as conn:
        fetch_one(conn, kind, item_id)
        conn.execute(f"DELETE FROM {kind} WHERE id = ?", (item_id,))
    return Response(status_code=204)

@app.get("/api/export")
def export():
    with connection() as conn:
        payload = {
            "exported_at": datetime.now().isoformat(timespec="seconds"),
            "version": 1,
            "data": {
                kind: [dict(r) for r in conn.execute(f"SELECT * FROM {kind} ORDER BY id")]
                for kind in FIELDS
            },
        }
    return JSONResponse(payload, headers={"Content-Disposition": 'attachment; filename="personalmanagement-export.json"', "Cache-Control": "no-store"})

@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    root = Path(os.environ.get("STATIC_DIR", "/app/static")).resolve()
    candidate = (root / path).resolve()
    if path.startswith("api/") or not candidate.is_relative_to(root):
        raise HTTPException(404)
    if path and candidate.is_file():
        return FileResponse(candidate)
    index = root / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"message": "Frontend is not built. Run the Vite build."}, status_code=404)
