"""Optional Telegram notifications runner for the server deployment.

Configuration (server-side only):
 TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, PM_TIMEZONE (default Europe/Moscow).
 Run by server cron: --mode morning at 08:00, --mode evening at 20:30,
 --mode reminders every 5 minutes. --dry-run prints preview without sending.
 No bot token is ever bundled into GitHub Pages.
"""
from __future__ import annotations

import argparse
import json
import os
import urllib.request
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app import connection, setup, series_at

def open_status(task:dict)->bool:
    return task["status"] not in ("done","cancelled")

def occurrence_rows(conn,day:str)->list[dict]:
    records=[dict(row) for row in conn.execute("SELECT * FROM tasks")]
    exceptions={(r["task_id"],r["occurrence_date"]):json.loads(r["changes"])
                for r in conn.execute("SELECT * FROM task_occurrences")}
    rows=[]
    for task in records:
        scheduled=task.get("scheduled_at")
        if not scheduled:continue
        start=scheduled[:10]
        if task.get("recurrence"):
            if not series_at(task,day):continue
            changes=exceptions.get((task["id"],day),{})
            item={**task,"scheduled_at":day+scheduled[10:],**changes}
        else:
            if start!=day:continue
            item=task
        if open_status(item) and str(item.get("scheduled_at") or "").startswith(day):
            rows.append(item)
    # Include moved instances whose original day differs.
    for (task_id,original_day),changes in exceptions.items():
        when=changes.get("scheduled_at")
        if not when or not str(when).startswith(day) or original_day==day:continue
        task=next((x for x in records if x["id"]==task_id),None)
        if not task or not task.get("recurrence") or not series_at(task,original_day):continue
        moved={**task,**changes}
        if open_status(moved):rows.append(moved)
    return sorted(rows,key=lambda t:t["scheduled_at"])

def report(conn,mode:str,now:datetime)->tuple[str,str]:
    day=now.date().isoformat()
    scheduled=occurrence_rows(conn,day)
    events=[dict(r) for r in conn.execute("SELECT * FROM events WHERE substr(starts_at,1,10)=? ORDER BY starts_at",(day,))]
    if mode=="morning":
        important=sorted(scheduled,key=lambda t:(t["priority"],t["scheduled_at"]))[:3]
        overdue=conn.execute("""SELECT count(*) FROM tasks
          WHERE status NOT IN ('done','cancelled') AND due_at IS NOT NULL
          AND substr(due_at,1,10) < ?""",(day,)).fetchone()[0]
        load=sum(int(t["duration_minutes"]) for t in scheduled)
        load+=sum(max(0,int((datetime.fromisoformat(e["ends_at"])-datetime.fromisoformat(e["starts_at"])).total_seconds()/60)) for e in events)
        lines=["☀️ План на "+now.strftime("%d.%m.%Y"),
               "Главные задачи:"]
        lines.extend(f"• P{t['priority']} {t['scheduled_at'][11:16]} {t['title']}" for t in important)
        if not important:lines.append("• Запланированных задач нет")
        if events:
            lines.append("Встречи:")
            lines.extend(f"• {e['starts_at'][11:16]} {e['title']}" for e in events[:8])
        lines.append(f"Загрузка: {load//60} ч {load%60:02d} мин"+(" ⚠️ Перегрузка" if load>8*60 else ""))
        lines.append(f"Просрочено: {overdue}")
        return "morning:"+day,"\n".join(lines)
    if mode=="evening":
        finished=conn.execute("""SELECT count(*) FROM tasks WHERE status='done' AND
             substr(updated_at,1,10)=?""",(day,)).fetchone()[0]
        unfinished=sum(1 for t in scheduled if open_status(t))
        return "evening:"+day,(
          "🌙 Итоги "+now.strftime("%d.%m.%Y")+f"\nВыполнено задач: {finished}"
          +f"\nОсталось запланированных на сегодня: {unfinished}"
          +"\nПосмотрите завтрашний план и перенесите незавершённое.")
    if mode=="reminders":
        # Digest all starts in the coming 15 minutes, avoiding repeat sends.
        upcoming=[]
        for task in scheduled:
            if task["priority"] not in (1,2):continue
            dt=datetime.fromisoformat(task["scheduled_at"]).replace(tzinfo=now.tzinfo)
            minutes=(dt-now).total_seconds()/60
            if 10<=minutes<=15:
                upcoming.append(("task:"+str(task["id"])+":"+task["scheduled_at"],
                                 f"⏰ Через {round(minutes)} мин: P{task['priority']} {task['title']}"))
        for event in events:
            dt=datetime.fromisoformat(event["starts_at"]).replace(tzinfo=now.tzinfo)
            minutes=(dt-now).total_seconds()/60
            if 10<=minutes<=15:
                upcoming.append(("event:"+str(event["id"])+":"+event["starts_at"],
                                 f"📅 Через {round(minutes)} мин: {event['title']}"))
        if not upcoming:return "", ""
        # The caller handles each reminder separately, for durable dedup.
        return json.dumps(upcoming,ensure_ascii=False),""
    raise ValueError("unknown notification mode")

def transmit(text:str)->None:
    token=os.environ.get("TELEGRAM_BOT_TOKEN")
    chat=os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:raise RuntimeError("Configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server")
    data=json.dumps({"chat_id":chat,"text":text,"disable_web_page_preview":True}).encode()
    req=urllib.request.Request("https://api.telegram.org/bot"+token+"/sendMessage",
        data=data,headers={"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(req,timeout=12) as response:
        payload=json.load(response)
    if not payload.get("ok"):raise RuntimeError("Telegram declined notification")

def process(mode:str,now:datetime,dry_run:bool)->list[str]:
    with connection() as conn:
        key,message=report(conn,mode,now)
        if mode=="reminders":
            notifications=json.loads(key) if key else []
        else:notifications=[(key,message)]
        sent=[]
        for identity,text in notifications:
            if not text:continue
            exists=conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=?",(identity,)).fetchone()
            if exists and not dry_run:continue
            if dry_run:sent.append(text);continue
            transmit(text)
            conn.execute("INSERT OR IGNORE INTO telegram_sent(message_key) VALUES (?)",(identity,))
            sent.append(text)
        return sent

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--mode",choices=["morning","evening","reminders"],required=True)
    parser.add_argument("--dry-run",action="store_true")
    parser.add_argument("--at",help="ISO local date/time for preview/testing")
    args=parser.parse_args()
    zone=ZoneInfo(os.environ.get("PM_TIMEZONE","Europe/Moscow"))
    now=(datetime.fromisoformat(args.at).replace(tzinfo=zone) if args.at
         else datetime.now(zone))
    setup()
    for item in process(args.mode,now,args.dry_run):print(item if args.dry_run else "Telegram: notification sent")
if __name__=="__main__":main()
