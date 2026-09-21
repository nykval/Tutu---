#!/usr/bin/env python3
"""Local catalog and hotel-collection server."""

import argparse
import json
import mimetypes
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "collections.sqlite3"
SEED_PATH = ROOT / "catalog-seed.json"
GEOGRAPHY_TYPES = ("населенный пункт", "без географии", "страна", "регион", "местность")
THEME_TYPES = (
    "сценарий", "состав", "занятия", "впечатления", "удобства",
    "расположение", "характер", "уровень", "повод", "без темы",
)
STATIC_FILES = {
    "/": "index.html", "/app.css": "app.css", "/result.css": "result.css",
    "/app.js": "app.js", "/icons.js": "icons.js", "/brand.png": "brand.png",
    "/catalog-data.js": "catalog-data.js", "/close.svg": "close.svg",
}
BENEFIT_TYPES = ("action", "promocode")


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@contextmanager
def database():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with database() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS geographies (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                name_key TEXT NOT NULL,
                type TEXT NOT NULL,
                UNIQUE(name_key, type)
            );
            CREATE TABLE IF NOT EXISTS themes (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                name_key TEXT NOT NULL,
                type TEXT NOT NULL,
                UNIQUE(name_key, type)
            );
            CREATE TABLE IF NOT EXISTS collections (
                id INTEGER PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                geography_id INTEGER NOT NULL REFERENCES geographies(id),
                theme_ids TEXT NOT NULL,
                hotel_count INTEGER NOT NULL,
                benefit_type TEXT,
                discount_percent INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS hotel_links (
                collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                url TEXT NOT NULL,
                PRIMARY KEY(collection_id, position)
            );
        """)
        seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
        for table, key in (("geographies", "geographies"), ("themes", "themes")):
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if count == 0:
                conn.executemany(
                    f"INSERT INTO {table} (id, name, name_key, type) VALUES (?, ?, ?, ?)",
                    ((item_id, name, name.casefold(), kind) for item_id, name, kind in seed[key]),
                )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(collections)")}
        if "benefit_type" not in columns:
            conn.execute("ALTER TABLE collections ADD COLUMN benefit_type TEXT")
        for row in conn.execute("SELECT id, geography_id, theme_ids, hotel_count, benefit_type, discount_percent FROM collections"):
            theme_ids = sorted(json.loads(row["theme_ids"]))
            benefit_type = row["benefit_type"] if row["discount_percent"] is not None else None
            if row["discount_percent"] is not None and benefit_type not in BENEFIT_TYPES:
                benefit_type = "action"
            key = json.dumps(
                [row["geography_id"], theme_ids, row["hotel_count"], benefit_type, row["discount_percent"]],
                separators=(",", ":"),
            )
            conn.execute(
                "UPDATE collections SET key = ?, benefit_type = ? WHERE id = ?",
                (key, benefit_type, row["id"]),
            )


def catalog_rows(conn, table):
    return [dict(row) for row in conn.execute(f"SELECT id, name, type FROM {table} ORDER BY id")]


def clean_label(value, label):
    if not isinstance(value, str):
        raise ApiError(f"{label}: укажите название.")
    name = " ".join(value.strip().split())
    if not 2 <= len(name) <= 120:
        raise ApiError(f"{label}: длина названия должна быть от 2 до 120 символов.")
    return name


def catalog_input(payload, table):
    if not isinstance(payload, dict):
        raise ApiError("Неверные данные справочника.")
    name = clean_label(payload.get("name"), "Название")
    kind = payload.get("type")
    allowed = GEOGRAPHY_TYPES if table == "geographies" else THEME_TYPES
    sentinel = "без географии" if table == "geographies" else "без темы"
    if kind not in allowed or kind == sentinel:
        raise ApiError("Выберите тип из справочника.")
    return name, kind


def create_catalog_item(conn, table, payload):
    name, kind = catalog_input(payload, table)
    try:
        cursor = conn.execute(
            f"INSERT INTO {table} (name, name_key, type) VALUES (?, ?, ?)",
            (name, name.casefold(), kind),
        )
    except sqlite3.IntegrityError as error:
        raise ApiError("Такое название с этим типом уже есть.", 409) from error
    return dict(conn.execute(f"SELECT id, name, type FROM {table} WHERE id = ?", (cursor.lastrowid,)).fetchone())


def update_catalog_item(conn, table, item_id, payload):
    if item_id == 1:
        raise ApiError("Служебное значение нельзя изменить.")
    if not conn.execute(f"SELECT 1 FROM {table} WHERE id = ?", (item_id,)).fetchone():
        raise ApiError("Элемент справочника не найден.", 404)
    name, kind = catalog_input(payload, table)
    try:
        conn.execute(
            f"UPDATE {table} SET name = ?, name_key = ?, type = ? WHERE id = ?",
            (name, name.casefold(), kind, item_id),
        )
    except sqlite3.IntegrityError as error:
        raise ApiError("Такое название с этим типом уже есть.", 409) from error
    return dict(conn.execute(f"SELECT id, name, type FROM {table} WHERE id = ?", (item_id,)).fetchone())


def positive_integer(value, minimum, maximum, label):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ApiError(f"{label}: укажите целое число от {minimum} до {maximum}.")
    return value


def plural(value, one, few, many):
    number = abs(int(value))
    last_two = number % 100
    last = number % 10
    if 11 <= last_two <= 14:
        return many
    if last == 1:
        return one
    if 2 <= last <= 4:
        return few
    return many


def count_text(value, one, few, many):
    return f"{value} {plural(value, one, few, many)}"


def normalize_config(conn, payload):
    if not isinstance(payload, dict):
        raise ApiError("Неверные параметры подборки.")
    geography_id = positive_integer(payload.get("geographyId"), 1, 1_000_000, "География")
    if not conn.execute("SELECT 1 FROM geographies WHERE id = ?", (geography_id,)).fetchone():
        raise ApiError("География не найдена.")
    theme_ids = payload.get("themeIds")
    if not isinstance(theme_ids, list) or not 1 <= len(theme_ids) <= 3:
        raise ApiError("Выберите от одной до трёх тем.")
    theme_ids = [positive_integer(value, 1, 1_000_000, "Тема") for value in theme_ids]
    if len(set(theme_ids)) != len(theme_ids) or (1 in theme_ids and len(theme_ids) > 1):
        raise ApiError("Темы не должны повторяться; «Без темы» выбирается отдельно.")
    theme_ids.sort()
    found = conn.execute(
        f"SELECT COUNT(*) FROM themes WHERE id IN ({','.join('?' for _ in theme_ids)})",
        theme_ids,
    ).fetchone()[0]
    if found != len(theme_ids):
        raise ApiError("Одна из тем не найдена.")
    hotel_count = positive_integer(payload.get("hotelCount"), 1, 100, "Количество отелей")
    discount = payload.get("discountPercent")
    benefit_type = None
    if discount is not None:
        discount = positive_integer(discount, 1, 90, "Скидка")
        benefit_type = payload.get("benefitType") or "action"
        if benefit_type not in BENEFIT_TYPES:
            raise ApiError("Выберите тип выгоды.")
    key = json.dumps([geography_id, theme_ids, hotel_count, benefit_type, discount], separators=(",", ":"))
    return {
        "key": key,
        "geographyId": geography_id,
        "themeIds": theme_ids,
        "hotelCount": hotel_count,
        "benefitType": benefit_type,
        "discountPercent": discount,
    }


def normalize_links(links, expected_count):
    if not isinstance(links, list) or len(links) != expected_count:
        raise ApiError(f"Нужно добавить ровно {count_text(expected_count, 'ссылку', 'ссылки', 'ссылок')} на отели.")
    cleaned = []
    seen = set()
    for raw in links:
        if not isinstance(raw, str):
            raise ApiError("Каждая ссылка должна быть строкой.")
        url = raw.strip()
        if len(url) > 2048:
            raise ApiError("Одна из ссылок слишком длинная.")
        try:
            parsed = urlsplit(url)
            hostname = parsed.hostname
            username = parsed.username
            password = parsed.password
        except ValueError as error:
            raise ApiError(f"Некорректная ссылка: {url[:90]}") from error
        if parsed.scheme not in ("http", "https") or not hostname or username or password:
            raise ApiError(f"Некорректная ссылка: {url[:90]}")
        dedupe_key = url.rstrip("/")
        if dedupe_key in seen:
            raise ApiError("Одна ссылка добавлена несколько раз.")
        seen.add(dedupe_key)
        cleaned.append(url)
    return cleaned


def collection_payload(conn, row):
    geography = conn.execute(
        "SELECT id, name, type FROM geographies WHERE id = ?", (row["geography_id"],)
    ).fetchone()
    theme_ids = json.loads(row["theme_ids"])
    themes = [dict(conn.execute("SELECT id, name, type FROM themes WHERE id = ?", (item_id,)).fetchone())
              for item_id in theme_ids]
    links = [item[0] for item in conn.execute(
        "SELECT url FROM hotel_links WHERE collection_id = ? ORDER BY position", (row["id"],)
    )]
    return {
        "id": row["id"],
        "geography": dict(geography),
        "themes": themes,
        "hotelCount": row["hotel_count"],
        "benefitType": row["benefit_type"] if row["discount_percent"] is not None else None,
        "discountPercent": row["discount_percent"],
        "links": links,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def similar_collections(conn, config, exclude_id=None):
    matches = []
    for row in conn.execute("SELECT * FROM collections ORDER BY updated_at DESC, id DESC"):
        if row["id"] == exclude_id:
            continue
        their_themes = set(json.loads(row["theme_ids"]))
        shared_themes = sorted(their_themes.intersection(config["themeIds"]) - {1})
        same_geography = row["geography_id"] == config["geographyId"] and config["geographyId"] != 1
        reasons = []
        score = 0
        if same_geography:
            reasons.append("та же география")
            score += 5
        if shared_themes:
            reasons.append(f"общих тем: {len(shared_themes)}")
            score += 3 * len(shared_themes)
        if row["hotel_count"] == config["hotelCount"]:
            reasons.append("то же количество отелей")
            score += 1
        row_benefit = row["benefit_type"] if row["discount_percent"] is not None else None
        if row["discount_percent"] == config["discountPercent"] and row_benefit == config["benefitType"] and config["discountPercent"] is not None:
            reasons.append("та же выгода")
            score += 1
        if not reasons:
            continue
        matches.append((score, row["updated_at"], collection_payload(conn, row), reasons))
    matches.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [{**item[2], "similarity": item[3]} for item in matches[:6]]


def lookup_collection(conn, config):
    row = conn.execute("SELECT * FROM collections WHERE key = ?", (config["key"],)).fetchone()
    exact = collection_payload(conn, row) if row else None
    return {"exact": exact, "similar": similar_collections(conn, config, row["id"] if row else None)}


def save_collection(conn, config, links):
    links = normalize_links(links, config["hotelCount"])
    if conn.execute("SELECT 1 FROM collections WHERE key = ?", (config["key"],)).fetchone():
        raise ApiError("Такая подборка уже существует.", 409)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    cursor = conn.execute(
        "INSERT INTO collections (key, geography_id, theme_ids, hotel_count, benefit_type, discount_percent, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (config["key"], config["geographyId"], json.dumps(config["themeIds"]),
         config["hotelCount"], config["benefitType"], config["discountPercent"], now, now),
    )
    conn.executemany(
        "INSERT INTO hotel_links (collection_id, position, url) VALUES (?, ?, ?)",
        ((cursor.lastrowid, index, url) for index, url in enumerate(links, start=1)),
    )
    row = conn.execute("SELECT * FROM collections WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return collection_payload(conn, row)


def update_collection_links(conn, collection_id, links):
    row = conn.execute("SELECT * FROM collections WHERE id = ?", (collection_id,)).fetchone()
    if not row:
        raise ApiError("Подборка не найдена.", 404)
    links = normalize_links(links, row["hotel_count"])
    conn.execute("DELETE FROM hotel_links WHERE collection_id = ?", (collection_id,))
    conn.executemany(
        "INSERT INTO hotel_links (collection_id, position, url) VALUES (?, ?, ?)",
        ((collection_id, index, url) for index, url in enumerate(links, start=1)),
    )
    conn.execute(
        "UPDATE collections SET updated_at = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(timespec="seconds"), collection_id),
    )
    return collection_payload(conn, conn.execute("SELECT * FROM collections WHERE id = ?", (collection_id,)).fetchone())


class Handler(BaseHTTPRequestHandler):
    server_version = "TutuCollections/1.0"

    def check_local_request(self):
        port = self.server.server_port
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in allowed_hosts:
            raise ApiError("Доступ разрешён только с этого компьютера.", 403)
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{host}" for host in allowed_hosts}:
            raise ApiError("Недопустимый источник запроса.", 403)

    def send_json(self, payload, status=200):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
            raise ApiError("Ожидается JSON-запрос.", 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ApiError("Некорректный размер запроса.") from error
        if length <= 0 or length > 262_144:
            raise ApiError("Размер запроса не поддерживается.")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ApiError("Некорректный JSON.") from error

    def do_GET(self):
        path = urlsplit(self.path).path
        try:
            self.check_local_request()
            if path == "/api/bootstrap":
                with database() as conn:
                    collections = [collection_payload(conn, row) for row in conn.execute(
                        "SELECT * FROM collections ORDER BY updated_at DESC, id DESC"
                    )]
                    self.send_json({
                        "geographies": catalog_rows(conn, "geographies"),
                        "themes": catalog_rows(conn, "themes"),
                        "collections": collections,
                    })
                return
            filename = STATIC_FILES.get(path)
            if not filename:
                raise ApiError("Страница не найдена.", 404)
            content = (ROOT / filename).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(filename)[0] or "text/html")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except ApiError as error:
            self.send_json({"error": str(error)}, error.status)

    def do_POST(self):
        path = urlsplit(self.path).path
        try:
            self.check_local_request()
            payload = self.read_json()
            with database() as conn:
                if path == "/api/geographies":
                    response = create_catalog_item(conn, "geographies", payload)
                    status = 201
                elif path == "/api/themes":
                    response = create_catalog_item(conn, "themes", payload)
                    status = 201
                elif path == "/api/lookup":
                    response = lookup_collection(conn, normalize_config(conn, payload))
                    status = 200
                elif path == "/api/collections":
                    config = normalize_config(conn, payload)
                    response = save_collection(conn, config, payload.get("links"))
                    status = 201
                else:
                    raise ApiError("Действие не найдено.", 404)
            self.send_json(response, status)
        except ApiError as error:
            self.send_json({"error": str(error)}, error.status)

    def do_PATCH(self):
        path = urlsplit(self.path).path
        try:
            self.check_local_request()
            payload = self.read_json()
            parts = path.strip("/").split("/")
            if len(parts) != 3 or parts[0] != "api" or not parts[2].isdigit():
                raise ApiError("Действие не найдено.", 404)
            table = parts[1]
            if table not in ("geographies", "themes"):
                raise ApiError("Действие не найдено.", 404)
            with database() as conn:
                response = update_catalog_item(conn, table, int(parts[2]), payload)
            self.send_json(response)
        except ApiError as error:
            self.send_json({"error": str(error)}, error.status)

    def do_PUT(self):
        path = urlsplit(self.path).path
        try:
            self.check_local_request()
            payload = self.read_json()
            parts = path.strip("/").split("/")
            if len(parts) != 3 or parts[:2] != ["api", "collections"] or not parts[2].isdigit():
                raise ApiError("Действие не найдено.", 404)
            with database() as conn:
                response = update_collection_links(conn, int(parts[2]), payload.get("links"))
            self.send_json(response)
        except ApiError as error:
            self.send_json({"error": str(error)}, error.status)


def main():
    parser = argparse.ArgumentParser(description="Local hotel collection builder")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    initialize_database()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Collection builder: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
