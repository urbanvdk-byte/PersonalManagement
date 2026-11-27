from datetime import date
import pytest
from fastapi import HTTPException
from app import create, validate, validate_task_schedule, bootstrap
from telegram_digest import open_status, period_rows

@pytest.mark.parametrize("category",["birthday","public","anniversary","event","other"])
def test_holiday_roundtrip(category,monkeypatch):
    from app import setup
    monkeypatch.setenv('APP_PASSWORD','testing')
    setup()
    holiday=create("tasks",{"title":"Праздник","holiday_type":category,"holiday_date":"2027-01-01","status":"planned"})
    assert holiday["holiday_type"]==category
    assert holiday["holiday_date"]=="2027-01-01"
    assert holiday["scheduled_at"] is None
    assert not open_status(holiday)
    assert period_rows([holiday],{},date(2027,1,1),date(2027,1,1))==[]
    assert any(t["id"]==holiday["id"] and t["holiday_type"]==category for t in bootstrap()["tasks"])

@pytest.mark.parametrize("changes",[{"holiday_date":None},{"holiday_date":"2027-02-30"},{"holiday_type":"invalid"},{"scheduled_at":"2027-01-01T10:00"},{"goal_id":1},{"recurrence":"yearly"}])
def test_invalid_holiday(changes):
    payload={"title":"Праздник","holiday_type":"birthday","holiday_date":"2027-01-01","status":"planned",**changes}
    with pytest.raises(HTTPException) as exc:
        validate_task_schedule(None,validate("tasks",payload,creating=True))
    assert exc.value.status_code==422
