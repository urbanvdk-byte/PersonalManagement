from datetime import datetime
from zoneinfo import ZoneInfo
import json
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from app import setup,connection
from push_reminders import b64,public_key,validate_subscription,process_push,due_tasks

def at(value):
    return datetime.fromisoformat(value).replace(tzinfo=ZoneInfo("Europe/Moscow"))

def subscription():
    key=ec.generate_private_key(ec.SECP256R1()).public_key()
    return {"endpoint":"https://fcm.googleapis.com/fcm/send/test",
            "keys":{"p256dh":b64(key.public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)),
                    "auth":b64(b"x"*16)}}

def test_push_window_and_recurrence():
    base={"id":1,"priority":1,"title":"Test","scheduled_at":"2026-11-20T00:15","status":"planned","recurrence":"","duration_minutes":60}
    tasks=[base,{**base,"id":2,"status":"done"},{**base,"id":3,"status":"cancelled"},
           {**base,"id":4,"scheduled_at":None},
           {**base,"id":5,"scheduled_at":"2026-11-01T10:00","recurrence":"daily"},
           {**base,"id":6,"scheduled_at":"2026-11-01T00:15","recurrence":"daily"}]
    exceptions={(5,"2026-11-18"):{"scheduled_at":"2026-11-20T00:15"},(6,"2026-11-20"):{"status":"done"}}
    assert {t["id"] for t in due_tasks(tasks,exceptions,at("2026-11-19T23:15"))}=={1,5}
    assert not due_tasks(tasks,exceptions,at("2026-11-19T23:14"))
    assert not due_tasks(tasks,exceptions,at("2026-11-19T23:21"))

def test_subscription_security_keys_and_dedup(monkeypatch):
    monkeypatch.setenv("APP_PASSWORD","testing")
    setup()
    sub=validate_subscription(subscription())
    with pytest.raises(ValueError):
        validate_subscription({**sub,"endpoint":"https://127.0.0.1/private"})
    with connection() as conn:
        key=public_key(conn)
        conn.execute("INSERT INTO push_subscriptions(endpoint,subscription) VALUES (%s,%s)",(sub["endpoint"],json.dumps(sub)))
        task=conn.execute("""INSERT INTO tasks(title,status,scheduled_at)
           VALUES ('Push test','planned','2026-11-20T10:00') RETURNING id""").fetchone()["id"]
    with connection() as conn:
        assert public_key(conn)==key
    sent=[]
    monkeypatch.setattr("push_reminders.send",lambda sub,task,key:sent.append(task["scheduled_at"]))
    assert process_push(at("2026-11-20T09:00"))==1
    assert process_push(at("2026-11-20T09:01"))==0
    with connection() as conn:
        conn.execute("UPDATE tasks SET scheduled_at='2026-11-20T12:00' WHERE id=%s",(task,))
    assert process_push(at("2026-11-20T11:00"))==1
    assert sent==["2026-11-20T10:00","2026-11-20T12:00"]
    with connection() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint=%s",(sub["endpoint"],))
    assert process_push(at("2026-11-20T11:01"))==0


def test_device_timezone_at_midnight():
    from push_reminders import subscription_now
    sub=validate_subscription({**subscription(),"timezone":"Asia/Vladivostok"})
    now=subscription_now(sub,at("2026-11-19T17:00"))
    assert now.isoformat()=="2026-11-20T00:00:00+10:00"
    task={"id":1,"priority":1,"title":"ТЕСТ","scheduled_at":"2026-11-20T01:00","status":"planned","recurrence":"","duration_minutes":60}
    assert due_tasks([task],{},now)==[task]
    assert not due_tasks([task],{},at("2026-11-19T17:00"))
    with pytest.raises(ValueError):
        validate_subscription({**subscription(),"timezone":"invalid/zone"})


def test_real_vapid_signature_and_transport(monkeypatch):
    """Run actual pywebpush signing/encryption, intercept only the network call."""
    import requests
    from py_vapid import Vapid02
    from push_reminders import deliver
    key=ec.generate_private_key(ec.SECP256R1())
    private=b64(key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    public=b64(key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint))
    captured=[]
    def fake_send(self,request,**kwargs):
        captured.append(request)
        response=requests.Response()
        response.status_code=201
        response._content=b""
        return response
    monkeypatch.setattr(requests.sessions.Session,"send",fake_send)
    for subject in (None,"https://persmanag.bothost.tech/"):
        if subject is None:
            monkeypatch.delenv("PM_PUSH_SUBJECT",raising=False)
        else:
            monkeypatch.setenv("PM_PUSH_SUBJECT",subject)
        deliver(subscription(),{"title":"Test","body":"Test"},private)
    assert len(captured)==2
    for request in captured:
        auth=request.headers["Authorization"]
        assert Vapid02.verify(auth)
        assert auth.endswith("k="+public)
        assert request.headers["Content-Encoding"]=="aes128gcm"


@pytest.mark.parametrize("priority",[1,2,3,4])
def test_reminder_title_and_priority(monkeypatch,priority):
    from push_reminders import send
    captured=[]
    monkeypatch.setattr("push_reminders.deliver",lambda sub,body,key:captured.append(body))
    task={"id":42,"title":"Переработать видео с Феликсом","priority":priority,
          "scheduled_at":"2026-11-25T15:30"}
    send({},task,"unused")
    assert captured==[{"title":task["title"],"body":f"15:30 · P{priority}",
                       "priority":priority,"tag":"42:2026-11-25T15:30",
                       "url":"/?task=42&day=2026-11-25"}]
