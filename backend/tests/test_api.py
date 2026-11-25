import base64
import os
import psycopg
from fastapi.testclient import TestClient

from app import app


def seed_legacy(schema_sql: str, inserts: list[tuple[str, tuple]]):
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for statement in schema_sql.split(";"):
            if statement.strip():
                conn.execute(statement)
        ids = []
        for sql, params in inserts:
            cursor = conn.execute(sql, params)
            if "RETURNING" in sql:
                ids.append(cursor.fetchone()[0])
        return ids


def auth():
    token = base64.b64encode(b"owner:local-test-secret").decode()
    return {"Authorization": f"Basic {token}"}


def test_entities_and_links(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
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
    with TestClient(app) as client:
        assert client.post("/api/tasks", headers=auth(), json={"title": ""}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "priority": 9}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "oops": True}).status_code == 422
        assert client.post("/api/tasks", headers=auth(), json={"title": "X", "area_id": 999, "scheduled_at": "2026-11-19T09:00"}).status_code == 409
        assert client.post("/api/events", headers=auth(), json={"title": "Встреча", "starts_at": "2026-11-19T12:00", "ends_at": "2026-11-19T11:00"}).status_code == 410


def test_task_colors_and_area_emoji(tmp_path, monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    with TestClient(app) as client:
        area = client.post("/api/areas", headers=auth(), json={"title": "Работа", "emoji": "💼"}).json()
        assert area["emoji"] == "💼"
        task = client.post("/api/tasks", headers=auth(), json={"title": "Проверить", "area_id": area["id"], "color": "#ff963b", "priority": 1, "scheduled_at": "2026-11-19T09:00"}).json()
        assert task["color"] == "#ff963b"
        assert client.patch(f'/api/tasks/{task["id"]}', headers=auth(), json={"color": "#9463d6"}).json()["color"] == "#9463d6"
        assert client.post("/api/tasks", headers=auth(), json={"title": "Нет", "color": "#123456"}).status_code == 422
        assert client.patch(f'/api/areas/{area["id"]}', headers=auth(), json={"emoji": "🏠"}).json()["emoji"] == "🏠"


def test_non_destructive_upgrade_existing_schema(tmp_path, monkeypatch):
    from app import SCHEMA
    legacy = SCHEMA.replace("emoji TEXT NOT NULL DEFAULT '📁',", "").replace("  color TEXT NOT NULL DEFAULT '#3466d9',", "")
    seed_legacy(legacy, [
        ("INSERT INTO areas (title) VALUES (%s)", ("Сохранённое направление",)),
        ("INSERT INTO tasks (title) VALUES (%s)", ("Сохранённая задача",)),
    ])
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
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
    from app import SCHEMA
    seed_legacy(SCHEMA, [
        ("INSERT INTO tasks (title) VALUES (%s)", ("Старая без даты",)),
    ])
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    with TestClient(app) as client:
        old = client.get("/api/bootstrap", headers=auth()).json()["tasks"][0]
        assert old["scheduled_at"] is None
        assert client.patch(f'/api/tasks/{old["id"]}', headers=auth(), json={"status": "done"}).status_code == 200
        assert client.delete(f'/api/tasks/{old["id"]}', headers=auth()).status_code == 204


def test_recurrence_validation_and_sparse_exceptions(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
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
    from app import SCHEMA
    legacy=SCHEMA.replace("  recurrence_until TEXT,\n","")
    seed_legacy(legacy, [
        ("INSERT INTO tasks (title,scheduled_at) VALUES (%s,%s)",("Старая","2026-11-19T10:00")),
    ])
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    with TestClient(app) as client:
        t=client.get("/api/bootstrap",headers=auth()).json()["tasks"][0]
        assert t["title"]=="Старая" and t["recurrence_until"] is None


def test_multiple_project_directions_and_related_entities(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    with TestClient(app) as client:
        a=client.post("/api/areas",headers=auth(),json={"title":"Работа"}).json()["id"]
        b=client.post("/api/areas",headers=auth(),json={"title":"Здоровье"}).json()["id"]
        proj=client.post("/api/projects",headers=auth(),json={"title":"Семейный проект","area_ids":[a,b]}).json()
        assert proj["area_ids"]==[a,b]
        assert proj["area_id"]==a
        task=client.post("/api/tasks",headers=auth(),json={"title":"Без расписания","project_id":proj["id"]}).json()
        goal=client.post("/api/goals",headers=auth(),json={"title":"Измеримый результат","project_id":proj["id"]}).json()
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

def test_legacy_project_area_migration_preserves_links(tmp_path,monkeypatch):
    from app import SCHEMA
    original=SCHEMA.replace("""CREATE TABLE IF NOT EXISTS project_areas (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  area_id INTEGER NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id,area_id)
);
CREATE INDEX IF NOT EXISTS idx_project_areas_area ON project_areas(area_id);
""","")
    seed_legacy(original, [])
    with psycopg.connect(os.environ["DATABASE_URL"]) as db:
        area=db.execute("INSERT INTO areas(title) VALUES (%s) RETURNING id",("Старая сфера",)).fetchone()[0]
        db.execute("INSERT INTO projects(title,area_id) VALUES (%s,%s)",("Старый проект",area))
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
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


def test_legacy_events_migrate_to_tasks_without_duplicates(monkeypatch):
    from app import setup, connection
    import uuid
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    setup()
    with connection() as conn:
        event=conn.execute("INSERT INTO events(title,starts_at,ends_at,done) VALUES (%s,%s,%s,1) RETURNING id",("Старая встреча","2026-11-23T10:00","2026-11-23T11:00")).fetchone()
    setup()
    setup()
    with TestClient(app) as client:
        data=client.get("/api/bootstrap",headers=auth()).json()
        assert "events" not in data
        tasks=[t for t in data["tasks"] if t["title"]=="Старая встреча"]
        assert len(tasks)==1 and tasks[0]["status"]=="done"
        assert tasks[0]["scheduled_at"]=="2026-11-23T10:00" and tasks[0]["duration_minutes"]==60
        op={"operation_id":str(uuid.uuid4()),"kind":"events","action":"save","item_id":event["id"],"values":{"done":0}}
        res=client.post("/api/offline/execute",headers={**auth(),"If-Match":"1"},json=op)
        assert res.status_code==200,res.text
        assert client.post("/api/offline/execute",headers={**auth(),"If-Match":"1"},json=op).status_code==200
        task=next(t for t in client.get("/api/bootstrap",headers=auth()).json()["tasks"] if t["id"]==tasks[0]["id"])
        assert task["status"]=="planned"
        assert client.delete(f'/api/tasks/{task["id"]}',headers={**auth(),"If-Match":str(task["revision"])}).status_code==204
        setup()
        assert not client.get("/api/bootstrap",headers=auth()).json()["tasks"]


def test_concurrent_tab_revision_rejects_stale_edits_and_delete(tmp_path,monkeypatch):
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
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

def test_offline_idempotency_and_related_records(tmp_path, monkeypatch):
    import uuid
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    with TestClient(app) as client:
        operation = {
            "operation_id": str(uuid.uuid4()), "action": "save",
            "kind": "projects", "values": {"title": "Офлайн-проект"}
        }
        first = client.post("/api/offline/execute", headers=auth(), json=operation)
        assert first.status_code == 200, first.text
        again = client.post("/api/offline/execute", headers=auth(), json=operation)
        assert again.status_code == 200 and again.json() == first.json()
        project_id = first.json()["result"]["id"]
        items = client.get("/api/bootstrap", headers=auth()).json()["projects"]
        assert len(items) == 1 and items[0]["id"] == project_id
        assert client.post("/api/offline/execute", headers=auth(), json={
            **operation, "values": {"title": "Другое"}
        }).status_code == 409

        task_op = {
            "operation_id": str(uuid.uuid4()), "action": "save", "kind": "tasks",
            "values": {"title": "Задача из офлайна", "project_id": project_id}
        }
        task_response = client.post("/api/offline/execute", headers=auth(), json=task_op)
        assert task_response.status_code == 200, task_response.text
        assert task_response.json()["result"]["project_id"] == project_id
        assert client.post("/api/offline/execute", headers=auth(), json=task_op).json() == task_response.json()

        task = task_response.json()["result"]
        changed = {
            "operation_id": str(uuid.uuid4()), "action": "save",
            "kind": "tasks", "item_id": task["id"], "values": {"status": "done"}
        }
        versioned = {**auth(), "If-Match": "1"}
        first_update = client.post("/api/offline/execute", headers=versioned, json=changed)
        assert first_update.status_code == 200, first_update.text
        assert first_update.json()["revision"] == 2
        assert client.post("/api/offline/execute", headers=versioned, json=changed).json() == first_update.json()
        assert client.post("/api/offline/execute", headers=versioned, json={
            **changed, "operation_id": str(uuid.uuid4()), "values": {"status": "waiting"}
        }).status_code == 409
        assert client.get("/api/bootstrap", headers=auth()).json()["tasks"][0]["status"] == "done"


def test_offline_replay_occurrence_and_nested_checklist_once(tmp_path, monkeypatch):
    import uuid
    monkeypatch.setenv("APP_PASSWORD", "local-test-secret")
    with TestClient(app) as client:
        task = client.post("/api/tasks", headers=auth(), json={
            "title": "Ежедневно", "recurrence": "daily",
            "scheduled_at": "2026-11-23T09:00"
        }).json()
        op = {
            "operation_id": str(uuid.uuid4()), "action": "occurrence",
            "kind": "tasks", "item_id": task["id"], "day": "2026-11-24",
            "values": {"status": "done"}
        }
        versioned = {**auth(), "If-Match": str(task["revision"])}
        initial = client.post("/api/offline/execute", headers=versioned, json=op)
        assert initial.status_code == 200, initial.text
        assert initial.json()["revision"] == 2
        assert client.post("/api/offline/execute", headers=versioned, json=op).json() == initial.json()
        assert client.get("/api/bootstrap", headers=auth()).json()["tasks"][0]["revision"] == 2

        add = {
            "operation_id": str(uuid.uuid4()), "action": "extra_add", "kind": "checklist",
            "parent_id": task["id"], "values": {"title": "Выполнить шаг"}
        }
        created = client.post("/api/offline/execute", headers=auth(), json=add)
        assert created.status_code == 200, created.text
        assert client.post("/api/offline/execute", headers=auth(), json=add).json() == created.json()
        assert len(client.get("/api/bootstrap", headers=auth()).json()["checklist"]) == 1


def test_unified_goals_and_event_completion(monkeypatch):
    from app import setup, connection
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    with TestClient(app) as client:
        project=client.post("/api/projects",headers=auth(),json={"title":"Проект"}).json()
        with connection() as conn:
            conn.execute("INSERT INTO project_milestones(project_id,title,due_date,done) VALUES (%s,%s,%s,1)",(project["id"],"Старый этап","2026-12-07"))
        setup()
        setup()
        goals=client.get("/api/bootstrap",headers=auth()).json()["goals"]
        migrated=[g for g in goals if g["title"]=="Старый этап"]
        assert len(migrated)==1
        assert migrated[0]["measurable"]==0 and migrated[0]["done"]==1
        assert migrated[0]["period_end"]=="2026-12-07"
        assert migrated[0]["project_id"]==project["id"]
        response=client.post("/api/goals",headers=auth(),json={"title":"Простая цель","project_id":project["id"],"period_end":"2026-12-08","measurable":0,"done":0})
        assert response.status_code==201,response.text
        assert response.json()["measurable"]==0
        task=client.post("/api/tasks",headers=auth(),json={"title":"Тест","scheduled_at":"2026-11-24T18:30","duration_minutes":60}).json()
        op={"operation_id":str(__import__("uuid").uuid4()),"action":"save","kind":"tasks","item_id":task["id"],"values":{"status":"done"}}
        res=client.post("/api/offline/execute",headers={**auth(),"If-Match":str(task["revision"])},json=op)
        assert res.status_code==200,res.text
        saved=next(t for t in client.get("/api/bootstrap",headers=auth()).json()["tasks"] if t["id"]==task["id"])
        assert saved["status"]=="done" and saved["scheduled_at"]==task["scheduled_at"]


def test_complete_goal_is_atomic_and_idempotent(monkeypatch):
    import uuid
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    with TestClient(app) as client:
        goal=client.post("/api/goals",headers=auth(),json={"title":"Снизить показатель","start_value":100,"target_value":80,"current_value":95}).json()
        task=client.post("/api/tasks",headers=auth(),json={"title":"Шаг к цели","goal_id":goal["id"]}).json()
        payload={"operation_id":str(uuid.uuid4()),"action":"complete_goal","kind":"tasks","item_id":task["id"],"values":{"changes":{"status":"done"},"goal_id":goal["id"],"amount":3}}
        headers={**auth(),"If-Match":"1"}
        first=client.post("/api/offline/execute",headers=headers,json=payload)
        assert first.status_code==200,first.text
        assert client.post("/api/offline/execute",headers=headers,json=payload).json()==first.json()
        data=client.get("/api/bootstrap",headers=auth()).json()
        assert data["tasks"][0]["status"]=="done"
        assert data["goals"][0]["current_value"]==92
        payload["operation_id"]=str(uuid.uuid4())
        assert client.post("/api/offline/execute",headers={**auth(),"If-Match":"2"},json=payload).status_code==409
        assert client.get("/api/bootstrap",headers=auth()).json()["goals"][0]["current_value"]==92
        second=client.post("/api/tasks",headers=auth(),json={"title":"Без вклада","goal_id":goal["id"]}).json()
        payload.update(operation_id=str(uuid.uuid4()),item_id=second["id"])
        payload["values"]["amount"]=0
        assert client.post("/api/offline/execute",headers=headers,json=payload).status_code==200
        assert client.get("/api/bootstrap",headers=auth()).json()["goals"][0]["current_value"]==92


def test_goal_contribution_reopen_and_repeat(monkeypatch):
    import uuid
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    with TestClient(app) as client:
        goal=client.post("/api/goals",headers=auth(),json={"title":"100 тренировок","start_value":0,"target_value":100,"current_value":24}).json()
        task=client.post("/api/tasks",headers=auth(),json={"title":"Тренировка","goal_id":goal["id"]}).json()
        def op(action,revision,values):
            payload={"operation_id":str(uuid.uuid4()),"action":action,"kind":"tasks","item_id":task["id"],"values":values}
            headers={**auth(),"If-Match":str(revision)}
            response=client.post("/api/offline/execute",headers=headers,json=payload)
            assert response.status_code==200,response.text
            assert client.post("/api/offline/execute",headers=headers,json=payload).json()==response.json()
            return client.get("/api/bootstrap",headers=auth()).json()
        values={"changes":{"status":"done"},"goal_id":goal["id"],"amount":1}
        data=op("complete_goal",1,values)
        assert data["goals"][0]["current_value"]==25 and data["goal_contributions"][0]["delta"]==1
        data=op("save",2,{"status":"inbox"})
        assert data["goals"][0]["current_value"]==24 and not data["goal_contributions"]
        data=op("complete_goal",3,values)
        assert data["goals"][0]["current_value"]==25
        legacy=client.post("/api/tasks",headers=auth(),json={"title":"Старое выполнение","goal_id":goal["id"],"status":"done"}).json()
        assert client.patch(f"/api/tasks/{legacy['id']}",headers={**auth(),"If-Match":str(legacy["revision"])},json={"status":"inbox"}).status_code==200
        assert client.get("/api/bootstrap",headers=auth()).json()["goals"][0]["current_value"]==25

def test_recurring_goal_contribution_isolated_and_capped(monkeypatch):
    import uuid
    monkeypatch.setenv("APP_PASSWORD","local-test-secret")
    with TestClient(app) as client:
        goal=client.post("/api/goals",headers=auth(),json={"title":"Снижение","start_value":100,"target_value":80,"current_value":84}).json()
        task=client.post("/api/tasks",headers=auth(),json={"title":"Повтор","goal_id":goal["id"],"scheduled_at":"2026-11-25T09:00","recurrence":"daily"}).json()
        def op(action,rev,day,values):
            response=client.post("/api/offline/execute",headers={**auth(),"If-Match":str(rev)},json={"operation_id":str(uuid.uuid4()),"action":action,"kind":"tasks","item_id":task["id"],"day":day,"values":values})
            assert response.status_code==200,response.text
            return client.get("/api/bootstrap",headers=auth()).json()
        values={"changes":{"status":"done"},"goal_id":goal["id"],"amount":3}
        assert op("complete_goal",1,"2026-11-25",values)["goals"][0]["current_value"]==81
        data=op("complete_goal",2,"2026-11-26",values)
        assert data["goals"][0]["current_value"]==80
        assert [x["delta"] for x in data["goal_contributions"]]==[-3,-1]
        data=op("occurrence",3,"2026-11-26",{"status":"planned"})
        assert data["goals"][0]["current_value"]==81 and len(data["goal_contributions"])==1
        data=op("reset_occurrence",4,"2026-11-25",{})
        assert data["goals"][0]["current_value"]==84 and not data["goal_contributions"]
