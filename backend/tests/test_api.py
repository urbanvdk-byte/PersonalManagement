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
        task = client.post("/api/tasks", headers=auth(), json={"title": "Записаться", "area_id": area["id"], "project_id": project["id"], "goal_id": goal["id"], "important": 1, "priority": 2}).json()
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
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "area_id": 999}).status_code == 409
        assert client.post("/api/events", headers=auth(), json={"title": "Встреча", "starts_at": "2026-11-19T12:00", "ends_at": "2026-11-19T11:00"}).status_code == 422
