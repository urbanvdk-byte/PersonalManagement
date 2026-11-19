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
CREATE TABLE IF NOT EXISTS project_areas (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id,area_id)
);
CREATE INDEX IF NOT EXISTS idx_project_areas_area ON project_areas(area_id);
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
  recurrence_until TEXT,
  color TEXT NOT NULL DEFAULT '#3466d9',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS task_occurrences (
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  changes TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (task_id,occurrence_date)
);
CREATE INDEX IF NOT EXISTS idx_occurrences_task ON task_occurrences(task_id);
CREATE TABLE IF NOT EXISTS task_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN(0,1)),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0 CHECK(done IN(0,1)),
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  happened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS telegram_sent (
  message_key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    "projects": {"area_id", "area_ids", "title", "description", "status", "start_date", "due_date"},
    "goals": {"area_id", "project_id", "title", "description", "period_start", "period_end", "start_value", "target_value", "current_value", "unit"},
    "tasks": {"area_id", "project_id", "goal_id", "parent_id", "title", "notes", "priority", "important", "urgent", "status", "scheduled_at", "due_at", "duration_minutes", "recurrence", "recurrence_until", "color"},
    "events": {"area_id", "project_id", "title", "notes", "starts_at", "ends_at", "color"},
}
STATUS = {"inbox", "planned", "in_progress", "waiting", "done", "someday", "cancelled"}
PROJECT_STATUS = {"active", "paused", "done", "archived"}
RECURRENCES = {"", "daily", "weekly", "monthly", "yearly"}
OCCURRENCE_FIELDS = {"title", "notes", "priority", "important", "urgent", "status",
                     "scheduled_at", "due_at", "duration_minutes", "color", "area_id",
                     "project_id", "goal_id"}
TASK_COLORS = {"#3466d9", "#16a2dc", "#12aaa1", "#39aa6f", "#e4b636", "#ff963b", "#e7635e", "#9463d6"}
DATETIME_KEYS = {"scheduled_at", "due_at", "starts_at", "ends_at"}
DATE_KEYS = {"start_date", "due_date", "period_start", "period_end", "recurrence_until"}
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

def record_activity(conn:sqlite3.Connection,project_id:int|None,message:str)->None:
    if project_id is not None:
        conn.execute("INSERT INTO activity_log(project_id,message) VALUES (?,?)",
                     (project_id,message[:300]))

def extra_data(conn:sqlite3.Connection)->dict[str,list[dict]]:
    return {
        "checklist":[dict(r) for r in conn.execute("SELECT * FROM task_checklist ORDER BY position,id")],
        "milestones":[dict(r) for r in conn.execute("SELECT * FROM project_milestones ORDER BY position,id")],
        "activity":[dict(r) for r in conn.execute("SELECT * FROM activity_log ORDER BY id DESC LIMIT 500")],
    }

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
            ("tasks", "recurrence_until", "TEXT"),
        ):
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if column not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
        # Preserve the former project's single area association.
        conn.execute("""INSERT OR IGNORE INTO project_areas(project_id,area_id)
                        SELECT id,area_id FROM projects WHERE area_id IS NOT NULL""")

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
        elif key == "recurrence":
            if not isinstance(value,str) or value not in RECURRENCES:
                raise HTTPException(422, "Повторение: ежедневно, еженедельно, ежемесячно или ежегодно")
        elif key == "unit":
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
            if type(value) is not int or not 30 <= value <= 1440 or value % 15:
                raise HTTPException(422, "Продолжительность: от 30 до 1440 минут, шаг 15 минут")
        elif key == "area_ids":
            if kind != "projects" or not isinstance(value,list) or len(value)>100 or any(type(area_id) is not int or area_id<1 for area_id in value) or len(value)!=len(set(value)):
                raise HTTPException(422, "Направления проекта должны быть уникальными идентификаторами")
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
    if kind == "tasks":
        # Only newly created tasks must always have a schedule. Existing legacy
        # unscheduled tasks remain readable and can be marked done or deleted.
        if "scheduled_at" in payload and payload["scheduled_at"] == "":
            raise HTTPException(422, "Неверный формат времени — оставьте поле пустым или заполните полностью")
        if payload.get("recurrence") and not payload.get("scheduled_at") and creating:
            raise HTTPException(422, "Для повторяющейся задачи нужно назначить дату и время")
    if kind == "events" and creating and (not payload.get("starts_at") or not payload.get("ends_at")):
        raise HTTPException(422, "Нужно указать начало и окончание события")
    if kind == "events" and payload.get("starts_at") and payload.get("ends_at") and payload["starts_at"] >= payload["ends_at"]:
        raise HTTPException(422, "Окончание должно быть позднее начала")
    return payload

def project_with_areas(conn:sqlite3.Connection,row:dict):
    row["area_ids"]=[r["area_id"] for r in conn.execute(
        "SELECT area_id FROM project_areas WHERE project_id=? ORDER BY area_id",(row["id"],))]
    return row

def validate_task_schedule(conn:sqlite3.Connection,values:dict,prior:dict|None=None):
    combined={**(prior or {}),**values}
    if combined.get("recurrence") and not combined.get("scheduled_at"):
        raise HTTPException(422,"Для повторяющейся задачи нужна дата и время")

def fetch_one(conn: sqlite3.Connection, kind: str, item_id: int):
    row = conn.execute(f"SELECT * FROM {kind} WHERE id = ?", (item_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Запись не найдена")
    data=dict(row)
    return project_with_areas(conn,data) if kind=="projects" else data

def sql_error(exc: sqlite3.IntegrityError):
    raise HTTPException(409, "Невозможно сохранить: проверьте связи и обязательные поля") from exc

@app.get("/api/health")
def health():
    return {"status": "ok", "version": "0.1.0"}

@app.get("/api/bootstrap")
def bootstrap():
    with connection() as conn:
        data = {
            name: [dict(r) for r in conn.execute(f"SELECT * FROM {name} ORDER BY id DESC")]
            for name in FIELDS
        }
        data["projects"]=[project_with_areas(conn,row) for row in data["projects"]]
        data.update(extra_data(conn))
        data["occurrences"] = [
            {"task_id":r["task_id"],"occurrence_date":r["occurrence_date"],
             "changes":json.loads(r["changes"])}
            for r in conn.execute("SELECT * FROM task_occurrences ORDER BY occurrence_date")
        ]
        return data

@app.post("/api/{kind}", status_code=201)
def create(kind: str, payload: dict[str, Any]):
    values = validate(kind, payload.copy(), creating=True)
    if not values:
        raise HTTPException(422, "Пустой запрос")
    areas=values.pop("area_ids",None) if kind=="projects" else None
    if kind=="projects" and areas is not None:
        values["area_id"]=areas[0] if areas else None
    cols = ", ".join(values)
    params = ", ".join("?" for _ in values)
    with connection() as conn:
        if kind=="tasks":validate_task_schedule(conn,values)
        try:
            cursor = conn.execute(f"INSERT INTO {kind} ({cols}) VALUES ({params})", tuple(values.values()))
            if kind=="projects":
                for area_id in (areas if areas is not None else ([values["area_id"]] if values.get("area_id") else [])):
                    conn.execute("INSERT INTO project_areas(project_id,area_id) VALUES (?,?)",(cursor.lastrowid,area_id))
            project_id=cursor.lastrowid if kind=="projects" else values.get("project_id")
            record_activity(conn,project_id,"Создано: "+str(values.get("title","")))
        except sqlite3.IntegrityError as exc:
            sql_error(exc)
        return fetch_one(conn, kind, cursor.lastrowid)

@app.patch("/api/{kind}/{item_id}")
def update(kind: str, item_id: int, payload: dict[str, Any]):
    values = validate(kind, payload.copy())
    areas=values.pop("area_ids",None) if kind=="projects" else None
    if kind=="projects" and areas is not None:
        values["area_id"]=areas[0] if areas else None
    with connection() as conn:
        previous=fetch_one(conn,kind,item_id)
        if kind=="tasks":validate_task_schedule(conn,values,previous)
        if values or areas is not None:
            if kind == "tasks":
                values["updated_at"] = datetime.now().isoformat(timespec="seconds")
            try:
                if values:
                    assignments = ", ".join(f"{col} = ?" for col in values)
                    conn.execute(f"UPDATE {kind} SET {assignments} WHERE id = ?", (*values.values(), item_id))
                if kind=="projects" and (areas is not None or "area_id" in values):
                    selected=areas if areas is not None else ([values["area_id"]] if values.get("area_id") else [])
                    conn.execute("DELETE FROM project_areas WHERE project_id=?",(item_id,))
                    for area_id in selected:
                        conn.execute("INSERT INTO project_areas(project_id,area_id) VALUES (?,?)",(item_id,area_id))
                target=item_id if kind=="projects" else values.get("project_id",previous.get("project_id"))
                record_activity(conn,target,"Обновлено: "+str(values.get("title",previous.get("title",""))))
            except sqlite3.IntegrityError as exc:
                sql_error(exc)
        return fetch_one(conn, kind, item_id)

@app.delete("/api/{kind}/{item_id}", status_code=204)
def delete(kind: str, item_id: int):
    if kind not in FIELDS:
        raise HTTPException(404, "Неизвестный тип записи")
    with connection() as conn:
        previous=fetch_one(conn, kind, item_id)
        conn.execute(f"DELETE FROM {kind} WHERE id = ?", (item_id,))
        if kind!="projects":
            record_activity(conn,previous.get("project_id"),"Удалено: "+previous["title"])
    return Response(status_code=204)


# Individual overrides belong to one occurrence, not the master task. The
# occurrence_date always identifies the original date, even after a drag move.
def series_at(task:dict, key:str):
    try:
        target=date.fromisoformat(key)
        first=date.fromisoformat(str(task["scheduled_at"])[:10])
    except (TypeError,ValueError):
        return False
    if target<first or task.get("recurrence_until") and key>task["recurrence_until"]:
        return False
    rule=task["recurrence"]
    if rule not in RECURRENCES-{"",}:
        return False
    if rule=="daily":return True
    if rule=="weekly":return (target-first).days%7==0
    if rule=="monthly":
        import calendar
        return target.day==min(first.day,calendar.monthrange(target.year,target.month)[1])
    if rule=="yearly":
        import calendar
        day=28 if first.month==2 and first.day==29 and not calendar.isleap(target.year) else first.day
        return target.month==first.month and target.day==day
    return False

def series_task(conn:sqlite3.Connection, task_id:int, day:str):
    task=fetch_one(conn,"tasks",task_id)
    if not series_at(task,day):
        raise HTTPException(422,"Дата не относится к выбранной серии")
    return task

@app.put("/api/task-occurrences/{task_id}/{day}")
def put_occurrence(task_id:int,day:str,payload:dict[str,Any]):
    raw=payload.get("changes")
    if not isinstance(raw,dict) or set(payload)!={"changes"} or set(raw)-OCCURRENCE_FIELDS:
        raise HTTPException(422,"Некорректные изменения повторения")
    changes=validate("tasks",raw.copy())
    with connection() as conn:
        series_task(conn,task_id,day)
        # Merge sparse changes, preventing a second edit from losing an earlier one.
        previous=conn.execute("SELECT changes FROM task_occurrences WHERE task_id=? AND occurrence_date=?",
                              (task_id,day)).fetchone()
        combined={**(json.loads(previous["changes"]) if previous else {}),**changes}
        conn.execute("""INSERT INTO task_occurrences (task_id,occurrence_date,changes)
                        VALUES (?,?,?) ON CONFLICT(task_id,occurrence_date)
                        DO UPDATE SET changes=excluded.changes""",
                     (task_id,day,json.dumps(combined,ensure_ascii=False)))
        return {"task_id":task_id,"occurrence_date":day,"changes":combined}

@app.delete("/api/task-occurrences/{task_id}/{day}",status_code=204)
def reset_occurrence(task_id:int,day:str):
    with connection() as conn:
        series_task(conn,task_id,day)
        conn.execute("DELETE FROM task_occurrences WHERE task_id=? AND occurrence_date=?",(task_id,day))
    return Response(status_code=204)

@app.post("/api/task-series/{task_id}/split",status_code=201)
def split_series(task_id:int,payload:dict[str,Any]):
    day=payload.get("occurrence_date")
    raw=payload.get("changes",{})
    if not isinstance(day,str) or not isinstance(raw,dict) or set(payload)-{"occurrence_date","changes"}:
        raise HTTPException(422,"Некорректное разделение серии")
    if set(raw)-FIELDS["tasks"]:
        raise HTTPException(422,"Неизвестные поля серии")
    changes=validate("tasks",raw.copy())
    if "recurrence_until" in changes and changes["recurrence_until"] and changes["recurrence_until"]<day:
        raise HTTPException(422,"Окончание серии раньше начала")
    with connection() as conn:
        original=series_task(conn,task_id,day)
        if day==original["scheduled_at"][:10]:
            raise HTTPException(422,"Для первого повторения редактируйте всю серию")
        current=conn.execute("SELECT changes FROM task_occurrences WHERE task_id=? AND occurrence_date=?",
                             (task_id,day)).fetchone()
        existing=json.loads(current["changes"]) if current else {}
        fields={field:original[field] for field in FIELDS["tasks"]}
        fields.update({"scheduled_at":day+original["scheduled_at"][10:]})
        fields.update(existing)
        fields.update(changes)
        # An occurrence's override may say done; a new series starts active.
        if fields.get("status") in {"done","cancelled"} and "status" not in changes:
            fields["status"]="planned"
        fields=validate("tasks",fields,creating=True)
        cols=", ".join(fields)
        values=", ".join("?" for _ in fields)
        try:
            cur=conn.execute(f"INSERT INTO tasks ({cols}) VALUES ({values})",tuple(fields.values()))
            new_id=cur.lastrowid
            stop=(date.fromisoformat(day)-__import__("datetime").timedelta(days=1)).isoformat()
            conn.execute("UPDATE tasks SET recurrence_until=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
                         (stop,task_id))
            conn.execute("""UPDATE task_occurrences SET task_id=?
                            WHERE task_id=? AND occurrence_date>=?""",
                         (new_id,task_id,day))
            conn.execute("DELETE FROM task_occurrences WHERE task_id=? AND occurrence_date=?",(new_id,day))
        except sqlite3.IntegrityError as exc:
            sql_error(exc)
        return fetch_one(conn,"tasks",new_id)


# Project planning resources. All writes use the existing authenticated API.
def valid_title(value:Any)->str:
    if not isinstance(value,str) or not value.strip() or len(value)>250:
        raise HTTPException(422,"Название должно содержать 1–250 символов")
    return value.strip()

def validate_done(value:Any)->int:
    if type(value) not in (int,bool) or value not in (0,1,False,True):
        raise HTTPException(422,"Некорректная отметка выполнения")
    return int(value)

def owned(conn:sqlite3.Connection,table:str,id:int,parent_field:str,parent_id:int)->dict:
    record=conn.execute(f"SELECT * FROM {table} WHERE id=? AND {parent_field}=?",(id,parent_id)).fetchone()
    if not record:raise HTTPException(404,"Запись не найдена")
    return dict(record)

@app.post("/api/tasks/{task_id}/checklist",status_code=201)
def add_checklist(task_id:int,payload:dict[str,Any]):
    if set(payload)!={"title"}:raise HTTPException(422,"Укажите название пункта")
    title=valid_title(payload["title"])
    with connection() as conn:
        task=fetch_one(conn,"tasks",task_id)
        pos=conn.execute("SELECT COALESCE(MAX(position),0)+1 FROM task_checklist WHERE task_id=?",(task_id,)).fetchone()[0]
        cur=conn.execute("INSERT INTO task_checklist(task_id,title,position) VALUES (?,?,?)",(task_id,title,pos))
        record_activity(conn,task["project_id"],"Чек-лист: "+title)
        return dict(conn.execute("SELECT * FROM task_checklist WHERE id=?",(cur.lastrowid,)).fetchone())

@app.patch("/api/tasks/{task_id}/checklist/{item_id}")
def edit_checklist(task_id:int,item_id:int,payload:dict[str,Any]):
    if not payload or set(payload)-{"title","done"}:raise HTTPException(422,"Некорректные поля пункта")
    values={k:(valid_title(v) if k=="title" else validate_done(v)) for k,v in payload.items()}
    with connection() as conn:
        task=fetch_one(conn,"tasks",task_id)
        prev=owned(conn,"task_checklist",item_id,"task_id",task_id)
        conn.execute("UPDATE task_checklist SET "+",".join(f"{k}=?" for k in values)+" WHERE id=?",
                     (*values.values(),item_id))
        record_activity(conn,task["project_id"],("✓ " if values.get("done")==1 else "Изменён пункт: ")+prev["title"])
        return dict(conn.execute("SELECT * FROM task_checklist WHERE id=?",(item_id,)).fetchone())

@app.delete("/api/tasks/{task_id}/checklist/{item_id}",status_code=204)
def remove_checklist(task_id:int,item_id:int):
    with connection() as conn:
        task=fetch_one(conn,"tasks",task_id)
        prev=owned(conn,"task_checklist",item_id,"task_id",task_id)
        conn.execute("DELETE FROM task_checklist WHERE id=?",(item_id,))
        record_activity(conn,task["project_id"],"Удалён пункт: "+prev["title"])
    return Response(status_code=204)

@app.post("/api/projects/{project_id}/milestones",status_code=201)
def add_milestone(project_id:int,payload:dict[str,Any]):
    if set(payload)-{"title","due_date"} or "title" not in payload:raise HTTPException(422,"Некорректные поля этапа")
    title=valid_title(payload["title"])
    due=payload.get("due_date")
    if due is not None:
        try:
            if date.fromisoformat(due).isoformat()!=due:raise ValueError()
        except (ValueError,TypeError):raise HTTPException(422,"Неверная дата")
    with connection() as conn:
        fetch_one(conn,"projects",project_id)
        pos=conn.execute("SELECT COALESCE(MAX(position),0)+1 FROM project_milestones WHERE project_id=?",(project_id,)).fetchone()[0]
        cur=conn.execute("INSERT INTO project_milestones(project_id,title,due_date,position) VALUES (?,?,?,?)",(project_id,title,due,pos))
        record_activity(conn,project_id,"Новый этап: "+title)
        return dict(conn.execute("SELECT * FROM project_milestones WHERE id=?",(cur.lastrowid,)).fetchone())

@app.patch("/api/projects/{project_id}/milestones/{item_id}")
def edit_milestone(project_id:int,item_id:int,payload:dict[str,Any]):
    if not payload or set(payload)-{"title","due_date","done"}:raise HTTPException(422,"Некорректные поля этапа")
    values={}
    for key,value in payload.items():
        if key=="title":values[key]=valid_title(value)
        elif key=="done":values[key]=validate_done(value)
        else:
            if value is not None:
                try:
                    if date.fromisoformat(value).isoformat()!=value:raise ValueError()
                except (ValueError,TypeError):raise HTTPException(422,"Неверная дата")
            values[key]=value
    with connection() as conn:
        fetch_one(conn,"projects",project_id)
        prev=owned(conn,"project_milestones",item_id,"project_id",project_id)
        conn.execute("UPDATE project_milestones SET "+",".join(f"{k}=?" for k in values)+" WHERE id=?",
                     (*values.values(),item_id))
        record_activity(conn,project_id,("Этап выполнен: " if values.get("done")==1 else "Этап изменён: ")+prev["title"])
        return dict(conn.execute("SELECT * FROM project_milestones WHERE id=?",(item_id,)).fetchone())

@app.delete("/api/projects/{project_id}/milestones/{item_id}",status_code=204)
def remove_milestone(project_id:int,item_id:int):
    with connection() as conn:
        fetch_one(conn,"projects",project_id)
        prev=owned(conn,"project_milestones",item_id,"project_id",project_id)
        conn.execute("DELETE FROM project_milestones WHERE id=?",(item_id,))
        record_activity(conn,project_id,"Этап удалён: "+prev["title"])
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
        payload["data"]["projects"]=[project_with_areas(conn,row) for row in payload["data"]["projects"]]
        payload["data"].update(extra_data(conn))
        payload["data"]["occurrences"]=[
            {"task_id":r["task_id"],"occurrence_date":r["occurrence_date"],
             "changes":json.loads(r["changes"])}
            for r in conn.execute("SELECT * FROM task_occurrences ORDER BY occurrence_date")
        ]
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
