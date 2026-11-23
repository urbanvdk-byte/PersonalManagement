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
        without_time = client.post("/api/tasks", headers=auth(), json={"title": "Без времени", "status": "inbox"})
        assert without_time.status_code == 201 and without_time.json()["scheduled_at"] is None
        assert client.post("/api/tasks", headers=auth(), json={"title": "Без времени", "scheduled_at": None}).status_code == 201
        assert client.post("/api/tasks", headers=auth(), json={"title": "Повтор без времени", "recurrence": "daily"}).status_code == 422
        assert client.patch(f'/api/tasks/{without_time.json()["id"]}', headers=auth(), json={"recurrence": "weekly"}).status_code == 422
        assert client.patch(f'/api/tasks/{without_time.json()["id"]}', headers=auth(), json={"scheduled_at": "2026-11-20T08:00", "recurrence": "weekly"}).status_code == 200
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
        assert client.patch(f'/api/tasks/{task["id"]}', headers=auth(), json={"scheduled_at": None}).status_code == 200
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


def test_recurrence_validation_and_sparse_exceptions(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"recurrence.db"))
    with TestClient(app) as client:
        assert client.post("/api/tasks",headers=auth(),json={"title":"Invalid","scheduled_at":"2026-11-16T10:00","recurrence":"sometimes"}).status_code==422
        task=client.post("/api/tasks",headers=auth(),json={"title":"Повтор","scheduled_at":"2026-11-16T10:00",
                       "recurrence":"weekly","recurrence_until":"2027-02-01"}).json()
        assert task["recurrence"]=="weekly"
        path=f'/api/task-occurrences/{task["id"]}/2026-11-23'
        assert client.put(path,headers=auth(),json={"changes":{"status":"done"}}).status_code==200
        assert client.put(path,headers=auth(),json={"changes":{"duration_minutes":45}}).json()["changes"]=={"status":"done","duration_minutes":45}
        assert client.put(f'/api/task-occurrences/{task["id"]}/2026-11-24',headers=auth(),json={"changes":{"status":"done"}}).status_code==422
        assert client.put(path,headers=auth(),json={"changes":{"recurrence":"daily"}}).status_code==422
        data=client.get("/api/bootstrap",headers=auth()).json()
        assert len(data["tasks"])==1
        assert data["occurrences"][0]["changes"]["status"]=="done"
        assert "occurrences" in client.get("/api/export",headers=auth()).json()["data"]
        assert client.delete(path,headers=auth()).status_code==204
        assert client.get("/api/bootstrap",headers=auth()).json()["occurrences"]==[]

def test_split_series_moves_future_exceptions_without_creating_all_occurrences(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"split.db"))
    with TestClient(app) as client:
        task=client.post("/api/tasks",headers=auth(),json={"title":"Серия","scheduled_at":"2026-01-31T09:00",
                         "recurrence":"monthly"}).json()
        client.put(f'/api/task-occurrences/{task["id"]}/2026-04-30',headers=auth(),json={"changes":{"status":"done"}})
        new=client.post(f'/api/task-series/{task["id"]}/split',headers=auth(),json={
            "occurrence_date":"2026-03-31","changes":{"title":"Новый этап","scheduled_at":"2026-03-31T11:00"}}).json()
        assert new["id"]!=task["id"]
        assert new["recurrence"]=="monthly"
        assert new["scheduled_at"]=="2026-03-31T11:00"
        data=client.get("/api/bootstrap",headers=auth()).json()
        original=next(t for t in data["tasks"] if t["id"]==task["id"])
        assert original["recurrence_until"]=="2026-03-30"
        assert len(data["tasks"])==2
        assert data["occurrences"][0]["task_id"]==new["id"]
        assert client.delete(f'/api/tasks/{new["id"]}',headers=auth()).status_code==204
        assert client.get("/api/bootstrap",headers=auth()).json()["occurrences"]==[]

def test_recurrence_migration_preserves_legacy_task(tmp_path,monkeypatch):
    import sqlite3
    from app import SCHEMA
    path=tmp_path/"before-repeat.db"
    legacy=SCHEMA.replace("  recurrence_until TEXT,\n","")
    with sqlite3.connect(path) as conn:
        conn.executescript(legacy)
        conn.execute("INSERT INTO tasks (title,scheduled_at) VALUES (?,?)",("Старая","2026-11-19T10:00"))
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(path))
    with TestClient(app) as client:
        t=client.get("/api/bootstrap",headers=auth()).json()["tasks"][0]
        assert t["title"]=="Старая" and t["recurrence_until"] is None


def test_multiple_project_directions_and_related_entities(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"projects.db"))
    with TestClient(app) as client:
        a=client.post("/api/areas",headers=auth(),json={"title":"Работа"}).json()["id"]
        b=client.post("/api/areas",headers=auth(),json={"title":"Здоровье"}).json()["id"]
        proj=client.post("/api/projects",headers=auth(),json={"title":"Семейный проект","area_ids":[a,b]}).json()
        assert proj["area_ids"]==[a,b]
        assert proj["area_id"]==a
        task=client.post("/api/tasks",headers=auth(),json={"title":"Без расписания","project_id":proj["id"]}).json()
        goal=client.post("/api/goals",headers=auth(),json={"title":"Измеримый результат","project_id":proj["id"]}).json()
        event=client.post("/api/events",headers=auth(),json={"title":"Встреча","project_id":proj["id"],"starts_at":"2026-12-01T10:00","ends_at":"2026-12-01T11:00"}).json()
        assert task["scheduled_at"] is None
        assert client.get("/api/bootstrap",headers=auth()).json()["projects"][0]["area_ids"]==[a,b]
        assert client.get("/api/export",headers=auth()).json()["data"]["projects"][0]["area_ids"]==[a,b]
        changed=client.patch(f'/api/projects/{proj["id"]}',headers=auth(),json={"area_ids":[b]}).json()
        assert changed["area_ids"]==[b] and changed["area_id"]==b
        assert client.patch(f'/api/projects/{proj["id"]}',headers=auth(),json={"area_ids":[]}).json()["area_ids"]==[]
        assert client.post("/api/projects",headers=auth(),json={"title":"Дубли","area_ids":[a,a]}).status_code==422
        assert client.post("/api/projects",headers=auth(),json={"title":"Несуществующее","area_ids":[999]}).status_code==409
        assert client.delete(f'/api/projects/{proj["id"]}',headers=auth()).status_code==204
        result=client.get("/api/bootstrap",headers=auth()).json()
        assert next(t for t in result["tasks"] if t["id"]==task["id"])["project_id"] is None
        assert next(t for t in result["goals"] if t["id"]==goal["id"])["project_id"] is None
        assert next(t for t in result["events"] if t["id"]==event["id"])["project_id"] is None

def test_legacy_project_area_migration_preserves_links(tmp_path,monkeypatch):
    import sqlite3
    from app import SCHEMA
    path=tmp_path/"old-projects.db"
    original=SCHEMA.replace("""CREATE TABLE IF NOT EXISTS project_areas (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id,area_id)
);
CREATE INDEX IF NOT EXISTS idx_project_areas_area ON project_areas(area_id);
""","")
    with sqlite3.connect(path) as db:
        db.executescript(original)
        area=db.execute("INSERT INTO areas(title) VALUES (?)",("Старая сфера",)).lastrowid
        db.execute("INSERT INTO projects(title,area_id) VALUES (?,?)",("Старый проект",area))
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(path))
    with TestClient(app) as client:
        record=client.get("/api/bootstrap",headers=auth()).json()["projects"][0]
        assert record["title"]=="Старый проект"
        assert record["area_ids"]==[area]
        updated=client.patch(f'/api/projects/{record["id"]}',headers=auth(),json={"area_ids":[]}).json()
        assert updated["area_ids"]==[] and updated["area_id"] is None
    with TestClient(app) as client:
        assert client.get("/api/bootstrap",headers=auth()).json()["projects"][0]["area_ids"]==[]


def test_project_milestones_checklist_activity_and_cascade(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"extras.db"))
    with TestClient(app) as client:
        project=client.post("/api/projects",headers=auth(),json={"title":"Проект"}).json()
        task=client.post("/api/tasks",headers=auth(),json={"title":"Подготовить","project_id":project["id"]}).json()
        base=f'/api/tasks/{task["id"]}/checklist'
        item=client.post(base,headers=auth(),json={"title":"Проверить"}).json()
        assert item["done"]==0
        assert client.post(base,headers=auth(),json={"title":""}).status_code==422
        done=client.patch(base+f'/{item["id"]}',headers=auth(),json={"done":1}).json()
        assert done["done"]==1
        assert client.patch(base+"/999",headers=auth(),json={"done":1}).status_code==404
        milestone=f'/api/projects/{project["id"]}/milestones'
        goal=client.post(milestone,headers=auth(),json={"title":"Этап 1","due_date":"2026-12-18"}).json()
        assert goal["due_date"]=="2026-12-18"
        assert client.patch(milestone+f'/{goal["id"]}',headers=auth(),json={"done":1}).json()["done"]==1
        assert client.post(milestone,headers=auth(),json={"title":"Не дата","due_date":"2026-13-99"}).status_code==422
        data=client.get("/api/bootstrap",headers=auth()).json()
        assert any(item["task_id"]==task["id"] for item in data["checklist"])
        assert any(item["project_id"]==project["id"] for item in data["milestones"])
        assert any(item["project_id"]==project["id"] for item in data["activity"])
        assert "checklist" in client.get("/api/export",headers=auth()).json()["data"]
        assert client.delete(base+f'/{item["id"]}',headers=auth()).status_code==204
        assert client.delete(milestone+f'/{goal["id"]}',headers=auth()).status_code==204
        assert client.delete(f'/api/projects/{project["id"]}',headers=auth()).status_code==204
        data=client.get("/api/bootstrap",headers=auth()).json()
        assert not any(a["project_id"]==project["id"] for a in data["activity"])
        assert not any(m["project_id"]==project["id"] for m in data["milestones"])


def test_partial_event_update_rejects_invalid_interval(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"event-update.db"))
    with TestClient(app) as client:
        event=client.post("/api/events",headers=auth(),json={
            "title":"Встреча","starts_at":"2026-11-23T10:00","ends_at":"2026-11-23T11:00"
        }).json()
        address=f'/api/events/{event["id"]}'
        assert client.patch(address,headers=auth(),json={"starts_at":"2026-11-23T12:00"}).status_code==422
        assert client.patch(address,headers=auth(),json={"ends_at":"2026-11-23T09:00"}).status_code==422
        assert client.patch(address,headers=auth(),json={"starts_at":"2026-11-23T09:30"}).status_code==200
        remaining=client.get("/api/bootstrap",headers=auth()).json()["events"][0]
        assert remaining["starts_at"]=="2026-11-23T09:30" and remaining["ends_at"]=="2026-11-23T11:00"


def test_concurrent_tab_revision_rejects_stale_edits_and_delete(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"revisions.db"))
    with TestClient(app) as client:
        task=client.post("/api/tasks",headers=auth(),json={"title":"До изменения"}).json()
        assert task["revision"]==1
        path=f'/api/tasks/{task["id"]}'
        first={**auth(),"If-Match":str(task["revision"])}
        updated=client.patch(path,headers=first,json={"title":"Первая вкладка"}).json()
        assert updated["revision"]==2
        assert client.patch(path,headers=first,json={"title":"Вторая вкладка"}).status_code==409
        assert client.delete(path,headers=first).status_code==409
        assert client.get("/api/bootstrap",headers=auth()).json()["tasks"][0]["title"]=="Первая вкладка"
        assert client.delete(path,headers={**auth(),"If-Match":"2"}).status_code==204


def test_recurrence_override_advances_master_revision(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"occ-revisions.db"))
    with TestClient(app) as client:
        task=client.post("/api/tasks",headers=auth(),json={
            "title":"Повтор","scheduled_at":"2026-11-23T09:00","recurrence":"daily"
        }).json()
        path=f'/api/task-occurrences/{task["id"]}/2026-11-24'
        first={**auth(),"If-Match":str(task["revision"])}
        assert client.put(path,headers=first,json={"changes":{"status":"done"}}).status_code==200
        assert client.put(path,headers=first,json={"changes":{"title":"Потерянное изменение"}}).status_code==409
        changed=client.get("/api/bootstrap",headers=auth()).json()["tasks"][0]
        assert changed["revision"]==2


def test_basic_password_lockout_ignores_spoofed_forwarded_ip(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"auth.db"))
    bad={"Authorization":"Basic "+base64.b64encode(b"owner:wrong").decode()}
    with TestClient(app) as client:
        for attempt in range(4):
            response=client.get("/api/bootstrap",headers={**bad,"X-Forwarded-For":f"10.3.2.{attempt}"})
            assert response.status_code==401
        locked=client.get("/api/bootstrap",headers={**bad,"X-Forwarded-For":"10.9.9.9"})
        assert locked.status_code==429
        assert int(locked.headers["Retry-After"])>0
        assert client.get("/api/bootstrap",headers=auth()).status_code==429
        assert client.get("/api/health").status_code==200
