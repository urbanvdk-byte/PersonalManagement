"""Three opt-in Telegram reports, scheduled in PM_TIMEZONE on the server."""
from __future__ import annotations

import argparse
import json
import logging
import os
import urllib.request
from collections import Counter
from datetime import date, datetime, timedelta
from html import escape
from threading import Event
from zoneinfo import ZoneInfo

from app import connection, setup, series_at

LOG = logging.getLogger("pm.telegram")
MODES = ("morning", "weekly", "monthly")
URL = "https://persmanag.bothost.tech/"
DAY = timedelta(days=1)
PRIORITY_EMOJI = {1:"🔴",2:"🟠",3:"🔵",4:"⚪"}
WEEKDAYS = ("Понедельник","Вторник","Среда","Четверг","Пятница","Суббота","Воскресенье")
MONTHS = ("января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря")
MORNING_FORMAT = "pm-morning-html-v1"
REPORT_FORMATS = {"morning": MORNING_FORMAT, "weekly": "pm-weekly-html-v1",
                  "monthly": "pm-monthly-html-v1"}
REPORT_MONTHS = ("Январь","Февраль","Март","Апрель","Май","Июнь",
                 "Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь")
SEPARATOR = "────────────"

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

def bar(value, total, width=10):
    # Telegram supports plain Unicode symbols, not native graphical bars.
    filled = min(width, max(0, int(value * width / total + 0.5))) if total else 0
    return "🟩" * filled + "⬜" * (width-filled)

def section(lines, title):
    lines.extend(["", SEPARATOR, f"<b>{title}</b>", ""])

def summary_lines(rows):
    total, done = len(rows), done_count(rows)
    return [f"<b>{percent(done,total)} выполнено</b>" if total else "<b>Нет запланированных задач</b>",
            bar(done,total), "",
            f"📋 Запланировано: <b>{task_count(total)}</b>",
            f"✅ Выполнено: <b>{task_count(done)}</b>",
            f"⭕ Не выполнено: <b>{task_count(total-done)}</b>",
            f"⏱ Плановое время: <b>{hours(minutes(rows))}</b>"]

def area_name(areas, key):
    area = areas.get(key)
    if not area:
        return "📁 Без направления"
    return escape((area["emoji"] or "").strip() or "📁", quote=False) + " " + escape(label(area["title"]), quote=False)

def area_lines(rows, areas):
    totals = area_minutes(rows)
    if not totals or not minutes(rows):
        return ["Нет запланированного времени"]
    lines = []
    for key, value in totals.most_common():
        lines += [f"<b>{area_name(areas,key)}</b>",
                  f"{hours(value)} · {percent(value,minutes(rows))}",
                  bar(value,minutes(rows)), ""]
    return lines[:-1]

def signed_hours(value):
    return ("+" if value > 0 else "−" if value < 0 else "") + hours(abs(value))

def delta_lines(rows, previous):
    return [f"Запланировано: <b>{len(previous)} → {len(rows)}</b> ({len(rows)-len(previous):+d})",
            f"Выполнено: <b>{done_count(previous)} → {done_count(rows)}</b> ({done_count(rows)-done_count(previous):+d})",
            f"Плановое время: <b>{hours(minutes(previous))} → {hours(minutes(rows))}</b> ({signed_hours(minutes(rows)-minutes(previous))})"]

def project_name(project, areas, linked):
    ids = linked.get(project["id"]) or ([project["area_id"]] if project["area_id"] is not None else [])
    emojis = list(dict.fromkeys((areas[i]["emoji"] or "").strip() or "📁" for i in ids if i in areas))[:4]
    return escape(" ".join(emojis) or "📁", quote=False) + " " + escape(label(project["title"]), quote=False)

def goal_achieved(goal):
    if not goal.get("measurable", 1):
        return bool(goal.get("done"))
    start, target, current = goal["start_value"], goal["target_value"], goal["current_value"]
    return bool(goal.get("done")) or (current >= target if target >= start else current <= target)

def task_count(count):
    ending = "задач" if 11 <= count % 100 <= 14 else (
        "задача" if count % 10 == 1 else "задачи" if 2 <= count % 10 <= 4 else "задач")
    return f"{count} {ending}"

def morning_report(conn, today, scheduled, backlog, overdue):
    # Tasks have no separate emoji field: use their assigned direction, then
    # their goal's direction, then the linked project's directions.
    areas = {r["id"]: (r["emoji"] or "").strip() or "📁"
             for r in conn.execute("SELECT id,emoji FROM areas")}
    projects = {r["id"]: [r["area_id"]] if r["area_id"] is not None else []
                for r in conn.execute("SELECT id,area_id FROM projects")}
    linked = {}
    for row in conn.execute("SELECT project_id,area_id FROM project_areas ORDER BY project_id,area_id"):
        linked.setdefault(row["project_id"], []).append(row["area_id"])
    projects.update(linked)
    goals = {r["id"]: r for r in conn.execute("SELECT id,area_id,project_id FROM goals")}

    def task_emoji(task):
        goal = goals.get(task.get("goal_id"), {})
        if task.get("area_id") in areas:
            ids = [task["area_id"]]
        elif goal.get("area_id") in areas:
            ids = [goal["area_id"]]
        else:
            ids = projects.get(task.get("project_id") or goal.get("project_id"), [])
        # Limit the cluster to four distinct direction icons to stay compact.
        emojis = list(dict.fromkeys(areas[i] for i in ids if i in areas))[:4]
        return escape(" ".join(emojis) or "📁", quote=False)

    load = minutes(scheduled)
    counts = Counter(t["priority"] for t in scheduled)
    separator = "────────────"
    lines = ["<b>☀️ План дня</b>",
             f"<i>{WEEKDAYS[today.weekday()]}, {today.day} {MONTHS[today.month-1]} {today.year}</i>",
             "", f"<b>📋 {task_count(len(scheduled))} · {hours(load)}</b>"]
    if load > 480:
        lines.append("⚠️ Высокая нагрузка")
    lines += ["", "   ".join(f"{PRIORITY_EMOJI[p]} P{p}: <b>{counts[p]}</b>" for p in range(1,5))]
    groups = [
        ("🌤 УТРО", [t for t in scheduled if int(t["scheduled_at"][11:13]) < 13]),
        ("☀️ ДЕНЬ", [t for t in scheduled if 13 <= int(t["scheduled_at"][11:13]) < 18]),
        ("🌙 ВЕЧЕР", [t for t in scheduled if int(t["scheduled_at"][11:13]) >= 18]),
    ]
    for heading, tasks in groups:
        if not tasks:
            continue
        lines += ["", separator, f"<b>{heading}</b>", ""]
        for task in tasks:
            priority = task["priority"]
            title = escape(label(task["title"]), quote=False)
            lines += [f"<b>{task['scheduled_at'][11:16]}</b> · {PRIORITY_EMOJI[priority]} P{priority}",
                      f"{task_emoji(task)} {title}", ""]
        lines.pop()
    if not scheduled:
        lines += ["", separator, "🌿 Свободный день"]
    lines += ["", separator, "<b>📊 Остальные задачи</b>", "",
              f"⏰ Просрочено: <b>{len(overdue)}</b>" if overdue else "✅ Просроченных нет",
              f"📥 Без времени: <b>{len(backlog)}</b>",
              f"🔴 Из них P1: <b>{sum(t['priority']==1 for t in backlog)}</b>"]
    return "\n".join(lines)

def report(conn, mode, now):
    today = now.date()
    tasks, exceptions = load_tasks(conn)
    day = today.isoformat()
    if mode == "morning":
        scheduled = [t for t in period_rows(tasks, exceptions, today, today) if open_status(t)]
        backlog = [t for t in tasks if open_status(t) and not t.get("scheduled_at")]
        overdue = [t for t in tasks if open_status(t) and t.get("due_at")
                   and datetime.fromisoformat(t["due_at"]).replace(tzinfo=None) < now.replace(tzinfo=None)]
        return "morning:" + day, morning_report(conn, today, scheduled, backlog, overdue)
    areas = {r["id"]: r for r in conn.execute("SELECT id,title,emoji FROM areas")}
    if mode == "weekly":
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=4)
        # Compare the same elapsed weekdays, retaining the Monday–Friday scope.
        through = min(today, end)
        rows = period_rows(tasks, exceptions, start, through)
        previous = period_rows(tasks, exceptions, start-timedelta(days=7), through-timedelta(days=7))
        lines = ["<b>📊 Итоги недели</b>", f"<i>{period_label(start,through)}</i>",
                 "", SEPARATOR, *summary_lines(rows)]
        section(lines, "📅 Динамика по дням")
        cursor = start
        names = ("Пн","Вт","Ср","Чт","Пт","Сб","Вс")
        while cursor <= through:
            daily = [t for t in rows if t["scheduled_at"][:10] == cursor.isoformat()]
            done = done_count(daily)
            lines += [f"<b>{names[cursor.weekday()]}, {cursor.strftime('%d.%m')}</b> · {done}/{len(daily)}",
                      bar(done,len(daily),5)]
            cursor += DAY
        section(lines, "🎯 Выполнение по приоритетам")
        for p in range(1,5):
            group = [t for t in rows if t["priority"] == p]
            done = done_count(group)
            lines.append(f"{PRIORITY_EMOJI[p]} P{p} · <b>{done} из {len(group)}</b> · {percent(done,len(group))}")
        section(lines, "🧭 Распределение планового времени")
        lines += area_lines(rows,areas)
        section(lines, "📈 К предыдущей неделе")
        lines += delta_lines(rows,previous)
        lines += ["", "<i>По текущим записям календаря; переносы и удаления могут изменить прошлые показатели.</i>"]
        return "weekly:" + start.isoformat(), "\n".join(lines)
    if mode == "monthly":
        end = today.replace(day=1)-DAY
        start = end.replace(day=1)
        previous_end = start-DAY
        previous_start = previous_end.replace(day=1)
        rows = period_rows(tasks, exceptions, start, end)
        previous = period_rows(tasks, exceptions, previous_start, previous_end)
        lines = ["<b>🏆 Итоги месяца</b>", f"<i>{REPORT_MONTHS[start.month-1]} {start.year}</i>",
                 "", SEPARATOR, *summary_lines(rows)]
        section(lines, "📂 Работа по проектам")
        projects = list(conn.execute("SELECT id,title,status,area_id FROM projects ORDER BY title,id"))
        linked = {}
        for row in conn.execute("SELECT project_id,area_id FROM project_areas ORDER BY project_id,area_id"):
            linked.setdefault(row["project_id"], []).append(row["area_id"])
        groups = [(project_name(p,areas,linked), [t for t in rows if t.get("project_id") == p["id"]])
                  for p in projects if p["status"] == "active" or any(t.get("project_id") == p["id"] for t in rows)]
        without = [t for t in rows if t.get("project_id") is None]
        if without:
            groups.append(("📁 Без проекта",without))
        if not groups:
            lines.append("Нет проектов с задачами и активных проектов")
        for name, items in groups:
            done = done_count(items)
            lines += [f"<b>{name}</b>", f"{done} из {len(items)} задач · {hours(minutes(items))} · {percent(done,len(items))}",
                      bar(done,len(items)), ""]
        if groups:
            lines.pop()
        section(lines, "🎯 Состояние целей")
        goals = list(conn.execute("SELECT * FROM goals ORDER BY title,id"))
        achieved = [g for g in goals if goal_achieved(g)]
        overdue = [g for g in goals if not goal_achieved(g) and g.get("period_end") and g["period_end"] < day]
        lines += [f"✅ Достигнуто: <b>{len(achieved)}</b>",
                  f"🟡 Не достигнуто, срок не истёк или не задан: <b>{len(goals)-len(achieved)-len(overdue)}</b>",
                  f"🔴 Просрочено: <b>{len(overdue)}</b>"]
        if overdue:
            lines += ["", "<b>🔴 Просроченные цели</b>"]
            lines += [f"• {escape(label(g['title']),quote=False)}" for g in overdue]
        section(lines, "🧭 Баланс направлений")
        lines += area_lines(rows,areas)
        section(lines, f"📈 К предыдущему месяцу · {REPORT_MONTHS[previous_start.month-1].lower()}")
        lines += delta_lines(rows,previous)
        section(lines, "🔄 Изменение нагрузки")
        a,b = area_minutes(rows),area_minutes(previous)
        keys = sorted(a.keys()|b.keys(), key=lambda k: (str(areas.get(k,{}).get("title","Без направления")),str(k)))
        lines += [f"{area_name(areas,k)}: <b>{signed_hours(a[k]-b[k])}</b>" for k in keys] or ["Нет запланированного времени"]
        lines += ["", "<i>По текущим записям календаря. Цели — состояние на дату отчёта, не история достижений. Часы плановые, не фактические.</i>"]
        return "monthly:"+start.isoformat(), "\n".join(lines)
    raise ValueError("unknown report mode")

def transmit(text, *, formatted=False, calendar_button=False, button_text="📅 Открыть календарь"):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat:
        raise RuntimeError("Telegram credentials are missing")
    payload = {"chat_id":chat,"text":text,"disable_web_page_preview":True}
    if formatted:
        payload["parse_mode"] = "HTML"
    if calendar_button:
        payload["reply_markup"] = {"inline_keyboard":[[{"text":button_text,"url":URL}]]}
    data = json.dumps(payload).encode()
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

def morning_pages(message):
    # Keep the time/priority and its task title in the same Telegram message.
    # Paragraphs contain independent, balanced HTML tags.
    pages, current = [], ""
    for paragraph in message.split("\n\n"):
        joined = current + ("\n\n" if current else "") + paragraph
        if current and len(joined.encode("utf-16-le"))//2 > 3800:
            pages.append(current)
            current = paragraph
        else:
            current = joined
    if current:
        pages.append(current)
    return pages

def process(mode, now, dry_run):
    if mode in ("evening","reminders"):
        return []  # Old cron jobs are harmless.
    with connection() as conn:
        key,message = report(conn,mode,now)
        if dry_run:
            return morning_pages(message)
        # Independent lock: never hold the application's write lock over network I/O.
        conn.execute("SELECT pg_advisory_xact_lock(1648246156)")
        if conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=%s",(key,)).fetchone():
            return []
        # Freeze the text, its format and page boundaries before first send.
        # Old plain-text outbox entries remain valid across this deployment.
        message = json.dumps({"format":REPORT_FORMATS[mode],"pages":morning_pages(message)},ensure_ascii=False)
        conn.execute("""INSERT INTO telegram_report_outbox(message_key,message) VALUES (%s,%s)
                        ON CONFLICT DO NOTHING""",(key,message))
        message = conn.execute("SELECT message FROM telegram_report_outbox WHERE message_key=%s",(key,)).fetchone()["message"]
        conn.commit()
    sent = []
    with connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(1648246156)")
        if conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=%s",(key,)).fetchone():
            return []
        formatted = False
        pages = None
        if message.startswith("{"):
            try:
                saved = json.loads(message)
                if saved.get("format") == REPORT_FORMATS[mode]:
                    pages = saved["pages"]
                    formatted = True
            except (ValueError, AttributeError, KeyError):
                pass
        if pages is None:
            pages = chunks(message)
        for index,text in enumerate(pages):
            identity = f"{key}:part:{index}"
            if conn.execute("SELECT 1 FROM telegram_sent WHERE message_key=%s",(identity,)).fetchone():
                continue
            if formatted:
                options = {"formatted":True,"calendar_button":index==len(pages)-1}
                if mode != "morning":
                    options["button_text"] = "📊 Открыть PersonalManagement" if mode == "monthly" else "📅 Открыть PersonalManagement"
                transmit(text,**options)
            else:
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
    if now.weekday() == 4 and clock >= (21,0):
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
