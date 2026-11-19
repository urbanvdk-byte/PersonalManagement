from datetime import datetime
from zoneinfo import ZoneInfo
import json
import os
from telegram_digest import report,process
from app import connection,setup

def test_telegram_previews_and_idempotency(tmp_path,monkeypatch):
    monkeypatch.setenv("DATABASE_PATH",str(tmp_path/"telegram.db"))
    monkeypatch.setenv("APP_PASSWORD","testing")
    setup()
    with connection() as conn:
        conn.execute("""INSERT INTO tasks(title,priority,status,scheduled_at,duration_minutes)
                        VALUES ('Важное дело',1,'planned','2026-11-20T09:00',60)""")
        conn.execute("""INSERT INTO tasks(title,priority,status,scheduled_at,duration_minutes)
                        VALUES ('Ещё одно',2,'planned','2026-11-20T12:00',45)""")
        conn.execute("""INSERT INTO events(title,starts_at,ends_at)
                        VALUES ('Встреча','2026-11-20T11:00','2026-11-20T12:00')""")
        now=datetime(2026,11,20,8,0,tzinfo=ZoneInfo("Europe/Moscow"))
        key,morning=report(conn,"morning",now)
        assert key=="morning:2026-11-20"
        assert "Важное дело" in morning and "Встреча" in morning and "Загрузка" in morning
        _,evening=report(conn,"evening",now)
        assert "Итоги" in evening
        reminder,_=report(conn,"reminders",datetime(2026,11,20,8,46,tzinfo=ZoneInfo("Europe/Moscow")))
        assert "Важное дело" in reminder
    assert process("morning",now,True)
    # No outbound request unless explicitly configured; sent rows suppress duplicates.
    with connection() as conn:
        conn.execute("INSERT INTO telegram_sent(message_key) VALUES (?)",("morning:2026-11-20",))
    assert process("morning",now,False)==[]
