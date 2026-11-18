import base64
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app import app


def auth():
    token = base64.b64encode(b"owner:local-test-secret").decode()
    return {"Authorization": f"Basic {token}"}


def test_entities_and_links(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "planner.db"))
    with TestClient(app) as client:
        assert client.get("/api/bootstrap").status_code == 401
        assert client.get("/api/health").json()["status"] == "ok"
        area = client.post("/api/areas", headers=auth(), json={"title": "Здоровье"}).json()
        assert area["id"]
        project = client.post("/api/projects", headers=auth(), json={"title": "Проверка здоровья", "area_id": area["id"]}).json()
        goal = client.post("/api/goals", headers=auth(), json={"title": "12 тренировок", "area_id": area["id"], "target_value": 12, "current_value": 3, "unit": "тренировок"}).json()
        task = client.post("/api/tasks", headers=auth(), json={"title": "Записаться", "area_id": area["id"], "project_id": project["id"], "goal_id": goal["id"], "important": 1, "priority": 2, "scheduled_at": "2026-11-19T09:00"}).json()
        assert task["project_id"] == project["id"]
        updated = client.patch(f'/api/tasks/{task["id"]}', headers=auth(), json={"status": "done"}).json()
        assert updated["status"] == "done"
        data = client.get("/api/bootstrap", headers=auth()).json()
        assert len(data["tasks"]) == 1
        assert len(data["goals"]) == 1
        export = client.get("/api/export", headers=auth())
        assert export.status_code == 200 and export.json()["data"]["areas"][0]["title"] == "Здоровье"
        assert client.delete(f'/api/tasks/{task["id"]}', headers=auth()).status_code == 204
        assert client.get("/api/bootstrap", headers=auth()).json()["tasks"] == []


def test_validation(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "planner2.db"))
    with TestClient(app) as client:
        assert client.post("/api/tasks", headers=auth(), json={"title": ""}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "priority": 9}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "oops": True}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "area_id": 999, "scheduled_at": "2026-11-19T09:00"}).status_code == 409
        assert client.post("/api/events", headers=auth(), json={"title": "Встреча", "starts_at": "2026-11-19T12:00", "ends_at": "2026-11-19T11:00"}).status_code == 422


def test_task_colors_and_area_emoji(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "colors.db"))
    with TestClient(app) as client:
        area = client.post("/api/areas", headers=auth(), json={"title": "Работа", "emoji": "💼"}).json()
        assert area["emoji"] == "💼"
        task = client.post("/api/tasks", headers=auth(), json={"title": "Проверить", "area_id": area["id"], "color": "#ff963b", "priority": 1, "scheduled_at": "2026-11-19T09:00"}).json()
        assert task["color"] == "#ff963b"
        assert client.patch(f'/api/tasks/{task["id"]}', headers=auth(), json={"color": "#9463d6"}).json()["color"] == "#9463d6"
        assert client.post("/api/tasks", headers=auth(), json={"title": "Нет", "color": "#123456"}).status_code == 422
        assert client.patch(f'/api/areas/{area["id"]}', headers=auth(), json={"emoji": "🏠"}).json()["emoji"] == "🏠"


def test_non_destructive_upgrade_existing_schema(tmp_path, monkeypatch):
    import sqlite3
    from app import SCHEMA
    path = tmp_path / "existing.db"
    legacy = SCHEMA.replace("emoji TEXT NOT NULL DEFAULT '📁',", "").replace("  color TEXT NOT NULL DEFAULT '#3466d9',", "")
    with sqlite3.connect(path) as conn:
        conn.executescript(legacy)
        conn.execute("INSERT INTO areas (title) VALUES (?)", ("Сохранённое направление",))
        conn.execute("INSERT INTO tasks (title) VALUES (?)", ("Сохранённая задача",))
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    with TestClient(app) as client:
        payload = client.get("/api/bootstrap", headers=auth()).json()
        assert payload["areas"][0]["title"] == "Сохранённое направление"
        assert payload["areas"][0]["emoji"] == "📁"
        assert payload["tasks"][0]["title"] == "Сохранённая задача"
        assert payload["tasks"][0]["color"] == "#3466d9"
    with TestClient(app) as client:
        assert client.get("/api/bootstrap", headers=auth()).status_code == 200


def test_task_schedule_required_and_quarter_hour_duration(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "task-rules.db"))
    with TestClient(app) as client:
        assert client.post("/api/tasks", headers=auth(), json={"title": "Без времени"}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "Без времени", "scheduled_at": None}).status_code == 422
        for minutes in (15, 29, 31, 44, 61, 1441):
            response = client.post("/api/tasks", headers=auth(), json={
                "title": "Недопустимая длительность", "scheduled_at": "2026-11-20T10:00", "duration_minutes": minutes
            })
            assert response.status_code == 422, (minutes, response.text)
        for minutes in (30, 45, 60, 75, 1440):
            response = client.post("/api/tasks", headers=auth(), json={
                "title": "Длительность", "scheduled_at": "2026-11-20T10:00", "duration_minutes": minutes
            })
            assert response.status_code == 201, (minutes, response.text)
        task = client.post("/api/tasks", headers=auth(), json={
            "title": "Запланированная", "scheduled_at": "2026-11-20T10:00", "duration_minutes": 30
        }).json()
        assert client.patch(f'/api/tasks/{task["id"]}', headers=auth(), json={"scheduled_at": None}).status_code == 422
        assert client.patch(f'/api/tasks/{task["id"]}', headers=auth(), json={"duration_minutes": 45}).json()["duration_minutes"] == 45


def test_existing_unscheduled_tasks_remain_accessible(tmp_path, monkeypatch):
    # Older imported/seeded tasks with no time must not disappear or become undeletable.
    import sqlite3
    from app import SCHEMA
    path = tmp_path / "legacy-tasks.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.execute("INSERT INTO tasks (title) VALUES (?)", ("Старая без даты",))
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH", str(path))
    with TestClient(app) as client:
        old = client.get("/api/bootstrap", headers=auth()).json()["tasks"][0]
        assert old["scheduled_at"] is None
        assert client.patch(f'/api/tasks/{old["id"]}', headers=auth(), json={"status": "done"}).status_code == 200
        assert client.delete(f'/api/tasks/{old["id"]}', headers=auth()).status_code == 204
