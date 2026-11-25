"""Web Push: a single reminder 60 minutes before scheduled tasks."""
from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timedelta
from threading import Event
from urllib.parse import urlsplit, urlencode
from zoneinfo import ZoneInfo

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import webpush, WebPushException
from app import connection
from telegram_digest import load_tasks, period_rows, open_status

LOG = logging.getLogger("pm.push")
PUSH_HOSTS = {"fcm.googleapis.com", "updates.push.services.mozilla.com",
              "push.services.mozilla.com", "web.push.apple.com",
              "android.googleapis.com", "wns.windows.com"}
PUSH_SUFFIXES = (".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com")

def b64(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

def decode(value):
    if not isinstance(value,str) or len(value)>200:
        raise ValueError("key")
    return base64.b64decode(value+"="*((-len(value))%4),altchars=b"-_",validate=True)

def validate_subscription(payload):
    endpoint = payload.get("endpoint")
    if not isinstance(endpoint,str) or len(endpoint)>4096:
        raise ValueError("endpoint")
    url = urlsplit(endpoint)
    host = url.hostname or ""
    # Prevent arbitrary outbound requests to private hosts.
    if (url.scheme!="https" or url.username or url.password or url.port not in (None,443)
        or url.fragment or not (host in PUSH_HOSTS or host.endswith(PUSH_SUFFIXES))):
        raise ValueError("endpoint")
    keys = payload.get("keys")
    if not isinstance(keys,dict):
        raise ValueError("keys")
    p256dh,auth = decode(keys.get("p256dh")),decode(keys.get("auth"))
    if len(p256dh)!=65 or len(auth)!=16:
        raise ValueError("keys")
    ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),p256dh)
    zone=payload.get("timezone")
    if zone is not None:
        if not isinstance(zone,str) or len(zone)>100:
            raise ValueError("timezone")
        try:
            ZoneInfo(zone)
        except Exception as exc:
            raise ValueError("timezone") from exc
    result={"endpoint":endpoint,"keys":{"p256dh":b64(p256dh),"auth":b64(auth)}}
    if zone:
        result["timezone"]=zone
    return result

def subscription_now(subscription,now):
    # The calendar stores floating local times; interpret them in the device's
    # actual calendar timezone. Legacy subscriptions use the server fallback.
    return now.astimezone(ZoneInfo(subscription["timezone"])) if subscription.get("timezone") else now

def private_key(conn):
    row=conn.execute("SELECT private_key FROM push_vapid WHERE id=1").fetchone()
    if row:
        return row["private_key"]
    key=ec.generate_private_key(ec.SECP256R1())
    der=key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
    conn.execute("INSERT INTO push_vapid(id,private_key) VALUES (1,%s) ON CONFLICT DO NOTHING",(b64(der),))
    return conn.execute("SELECT private_key FROM push_vapid WHERE id=1").fetchone()["private_key"]

def public_key(conn):
    key=serialization.load_der_private_key(base64.urlsafe_b64decode(private_key(conn)+"==="),password=None)
    return b64(key.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint))

def due_tasks(tasks,exceptions,now):
    # Re-read the live calendar each tick. A five-minute recovery window avoids
    # stale reminders after a long outage, while allowing retries/short restarts.
    future=now+timedelta(hours=1)
    earliest=now+timedelta(minutes=55)
    rows=period_rows(tasks,exceptions,earliest.date(),future.date())
    result=[]
    for task in rows:
        if not open_status(task):
            continue
        when=datetime.fromisoformat(task["scheduled_at"]).replace(tzinfo=now.tzinfo)
        if earliest<=when<=future:
            result.append(task)
    return result

def send(subscription,task,key):
    when=task["scheduled_at"]
    identity=f"{task['id']}:{when}"
    body={"title":task["title"],"body":f"{when[11:16]} · P{task['priority']}",
          "priority":task["priority"],
          "tag":identity,"url":"/?"+urlencode({"task":task["id"],"day":when[:10]})}
    deliver(subscription,body,key)

def vapid_subject():
    # py-vapid's strict HTTPS subject validator accepts an origin, not a trailing slash.
    return os.environ.get("PM_PUSH_SUBJECT","https://persmanag.bothost.tech").strip().rstrip("/")

def deliver(subscription,body,key):
    webpush(subscription_info={k:subscription[k] for k in ("endpoint","keys")},data=json.dumps(body,ensure_ascii=False),
            vapid_private_key=key,vapid_claims={"sub":vapid_subject()},
            ttl=300,timeout=10)

def process_push(now):
    with connection() as conn:
        # Dedicated lock across worker replicas; never blocks normal task writes.
        conn.execute("SELECT pg_advisory_xact_lock(1648246157)")
        subscriptions=list(conn.execute("SELECT endpoint,subscription FROM push_subscriptions"))
        if not subscriptions:
            return 0
        tasks,exceptions=load_tasks(conn)
        conn.execute("DELETE FROM push_sent WHERE sent_at < CURRENT_TIMESTAMP - INTERVAL '35 days'")
        key=private_key(conn)
        count=0
        for item in subscriptions:
            endpoint=item["endpoint"]
            try:
                subscription=validate_subscription(json.loads(item["subscription"]))
                due=due_tasks(tasks,exceptions,subscription_now(subscription,now))
            except (ValueError,TypeError):
                LOG.warning("Invalid Web Push subscription")
                continue
            for task in due:
                identity=f"{task['id']}:{task['scheduled_at']}"
                if conn.execute("SELECT 1 FROM push_sent WHERE endpoint=%s AND reminder_key=%s",(endpoint,identity)).fetchone():
                    continue
                try:
                    send(subscription,task,key)
                except WebPushException as exc:
                    if exc.response is not None and exc.response.status_code in (404,410):
                        conn.execute("DELETE FROM push_subscriptions WHERE endpoint=%s",(endpoint,))
                        break
                    LOG.warning("Web Push delivery failed (HTTP %s)",exc.response.status_code if exc.response is not None else "unknown")
                    continue
                except Exception as exc:
                    LOG.warning("Web Push delivery failed (%s)",type(exc).__name__)
                    continue
                # If unsubscribed concurrently, do not resurrect the endpoint.
                conn.execute("""INSERT INTO push_sent(endpoint,reminder_key)
                    SELECT endpoint,%s FROM push_subscriptions WHERE endpoint=%s ON CONFLICT DO NOTHING""",
                    (identity,endpoint))
                count+=1
        return count

def run_push_scheduler(stop:Event):
    try:
        zone=ZoneInfo(os.environ.get("PM_TIMEZONE","Europe/Moscow"))
    except Exception:
        LOG.error("Invalid PM_TIMEZONE; push reminders disabled")
        return
    while not stop.is_set():
        try:
            process_push(datetime.now(zone))
        except Exception as exc:
            # Endpoints, subscription keys and task titles must not appear in logs.
            LOG.warning("Push scheduler failed (%s)",type(exc).__name__)
        stop.wait(30)
