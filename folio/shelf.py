"""Per-reader storage. Each client has a random secret. Only its hash reaches the database."""

import hashlib
import json
import re
import sqlite3
import time
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

import requests

from .sources import safe_url, TOPICS

SCHEMA = """CREATE TABLE IF NOT EXISTS folio_library (
    owner TEXT NOT NULL, paper_id TEXT NOT NULL, paper TEXT NOT NULL,
    saved INTEGER NOT NULL, saved_at INTEGER NOT NULL,
    reading TEXT NOT NULL, read_at INTEGER NOT NULL, PRIMARY KEY(owner,paper_id))"""
UPSERT = """INSERT INTO folio_library VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner,paper_id) DO UPDATE SET
    paper=excluded.paper,
    saved=CASE WHEN excluded.saved_at>saved_at THEN excluded.saved ELSE saved END,
    saved_at=MAX(saved_at,excluded.saved_at),
    reading=CASE WHEN excluded.read_at>read_at THEN excluded.reading ELSE reading END,
    read_at=MAX(read_at,excluded.read_at)"""
SELECT = "SELECT paper,saved,saved_at,reading,read_at FROM folio_library WHERE owner=?"


def clean_paper(raw):
    if (
        not isinstance(raw, dict)
        or not isinstance(raw.get("id"), str)
        or not 0 < len(raw["id"]) <= 360
        or not raw.get("title")
    ):
        raise ValueError("Invalid paper record.")

    def txt(k, n):
        v = raw.get(k)
        return str(v)[:n] if isinstance(v, (str, int)) else ""

    def arr(k, n, w):
        a = raw.get(k)
        return (
            [str(v)[:w] for v in a[:n] if isinstance(v, str) and v]
            if isinstance(a, list)
            else []
        )

    p = {
        k: txt(k, n)
        for k, n in {
            "id": 360,
            "title": 650,
            "year": 4,
            "venue": 350,
            "description": 650,
            "abstract": 10000,
            "source": 90,
            "snippet": 1500,
            "doi": 260,
            "arxiv": 64,
            "pmcid": 20,
        }.items()
    }
    p.update(
        authors=arr("authors", 35, 160),
        topics=arr("topics", 12, 120),
        keywords=arr("keywords", 28, 100),
        overview=arr("overview", 6, 1600),
        art=raw.get("art")
        if raw.get("art") in {v[0] for v in TOPICS.values()}
        else "computing",
        localText=raw.get("localText") is True,
    )
    for k in ("url", "htmlUrl", "pdfUrl"):
        p[k] = safe_url(txt(k, 2048))
    return p


def clean_entry(raw):
    p = clean_paper(raw.get("paper"))
    read = raw.get("reading") or {}
    pos = read.get("position") or {}

    def num(v, cap):
        return min(cap, max(0, v)) if isinstance(v, (int, float)) and v == v else 0

    ceiling = int(time.time() * 1000) + 300000
    return {
        "paper": p,
        "saved": raw.get("saved") is True,
        "savedAt": int(num(raw.get("savedAt"), ceiling)),
        "readAt": int(num(raw.get("readAt"), ceiling)),
        "reading": {
            "status": read.get("status")
            if read.get("status") in ("reading", "finished")
            else "unread",
            "progress": int(num(read.get("progress"), 100)),
            "position": {
                "section": int(num(pos.get("section"), 5000)),
                "fraction": num(pos.get("fraction"), 1),
                "ratio": num(pos.get("ratio"), 1),
                "edition": str(pos.get("edition") or "")[:120],
            },
        },
    }


def owner_for(code):
    if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}", code):
        raise ValueError("The library key is invalid.")
    return hashlib.sha256(code.encode()).hexdigest()


def columns(row):
    return {
        "paper": json.loads(row[0]),
        "saved": bool(int(row[1])),
        "savedAt": int(row[2]),
        "reading": json.loads(row[3]),
        "readAt": int(row[4]),
    }


def http_sql(url, token, statements):
    endpoint = urlsplit(url.replace("libsql://", "https://", 1))
    if (
        endpoint.scheme != "https"
        or not endpoint.hostname
        or endpoint.username
        or endpoint.password
    ):
        raise ValueError("Invalid hosted database URL.")

    def argument(v):
        return (
            {"type": "integer", "value": str(v)}
            if isinstance(v, int)
            else {"type": "text", "value": v}
        )

    ops = [
        {"type": "execute", "stmt": {"sql": sql, "args": [argument(v) for v in vals]}}
        for sql, vals in statements
    ]
    resp = requests.post(
        "https://" + endpoint.netloc + "/v2/pipeline",
        json={"requests": ops + [{"type": "close"}]},
        headers={"Authorization": "Bearer " + token},
        timeout=(4, 12),
    )
    resp.raise_for_status()
    results = resp.json()["results"]
    if len(results) != len(ops) + 1 or any(r.get("type") == "error" for r in results):
        raise RuntimeError("The hosted library could not sync.")
    return [
        [x.get("value") for x in row]
        for row in results[-2]["response"]["result"].get("rows", [])
    ]


@lru_cache(maxsize=8)
def init_db(cfg):
    url, token, path = cfg
    if url and token:
        http_sql(url, token, [(SCHEMA, [])])
    elif path:
        Path(path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(Path(path).expanduser(), timeout=8) as db:
            db.execute(SCHEMA)
    else:
        raise ValueError("Shared storage is not configured.")


def sync(code, entries, cfg):
    owner = owner_for(code)
    if not isinstance(entries, list) or len(entries) > 24:
        raise ValueError("Invalid batch.")
    init_db(cfg)
    ops = []
    for raw in entries:
        e = clean_entry(raw)
        ops.append(
            (
                UPSERT,
                [
                    owner,
                    e["paper"]["id"],
                    json.dumps(e["paper"]),
                    int(e["saved"]),
                    e["savedAt"],
                    json.dumps(e["reading"]),
                    e["readAt"],
                ],
            )
        )
    url, token, path = cfg
    if url and token:
        # Each upsert is idempotent. A retry safely applies any remaining changes.
        rows = http_sql(url, token, ops + [(SELECT, [owner])])
    else:
        with sqlite3.connect(Path(path).expanduser(), timeout=8) as db:
            for sql, values in ops:
                db.execute(sql, values)
            rows = db.execute(SELECT, (owner,)).fetchall()
    return [columns(row) for row in rows]
