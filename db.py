import json
import os
import random
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "baby_names.db")
NAMES_PATH = os.path.join(BASE_DIR, "data", "names.json")
NAME_DETAILS_PATH = os.path.join(BASE_DIR, "data", "name_details.json")

USERS = ["marie", "jimmy"]

# Distinct fixed seeds so each person gets a different (but stable) shuffle
# of the same 1700+ names -- this guarantees full coverage of the list
# instead of relying on true randomness, which could skip names forever.
SEEDS = {"marie": 20260129, "jimmy": 19850717}

with open(NAME_DETAILS_PATH) as f:
    NAME_DETAILS = json.load(f)


def get_name_details(name):
    details = NAME_DETAILS.get(name, {})
    return {
        "category": details.get("category", ""),
        "pronunciation": details.get("pronunciation", ""),
        "altSpellings": details.get("altSpellings", []),
    }


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS votes (
            user TEXT NOT NULL,
            name TEXT NOT NULL,
            liked INTEGER NOT NULL,
            voted_at TEXT NOT NULL,
            PRIMARY KEY (user, name)
        );
        CREATE TABLE IF NOT EXISTS user_queue (
            user TEXT NOT NULL,
            position INTEGER NOT NULL,
            name TEXT NOT NULL,
            PRIMARY KEY (user, position)
        );
        """
    )
    conn.commit()

    with open(NAMES_PATH) as f:
        names = json.load(f)

    for user in USERS:
        row = conn.execute(
            "SELECT COUNT(*) c FROM user_queue WHERE user=?", (user,)
        ).fetchone()
        if row["c"] == 0:
            shuffled = names[:]
            random.Random(SEEDS[user]).shuffle(shuffled)
            conn.executemany(
                "INSERT INTO user_queue (user, position, name) VALUES (?, ?, ?)",
                [(user, i, n) for i, n in enumerate(shuffled)],
            )
    conn.commit()
    conn.close()


def get_state(user):
    conn = get_conn()
    total = conn.execute(
        "SELECT COUNT(*) c FROM user_queue WHERE user=?", (user,)
    ).fetchone()["c"]
    voted = conn.execute(
        "SELECT COUNT(*) c FROM votes WHERE user=?", (user,)
    ).fetchone()["c"]
    next_row = conn.execute(
        """
        SELECT uq.name FROM user_queue uq
        LEFT JOIN votes v ON v.user = uq.user AND v.name = uq.name
        WHERE uq.user = ? AND v.name IS NULL
        ORDER BY uq.position ASC
        LIMIT 1
        """,
        (user,),
    ).fetchone()
    last_vote = conn.execute(
        "SELECT name, liked FROM votes WHERE user=? ORDER BY rowid DESC LIMIT 1",
        (user,),
    ).fetchone()
    conn.close()
    card_name = next_row["name"] if next_row else None
    return {
        "user": user,
        "total": total,
        "votedCount": voted,
        "remaining": total - voted,
        "card": card_name,
        "cardDetails": get_name_details(card_name) if card_name else None,
        "canUndo": last_vote is not None,
        "lastVote": (
            {"name": last_vote["name"], "liked": bool(last_vote["liked"])}
            if last_vote
            else None
        ),
    }


def cast_vote(user, name, liked):
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO votes (user, name, liked, voted_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user, name) DO UPDATE SET
            liked = excluded.liked,
            voted_at = excluded.voted_at
        """,
        (user, name, 1 if liked else 0),
    )
    conn.commit()
    conn.close()


def undo_last(user):
    conn = get_conn()
    row = conn.execute(
        "SELECT rowid FROM votes WHERE user=? ORDER BY rowid DESC LIMIT 1", (user,)
    ).fetchone()
    if row:
        conn.execute("DELETE FROM votes WHERE rowid=?", (row["rowid"],))
        conn.commit()
    conn.close()


def get_results():
    conn = get_conn()
    rows = conn.execute("SELECT user, name, liked FROM votes").fetchall()
    conn.close()

    by_name = {}
    for r in rows:
        by_name.setdefault(r["name"], {})[r["user"]] = bool(r["liked"])

    matches = []
    one_sided = []
    both_disliked = []
    pending = []

    for name, votes in by_name.items():
        m = votes.get("marie")
        j = votes.get("jimmy")
        if m is None or j is None:
            pending.append({"name": name, "marie": m, "jimmy": j})
        elif m and j:
            matches.append(name)
        elif (not m) and (not j):
            both_disliked.append(name)
        else:
            one_sided.append({"name": name, "liker": "marie" if m else "jimmy"})

    matches.sort(key=str.lower)
    both_disliked.sort(key=str.lower)
    one_sided.sort(key=lambda x: x["name"].lower())
    pending.sort(key=lambda x: x["name"].lower())

    return {
        "matches": matches,
        "oneSided": one_sided,
        "bothDisliked": both_disliked,
        "pending": pending,
    }
