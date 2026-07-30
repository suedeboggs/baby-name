import json
import os
import random
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "baby_names.db")
NAMES_PATH = os.path.join(BASE_DIR, "data", "names.json")
NAME_DETAILS_PATH = os.path.join(BASE_DIR, "data", "name_details.json")

USERS = ["marie", "jimmy"]
STATUSES = ("liked", "disliked", "maybe")

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


def _find_canonical_name(name):
    lowered = name.lower()
    for known in NAME_DETAILS:
        if known.lower() == lowered:
            return known
    return None


def _add_name_details(name):
    NAME_DETAILS[name] = {"category": "Added by you", "pronunciation": "", "altSpellings": []}
    with open(NAME_DETAILS_PATH, "w") as f:
        json.dump(NAME_DETAILS, f, indent=2, ensure_ascii=False)


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
            status TEXT NOT NULL,
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

    # Migrate older databases that still have the boolean "liked" column
    # instead of the newer "status" column (liked/disliked/maybe).
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(votes)")}
    if "liked" in columns and "status" not in columns:
        conn.execute("ALTER TABLE votes ADD COLUMN status TEXT")
        conn.execute(
            "UPDATE votes SET status = CASE WHEN liked = 1 THEN 'liked' ELSE 'disliked' END WHERE status IS NULL"
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

    # Prune any names that have since been removed from the master list
    # (e.g. whole categories dropped) from existing queues/votes, without
    # touching custom names a user added -- those live in NAME_DETAILS too.
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS valid_names (name TEXT PRIMARY KEY)")
    conn.execute("DELETE FROM valid_names")
    conn.executemany(
        "INSERT INTO valid_names (name) VALUES (?)", [(n,) for n in NAME_DETAILS]
    )
    conn.execute("DELETE FROM user_queue WHERE name NOT IN (SELECT name FROM valid_names)")
    conn.execute("DELETE FROM votes WHERE name NOT IN (SELECT name FROM valid_names)")
    conn.execute("DROP TABLE valid_names")
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
        "SELECT name, status FROM votes WHERE user=? ORDER BY rowid DESC LIMIT 1",
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
            {"name": last_vote["name"], "status": last_vote["status"]}
            if last_vote
            else None
        ),
    }


def cast_vote(user, name, status):
    if status not in STATUSES:
        raise ValueError(f"invalid status: {status}")
    conn = get_conn()
    conn.execute(
        """
        INSERT INTO votes (user, name, status, voted_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user, name) DO UPDATE SET
            status = excluded.status,
            voted_at = excluded.voted_at
        """,
        (user, name, status),
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


def add_custom_name(user, raw_name):
    name = raw_name.strip()
    if not name:
        raise ValueError("name is required")

    canonical = _find_canonical_name(name)
    is_new = canonical is None
    if is_new:
        canonical = name.title()
        _add_name_details(canonical)

    conn = get_conn()
    for u in USERS:
        exists = conn.execute(
            "SELECT 1 FROM user_queue WHERE user=? AND name=?", (u, canonical)
        ).fetchone()
        if not exists:
            # Must be lower than every position ever used for this user (not
            # just unvoted ones), since positions are otherwise contiguous
            # with no gaps -- min(unvoted) - 1 would collide with an
            # already-used (voted) position.
            min_position = conn.execute(
                "SELECT MIN(position) p FROM user_queue WHERE user=?", (u,)
            ).fetchone()["p"]
            new_position = (min_position - 1) if min_position is not None else 0
            conn.execute(
                "INSERT INTO user_queue (user, position, name) VALUES (?, ?, ?)",
                (u, new_position, canonical),
            )
    conn.commit()
    conn.close()

    cast_vote(user, canonical, "liked")
    return canonical


def get_results():
    conn = get_conn()
    rows = conn.execute("SELECT user, name, status FROM votes").fetchall()
    conn.close()

    by_name = {}
    for r in rows:
        by_name.setdefault(r["name"], {})[r["user"]] = r["status"]

    matches = []
    one_sided = []
    both_disliked = []
    maybe = []
    pending = []

    for name, votes in by_name.items():
        m = votes.get("marie")
        j = votes.get("jimmy")
        if m is None or j is None:
            pending.append({"name": name, "marie": m, "jimmy": j})
        elif m == "liked" and j == "liked":
            matches.append(name)
        elif m == "disliked" and j == "disliked":
            both_disliked.append(name)
        elif {m, j} == {"liked", "disliked"}:
            one_sided.append({"name": name, "liker": "marie" if m == "liked" else "jimmy"})
        else:
            maybe.append({"name": name, "marie": m, "jimmy": j})

    matches.sort(key=str.lower)
    both_disliked.sort(key=str.lower)
    one_sided.sort(key=lambda x: x["name"].lower())
    maybe.sort(key=lambda x: x["name"].lower())
    pending.sort(key=lambda x: x["name"].lower())

    return {
        "matches": matches,
        "oneSided": one_sided,
        "bothDisliked": both_disliked,
        "maybe": maybe,
        "pending": pending,
    }
