"""Scoped JSON documents over transactional SQLite; no unscoped data access API."""
import hashlib
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import secrets
import sqlite3
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid4().hex


class Transaction:
    def __init__(self, connection, user_id):
        self.db, self.user_id = connection, user_id

    def get(self, kind, id):
        row = self.db.execute('SELECT body FROM documents WHERE user_id=? AND kind=? AND id=?',
                              (self.user_id, kind, id)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind):
        return [json.loads(r[0]) for r in self.db.execute(
            'SELECT body FROM documents WHERE user_id=? AND kind=? ORDER BY rowid', (self.user_id, kind))]

    def put(self, kind, id, body):
        self.db.execute('INSERT INTO documents(user_id,kind,id,body) VALUES(?,?,?,?) '
                        'ON CONFLICT(user_id,kind,id) DO UPDATE SET body=excluded.body',
                        (self.user_id, kind, id, json.dumps(body, ensure_ascii=False, allow_nan=False)))


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS documents(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(user_id,kind,id));
            PRAGMA user_version=1;''')

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def create_user(self, name):
        user = {'id': uid(), 'name': name, 'created_at': now()}
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute('INSERT INTO users VALUES(?,?,?,?)',
                       (user['id'], name, hashlib.sha256(token.encode()).hexdigest(), user['created_at']))
        return user, token

    def authenticate(self, token):
        with self.connect() as db:
            row = db.execute('SELECT id FROM users WHERE token_hash=?',
                             (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
        return row[0] if row else None

    @contextmanager
    def transaction(self, user_id):
        db = self.connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM users WHERE id=?', (user_id,)).fetchone():
                raise PermissionError('unknown user')
            yield Transaction(db, user_id)
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()
