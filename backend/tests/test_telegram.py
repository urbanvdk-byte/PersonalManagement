from datetime import datetime
from zoneinfo import ZoneInfo
import json
from app import connection,setup
from telegram_digest import report,process,due_modes,chunks

def at(day):
    return datetime.fromisoformat(day).replace(tzinfo=ZoneInfo("Europe/Moscow"))

def test_reports_and_recurrence(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","testing")
    setup()
    with connection() as conn:
        area=conn.execute("INSERT INTO areas(title) VALUES ('Работа') RETURNING id").fetchone()["id"]
        conn.execute("""INSERT INTO tasks(title,area_id,priority,status,scheduled_at,duration_minutes)
                        VALUES ('Важное дело',%s,1,'planned','2026-11-20T09:00',60),
                               ('Завершено',%s,2,'done','2026-11-21T12:00',45)""",(area,area))
        series=conn.execute("""INSERT INTO tasks(title,priority,status,scheduled_at,duration_minutes,recurrence,recurrence_until)
                        VALUES ('Тренировка',2,'planned','2026-11-15T11:00',60,'daily','2026-11-22') RETURNING id""").fetchone()["id"]
        for day,changes in [('2026-11-15',{'scheduled_at':'2026-11-20T14:00','status':'done'}),
                            ('2026-11-16',{'status':'cancelled'}),('2026-11-17',{'status':'done'})]:
            conn.execute("INSERT INTO task_occurrences(task_id,occurrence_date,changes) VALUES (%s,%s,%s)",(series,day,json.dumps(changes)))
        conn.execute("INSERT INTO tasks(title,priority,status) VALUES ('Без времени',1,'waiting')")
        key,morning=report(conn,"morning",at("2026-11-20T08:00"))
        assert key=="morning:2026-11-20"
        assert "Важное дело" in morning and "Тренировка" in morning and "Без времени: <b>1</b>" in morning and "Из них P1: <b>1</b>" in morning
        key,weekly=report(conn,"weekly",at("2026-11-20T21:00"))
        assert key=="weekly:2026-11-16"
        assert "Запланировано: 6 · выполнено: 2 (33%)" in weekly
        assert "Работа: 1 ч 00 мин" in weekly
        assert "Сб" not in weekly and "Вс" not in weekly
        assert report(conn,"weekly",at("2026-11-22T21:00"))==(key,weekly)
        key,monthly=report(conn,"monthly",at("2026-12-01T08:05"))
        assert key=="monthly:2026-11-01" and "Цели — состояние" in monthly and "Запланировано: 9" in monthly
    assert process("morning",at("2026-11-20T08:00"),True)
    assert process("evening",at("2026-11-20T20:00"),False)==[]
    assert process("reminders",at("2026-11-20T08:00"),False)==[]

def test_send_once_and_schedule(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","testing")
    setup()
    sent=[]
    monkeypatch.setattr("telegram_digest.transmit",sent.append)
    now=at("2026-11-20T21:00")
    assert process("weekly",now,False)
    assert process("weekly",now,False)==[]
    assert len(sent)==1
    assert due_modes(at("2026-11-22T07:59"))==[]
    assert due_modes(at("2026-11-20T20:59"))==["morning"]
    assert due_modes(at("2026-11-20T21:00"))==["morning","weekly"]
    assert due_modes(at("2026-11-20T23:59"))==["morning","weekly"]
    assert due_modes(at("2026-11-22T21:00"))==["morning"]
    assert due_modes(at("2026-12-01T08:05"))==["morning","monthly"]
    assert due_modes(at("2026-12-02T20:00"))==["morning"]
    assert all(len(p.encode("utf-16-le"))//2<=3800 for p in chunks("\n".join(["😀"*100]*100)))


def test_morning_html_and_direction_emojis(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","testing")
    setup()
    with connection() as conn:
        area=conn.execute("INSERT INTO areas(title,emoji) VALUES ('Спорт','🏋️') RETURNING id").fetchone()["id"]
        project_area=conn.execute("INSERT INTO areas(title,emoji) VALUES ('Работа','💼') RETURNING id").fetchone()["id"]
        project=conn.execute("INSERT INTO projects(title,area_id) VALUES ('Проект',%s) RETURNING id",(project_area,)).fetchone()["id"]
        conn.execute("""INSERT INTO tasks(title,area_id,project_id,priority,status,scheduled_at,duration_minutes)
            VALUES ('A & <B>',%s,NULL,2,'planned','2026-11-25T12:30',120),
                   ('Видео',NULL,%s,1,'planned','2026-11-25T15:30',240),
                   ('Ужин',NULL,NULL,4,'planned','2026-11-25T18:00',180)""",(area,project))
        key,body=report(conn,"morning",at("2026-11-25T08:00"))
    assert key=="morning:2026-11-25"
    assert "Среда, 25 ноября 2026" in body
    assert "3 задач · 9 ч 00 мин" in body and "Высокая нагрузка" in body
    assert "<b>12:30</b> · 🟠 P2\n🏋️ A &amp; &lt;B&gt;" in body
    assert "<b>15:30</b> · 🔴 P1\n💼 Видео" in body
    assert "<b>18:00</b> · ⚪ P4\n📁 Ужин" in body
    assert body.count("Видео")==1 and "Главные задачи" not in body
    assert body.index("🌤 УТРО")<body.index("☀️ ДЕНЬ")<body.index("🌙 ВЕЧЕР")
    assert "https://" not in body
    delivered=[]
    monkeypatch.setattr("telegram_digest.transmit",lambda text,**kw:delivered.append((text,kw)))
    assert process("morning",at("2026-11-25T08:00"),False)
    assert delivered==[(body,{"formatted":True,"calendar_button":True})]
    assert process("morning",at("2026-11-25T08:01"),False)==[]

def test_morning_telegram_request(monkeypatch):
    from telegram_digest import transmit,URL
    import urllib.request
    import io
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN","test")
    monkeypatch.setenv("TELEGRAM_CHAT_ID","123")
    captured=[]
    def fake_open(req,timeout):
        captured.append(json.loads(req.data))
        return io.BytesIO(b'{"ok":true}')
    monkeypatch.setattr(urllib.request,"urlopen",fake_open)
    transmit("<b>План</b>",formatted=True,calendar_button=True)
    assert captured[0]["parse_mode"]=="HTML"
    assert captured[0]["reply_markup"]=={"inline_keyboard":[[{"text":"📅 Открыть календарь","url":URL}]]}
    transmit("Обычный отчёт")
    assert "parse_mode" not in captured[1] and "reply_markup" not in captured[1]

def test_legacy_morning_outbox_remains_plain(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","testing")
    setup()
    with connection() as conn:
        conn.execute("INSERT INTO telegram_report_outbox(message_key,message) VALUES (%s,%s)",
                     ("morning:2026-11-25","Старый текст <без HTML>"))
    sent=[]
    monkeypatch.setattr("telegram_digest.transmit",sent.append)
    assert process("morning",at("2026-11-25T08:00"),False)
    assert sent==["Старый текст <без HTML>"]
