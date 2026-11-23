"""PostgreSQL integration tests use isolated schemas, never the live database."""
import os
import uuid
from urllib.parse import quote, parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
import pytest


@pytest.fixture(autouse=True)
def isolated_postgres(monkeypatch):
    """Each test gets its own PostgreSQL schema; never operate on production."""
    base = os.environ.get("TEST_DATABASE_URL")
    if not base:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    schema = "pm_test_" + uuid.uuid4().hex[:16]
    with psycopg.connect(base, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
    parts = urlsplit(base)
    params = dict(parse_qsl(parts.query, keep_blank_values=True))
    params["options"] = f"-c search_path={schema}"
    isolated = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params, quote_via=quote), parts.fragment))
    monkeypatch.setenv("DATABASE_URL", isolated)
    try:
        yield
    finally:
        with psycopg.connect(base, autocommit=True) as conn:
            conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


