"""Three opt-in Telegram reports, scheduled in PM_TIMEZONE on the server."""
from __future__ import annotations

import argparse
import json
import logging
import os
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta
from threading import Event
from zoneinfo import ZoneInfo

from app import connection, setup, series_at

LOG = logging.getLogger("pm.telegram")
MODES = ("morning", "weekly", "monthly")
URL = "https://persmanag.bothost.tech/"
DAY = timedelta(days=1)

def open_status(task):
    return task["status"] not in ("done", "cancelled")

def load_tasks(conn):
    tasks = [dict(row) for row in conn.execute("SELECT * FROM tasks ORDER BY id")]
    exceptions = {(r["task_id"], r["occurrence_date"]): json.loads(r["changes"])
                  for r in conn.execute("SELECT * FROM task_occurrences")}
    return tasks, exceptions

def period_rows(tasks, exceptions, start, end):
    """Inclusive dates, including completed occurrences, excluding cancellations.
    A moved instance belongs only to its effective scheduled date."""
    rows = []
    def append(item):
        when = item.get("scheduled_at")
        if when and start.isoformat() <= when[:10] <= end.isoformat() and item["status"] != "cancelled":
            rows.append(item)
    for task in tasks:
        scheduled = task.get("scheduled_at")
        if not scheduled:
            continue
        if not task.get("recurrence"):
            append(task)
            continue
        cursor = start
        while cursor <= end:
            key = cursor.isoformat()
            if series_at(task, key):
                append({**task, "scheduled_at": key + scheduled[10:], **exceptions.get((task["id"], key), {})})
            cursor += DAY
    # An original date outside the selected range can still be moved into it.
    by_id = {t["id"]: t for t in tasks}
    for (task_id, key), changes in exceptions.items():
        if start.isoformat() <= key <= end.isoformat():
            continue
        task = by_id.get(task_id)
        if task and changes.get("scheduled_at") and series_at(task, key):
            append({**task, **changes})
    return sorted(rows, key=lambda t: (t["scheduled_at"], t["id"]))

def occurrence_rows(conn, day):
    tasks, exceptions = load_tasks(conn)
    return [t for t in period_rows(tasks, exceptions, date.fromisoformat(day), date.fromisoformat(day)) if open_status(t)]

def minutes(rows):
    return sum(int(t["duration_minutes"]) for t in rows)

def hours(value):
    return f"{value//60} ч {value%60:02d} мин"

def label(value):
    return " ".join(str(value).split())[:180]

def percent(done, total):
    return f"{100*done/total:.0f}%" if total else "—"

def done_count(rows):
    return sum(t["status"] == "done" for t in rows)

def area_minutes(rows):
    totals = Counter()
    for t in rows:
        totals[t.get("area_id")] += int(t["duration_minutes"])
    return totals

def period_label(start, end):
    return start.strftime("%d.%m.%Y") + " — " + end.strftime("%d.%m.%Y")

def area_lines(rows, areas):
    totals = area_minutes(rows)
    if not totals:
        return ["• Нет запланированного времени"]
    return [f"• {label(areas.get(key, 'Без направления'))}: {hours(value)} ({percent(value, minutes(rows))})"
            for key, value in totals.most_common()]

def delta_lines(rows, previous):
    return [f"• Запланировано: {len(rows)-len(previous):+d} задач",
            f"• Выполнено из запланированных: {done_count(rows)-done_count(previous):+d} задач",
            f"• Запланированное время: {(minutes(rows)-minutes(previous))/60:+.1f} ч"]

def goal_achieved(goal):
    if not goal.get("measurable", 1):
        return bool(goal.get("done"))
    start, target, current = goal["start_value"], goal["target_value"], goal["current_value"]
    return bool(goal.get("done")) or (current >= target if target >= start else current <= target)

def report(conn, mode, now):
    today = now.date()
    tasks, exceptions = load_tasks(conn)
    day = today.isoformat()
    if mode == "morning":
        scheduled = [t for t in period_rows(tasks, exceptions, today, today) if open_status(t)]
        important = sorted(scheduled, key=lambda t: (t["priority"], t["scheduled_at"]))[:3]
        backlog = [t for t in tasks if open_status(t) and not t.get("scheduled_at")]
        overdue = [t for t in tasks if open_status(t) and t.get("due_at")
                   and datetime.fromisoformat(t["due_at"]).replace(tzinfo=None) < now.replace(tzinfo=None)]
        load = minutes(scheduled)
        lines = ["☀️ План на " + now.strftime("%d.%m.%Y"),
                 f"Запланировано: {len(scheduled)} задач · {hours(load)}" + (" ⚠️ Перегрузка" if load > 480 else ""),
                 "", "Главные задачи:"]
        lines.extend(f"• P{t['priority']} {t['scheduled_at'][11:16]} {label(t['title'])}" for t in important)
        if not important:
            lines.append("• Запланированных задач нет")
        lines += ["", "Расписание:"]
        lines.extend(f"• {t['scheduled_at'][11:16]} · P{t['priority']} · {label(t['title'])}" for t in scheduled)
        if not scheduled:
            lines.append("• Свободный день")
        lines += ["", f"Просрочено: {len(overdue)}", f"Без времени: {len(backlog)}, из них P1: {sum(t['priority']==1 for t in backlog)}", URL]
        return "morning:" + day, "\n".join(lines)
    areas = {r["id"]: r["title"] for r in conn.execute("SELECT id,title FROM areas")}
    if mode == "weekly":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        # Manual previews on earlier days show only elapsed days.
        through = min(today, end)
        rows = period_rows(tasks, exceptions, start, through)
        previous = period_rows(tasks, exceptions, start-timedelta(days=7), through-timedelta(days=7))
        done = done_count(rows)
        lines = ["📊 Итоги недели · " + period_label(start, through),
                 f"Запланировано: {len(rows)} · выполнено: {done} ({percent(done,len(rows))})",
                 f"Запланированное время: {hours(minutes(rows))}", "", "По дням (выполнено / запланировано):"]
        cursor = start
        names = ("Пн","Вт","Ср","Чт","Пт","Сб","Вс")
        while cursor <= through:
            daily = [t for t in rows if t["scheduled_at"][:10] == cursor.isoformat()]
            lines.append(f"• {names[cursor.weekday()]} {cursor.strftime('%d.%m')}: {done_count(daily)}/{len(daily)}")
            cursor += DAY
        lines += ["", "По приоритетам:"]
        for p in range(1,5):
            group = [t for t in rows if t["priority"] == p]
            lines.append(f"• P{p}: {done_count(group)}/{len(group)}")
        lines += ["", "Запланированное время по направлениям:", *area_lines(rows,areas),
                  "", "Изменение к предыдущей неделе:", *delta_lines(rows,previous),
                  "", "По текущим записям календаря; переносы и удаления могут изменить прошлые показатели.", URL]
        return "weekly:" + start.isoformat(), "\n".join(lines)
    if mode == "monthly":
        end = today.replace(day=1)-DAY
        start = end.replace(day=1)
        previous_end = start-DAY
        previous_start = previous_end.replace(day=1)
        rows = period_rows(tasks, exceptions, start, end)
        previous = period_rows(tasks, exceptions, previous_start, previous_end)
        lines = ["🎯 Итоги месяца · " + period_label(start,end),
                 f"Запланировано: {len(rows)} · выполнено: {done_count(rows)} ({percent(done_count(rows),len(rows))})",
                 f"Запланированное время: {hours(minutes(rows))}", "", "Проекты — выполнено / запланировано за месяц:"]
        projects = list(conn.execute("SELECT id,title,status FROM projects ORDER BY title,id"))
        for project in projects:
            items = [t for t in rows if t.get("project_id") == project["id"]]
            if items or project["status"] == "active":
                lines.append(f"• {label(project['title'])}: {done_count(items)}/{len(items)} · {hours(minutes(items))}")
        if not projects:
            lines.append("• Нет проектов")
        goals = list(conn.execute("SELECT * FROM goals ORDER BY title,id"))
        achieved = [g for g in goals if goal_achieved(g)]
        overdue = [g for g in goals if not goal_achieved(g) and g.get("period_end") and g["period_end"] < day]
        lines += ["", "Цели — состояние на дату отчёта:", f"• Достигнуто: {len(achieved)}",
                  f"• Не достигнуто: {len(goals)-len(achieved)}, из них просрочено: {len(overdue)}"]
        lines += [f"  — {label(g['title'])}" for g in overdue]
        lines += ["", "Запланированное время по направлениям:", *area_lines(rows,areas),
                  "", "Изменение к предыдущему месяцу:", *delta_lines(rows,previous)]
        a,b = area_minutes(rows),area_minutes(previous)
        lines.extend(f"• {label(areas.get(k,'Без направления'))}: {(a[k]-b[k])/60:+.1f} ч"
                     for k in sorted(a.keys()|b.keys(), key=lambda k: (str(areas.get(k,'')),str(k))))
        lines += ["", "По текущим записям календаря. Цели — текущий снимок, не история достижений. Часы плановые, не фактические.", URL]
        return "monthly:"+start.isoformat(), "\n".join(lines)
    raise ValueError("unknown report mode")

def transmit(text):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        raise RuntimeError("Telegram credentials are missing")
    data = json.dumps({"chat_id":chat,"text":text,"disable_web_page_preview":True}).encode()
    req = urllib.request.Request("https://api.telegram.org/bot"+token+"/sendMessage",
                                 data=data,headers={"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(req,timeout=12) as response:
        if not json.load(response).get("ok"):
            raise RuntimeError("Telegram rejected report")

def chunks(text):
    # Telegram allows 4096 characters; conservatively count UTF-16 units.
    result, part = [], ""
    for line in text.splitlines():
        next_part = part + ("\n" if part else "") + line
        if len(next_part.encode("utf-16-le"))//2 > 3800 and part:
            result.append(part)
            part = line
        else:
            part = next_part
    if part:
        result.append(part)
    return result

def process(mode, now, dry_run):
    if mode in ("evening","reminders"):
        return []  # Old cron jobs are harmless.
    with connection() as conn:
        key,message = report(conn,mode,now)
        if dry_run:
            return chunks(message)
        # Independent lock: never hold the application's write lock over network I/O.
        conn.execute("SELECT pg_advisory_xact_lock(1648246156)")
        if conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=%s",(key,)).fetchone():
            return []
        # Freeze the text before first send so retries cannot shift page boundaries.
        conn.execute("""INSERT INTO telegram_report_outbox(message_key,message) VALUES (%s,%s)
                        ON CONFLICT DO NOTHING""",(key,message))
        message = conn.execute("SELECT message FROM telegram_report_outbox WHERE message_key=%s",(key,)).fetchone()["message"]
        conn.commit()
    sent = []
    with connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(1648246156)")
        if conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=%s",(key,)).fetchone():
            return []
        for index,text in enumerate(chunks(message)):
            identity = f"{key}:part:{index}"
            if conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=%s",(identity,)).fetchone():
                continue
            transmit(text)
            conn.execute("INSERT INTO telegram_sent(message_key) VALUES (%s) ON CONFLICT DO NOTHING",(identity,))
            # Preserve successful individual pages across errors; reacquire next iteration.
            conn.commit()
            conn.execute("SELECT pg_advisory_xact_lock(1648246156)")
            sent.append(text)
        conn.execute("INSERT INTO telegram_sent(message_key) VALUES (%s) ON CONFLICT DO NOTHING",(key,))
        conn.execute("DELETE FROM telegram_report_outbox WHERE message_key=%s",(key,))
    return sent

def due_modes(now):
    clock = (now.hour,now.minute)
    modes = []
    if clock >= (8,0):
        modes.append("morning")
    if now.weekday() == 6 and clock >= (20,0):
        modes.append("weekly")
    if now.day == 1 and clock >= (8,5):
        modes.append("monthly")
    return modes

def run_scheduler(stop: Event):
    try:
        zone = ZoneInfo(os.environ.get("PM_TIMEZONE","Europe/Moscow"))
    except Exception:
        LOG.error("Invalid PM_TIMEZONE; Telegram reports disabled")
        return
    while not stop.is_set():
        now = datetime.now(zone)
        for mode in due_modes(now):
            if stop.is_set():
                break
            try:
                process(mode,now,False)
            except Exception as exc:
                # Error text may contain a URL with bot token. Never log it.
                LOG.warning("Telegram %s report failed (%s)",mode,type(exc).__name__)
        stop.wait(60)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode",choices=[*MODES,"evening","reminders"],required=True)
    parser.add_argument("--dry-run",action="store_true")
    parser.add_argument("--at",help="ISO local date/time for preview/testing")
    args = parser.parse_args()
    zone = ZoneInfo(os.environ.get("PM_TIMEZONE","Europe/Moscow"))
    now = datetime.fromisoformat(args.at).replace(tzinfo=zone) if args.at else datetime.now(zone)
    setup()
    for item in process(args.mode,now,args.dry_run):
        print(item if args.dry_run else "Telegram: report sent")

if __name__ == "__main__":
    main()
