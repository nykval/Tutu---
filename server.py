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
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlsplit
from urllib.request import Request, urlopen


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
    "/config.js": "config.js", "/catalog-data.js": "catalog-data.js", "/close.svg": "close.svg",
}
BENEFIT_TYPES = ("action", "promocode")
MCP_URL = "https://mcp.tutu.ru/mcp"
MCP_PROTOCOL_VERSION = "2025-06-18"
MCP_TIMEOUT_SECONDS = 50

THEME_HOTEL_AMENITIES = {
    9: "spa",
    15: "kid_friendly",
    16: "kid_friendly",
    17: "kid_friendly",
    19: "pet_friendly",
    20: "kid_friendly",
    21: "beach",
    48: "pool",
    49: "pool",
    50: "pool",
    51: "pool",
    52: "kids_pool",
    53: "spa",
    54: "sauna",
    55: "sauna",
    56: "spa",
    57: "jacuzzi",
    61: "parking",
    63: "kid_friendly",
    64: "fitness",
    67: "beach",
    68: "beach",
}
THEME_ROOM_AMENITIES = {
    5: "workspace",
    36: "sea_view",
    37: "mountain_view",
    38: "view",
    60: "room_kitchen",
    65: "workspace",
}
THEME_STARS = {90: 3, 91: 4, 92: 5, 93: 5}


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
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            if "blocked_geography_ids" not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN blocked_geography_ids TEXT NOT NULL DEFAULT '[]'")
            if "blocked_theme_ids" not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN blocked_theme_ids TEXT NOT NULL DEFAULT '[]'")
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
        for item in seed.get("collections", []):
            config = normalize_config(conn, item, check_blocks=False)
            if conn.execute(
                "SELECT 1 FROM collections WHERE id = ? OR key = ?",
                (item["id"], config["key"]),
            ).fetchone():
                continue
            links = normalize_links(item.get("links"), config["hotelCount"])
            conn.execute(
                "INSERT INTO collections (id, key, geography_id, theme_ids, hotel_count, benefit_type, discount_percent, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (item["id"], config["key"], config["geographyId"], json.dumps(config["themeIds"]),
                 config["hotelCount"], config["benefitType"], config["discountPercent"],
                 item["createdAt"], item["updatedAt"]),
            )
            conn.executemany(
                "INSERT INTO hotel_links (collection_id, position, url) VALUES (?, ?, ?)",
                ((item["id"], index, url) for index, url in enumerate(links, start=1)),
            )


def catalog_rows(conn, table):
    rows = conn.execute(f"SELECT id, name, type, blocked_geography_ids, blocked_theme_ids FROM {table} ORDER BY id")
    return [catalog_row(row) for row in rows]


def catalog_row(row):
    return {"id": row["id"], "name": row["name"], "type": row["type"],
            "blockedGeographyIds": json.loads(row["blocked_geography_ids"]),
            "blockedThemeIds": json.loads(row["blocked_theme_ids"])}


def catalog_blocks(conn, payload, table, item_id=None):
    values = []
    for target, key in (("geographies", "blockedGeographyIds"), ("themes", "blockedThemeIds")):
        ids = payload.get(key, [])
        if not isinstance(ids, list) or len(ids) != len(set(map(str, ids))) or any(
            type(value) is not int or value == 1 or (target == table and value == item_id) for value in ids
        ):
            raise ApiError("В блокировках есть недопустимый элемент.")
        if ids:
            count = conn.execute(
                f"SELECT COUNT(*) FROM {target} WHERE id IN ({','.join('?' for _ in ids)})", ids
            ).fetchone()[0]
            if count != len(ids):
                raise ApiError("Один из заблокированных элементов не найден.")
        values.append(json.dumps(ids))
    return values


def config_conflict(conn, geography_id, theme_ids):
    geo = catalog_row(conn.execute("SELECT * FROM geographies WHERE id = ?", (geography_id,)).fetchone())
    themes = [catalog_row(conn.execute("SELECT * FROM themes WHERE id = ?", (value,)).fetchone()) for value in theme_ids]
    for theme in themes:
        if theme["id"] in geo["blockedThemeIds"] or geography_id in theme["blockedGeographyIds"]:
            return f"«{geo['name']}» не сочетается с темой «{theme['name']}»."
    for index, first in enumerate(themes):
        for second in themes[index + 1:]:
            if second["id"] in first["blockedThemeIds"] or first["id"] in second["blockedThemeIds"]:
                return f"Темы «{first['name']}» и «{second['name']}» не сочетаются."
    return None


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
    blocked_geos, blocked_themes = catalog_blocks(conn, payload, table)
    try:
        cursor = conn.execute(
            f"INSERT INTO {table} (name, name_key, type, blocked_geography_ids, blocked_theme_ids) VALUES (?, ?, ?, ?, ?)",
            (name, name.casefold(), kind, blocked_geos, blocked_themes),
        )
    except sqlite3.IntegrityError as error:
        raise ApiError("Такое название с этим типом уже есть.", 409) from error
    return catalog_row(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (cursor.lastrowid,)).fetchone())


def update_catalog_item(conn, table, item_id, payload):
    if item_id == 1:
        raise ApiError("Служебное значение нельзя изменить.")
    if not conn.execute(f"SELECT 1 FROM {table} WHERE id = ?", (item_id,)).fetchone():
        raise ApiError("Элемент справочника не найден.", 404)
    name, kind = catalog_input(payload, table)
    blocked_geos, blocked_themes = catalog_blocks(conn, payload, table, item_id)
    try:
        conn.execute(
            f"UPDATE {table} SET name = ?, name_key = ?, type = ?, blocked_geography_ids = ?, blocked_theme_ids = ? WHERE id = ?",
            (name, name.casefold(), kind, blocked_geos, blocked_themes, item_id),
        )
    except sqlite3.IntegrityError as error:
        raise ApiError("Такое название с этим типом уже есть.", 409) from error
    return catalog_row(conn.execute(f"SELECT * FROM {table} WHERE id = ?", (item_id,)).fetchone())


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


def normalize_config(conn, payload, check_blocks=True):
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
    conflict = config_conflict(conn, geography_id, theme_ids) if check_blocks else None
    if conflict:
        raise ApiError(conflict)
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


def mcp_error_text(result):
    messages = []
    for item in result.get("content", []):
        if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
            messages.append(item["text"])
    return " ".join(messages).strip()


def mcp_tool_data(result):
    if result.get("isError"):
        raise ApiError(mcp_error_text(result) or "Tutu MCP не смог выполнить поиск.", 502)
    structured = result.get("structuredContent")
    if isinstance(structured, dict):
        return structured
    for item in result.get("content", []):
        if not isinstance(item, dict) or item.get("type") != "text":
            continue
        try:
            value = json.loads(item.get("text", ""))
        except (TypeError, json.JSONDecodeError):
            continue
        if isinstance(value, dict):
            return value
    raise ApiError("Tutu MCP вернул ответ в неподдерживаемом формате.", 502)


def call_mcp_tool(name, arguments):
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }).encode("utf-8")
    request = Request(MCP_URL, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "User-Agent": "tutu-hotel-collections/1.0",
    })
    try:
        with urlopen(request, timeout=MCP_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise ApiError(f"Tutu MCP временно недоступен: HTTP {error.code}.", 502) from error
    except (URLError, TimeoutError) as error:
        raise ApiError("Не удалось связаться с Tutu MCP. Попробуйте ещё раз.", 502) from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApiError("Tutu MCP вернул некорректный ответ.", 502) from error
    if "error" in payload:
        message = payload["error"].get("message") if isinstance(payload["error"], dict) else None
        raise ApiError(message or "Tutu MCP не смог выполнить поиск.", 502)
    result = payload.get("result")
    if not isinstance(result, dict):
        raise ApiError("Tutu MCP вернул пустой ответ.", 502)
    return mcp_tool_data(result)


def append_mcp_attribution(url):
    base, separator, fragment = url.partition("#")
    query = urlsplit(base).query
    keys = {key for key, _ in parse_qsl(query, keep_blank_values=True)}
    additions = []
    if "utm_source" not in keys:
        additions.append("utm_source=tutu-collections")
    if "utm_medium" not in keys:
        additions.append("utm_medium=mcp")
    if additions:
        base += ("&" if "?" in base else "?") + "&".join(additions)
    return base + (separator + fragment if separator else "")


def hotel_search_filters(theme_ids):
    theme_ids = set(theme_ids)
    arguments = {}
    hotel_amenities = sorted({THEME_HOTEL_AMENITIES[item] for item in theme_ids if item in THEME_HOTEL_AMENITIES})
    room_amenities = sorted({THEME_ROOM_AMENITIES[item] for item in theme_ids if item in THEME_ROOM_AMENITIES})
    stars = sorted({THEME_STARS[item] for item in theme_ids if item in THEME_STARS})
    if hotel_amenities:
        arguments["hotel_amenities"] = hotel_amenities
    if room_amenities:
        arguments["room_amenities"] = room_amenities
    if stars:
        arguments["stars"] = stars
    if 58 in theme_ids:
        arguments["breakfast_included"] = True
    if 59 in theme_ids:
        arguments["meals"] = ["allinclusive"]
    if 85 in theme_ids:
        arguments["hotel_types"] = ["apartments"]
    if 94 in theme_ids:
        arguments["min_rating"] = 8
    return arguments


def parse_search_date(value, label):
    if not isinstance(value, str):
        raise ApiError(f"Укажите {label.lower()}.")
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as error:
        raise ApiError(f"{label}: используйте формат ГГГГ-ММ-ДД.") from error


def search_hotels_with_mcp(conn, payload):
    geography_id = positive_integer(payload.get("geographyId"), 1, 1_000_000, "География")
    geography = conn.execute("SELECT id, name, type FROM geographies WHERE id = ?", (geography_id,)).fetchone()
    if not geography or geography["type"] == "без географии":
        raise ApiError("Для автоматического поиска выберите конкретную географию.")
    check_in = parse_search_date(payload.get("checkIn"), "Дата заезда")
    check_out = parse_search_date(payload.get("checkOut"), "Дата выезда")
    if check_out <= check_in:
        raise ApiError("Дата выезда должна быть позже даты заезда.")
    adults = positive_integer(payload.get("adults"), 1, 6, "Количество гостей")
    requested = positive_integer(payload.get("hotelCount"), 1, 100, "Количество отелей")
    theme_ids = payload.get("themeIds")
    if not isinstance(theme_ids, list):
        raise ApiError("Темы подборки не найдены.")
    theme_ids = [positive_integer(item, 1, 1_000_000, "Тема") for item in theme_ids]

    base_arguments = {
        "city_name": geography["name"],
        "check_in": check_in.isoformat(),
        "check_out": check_out.isoformat(),
        "adults": adults,
        "view": "compact",
        **hotel_search_filters(theme_ids),
    }
    hotels = []
    seen_links = set()
    resolved_geo = None
    page = 1
    has_more = True
    while len(hotels) < requested and page <= 10 and has_more:
        arguments = {
            **base_arguments,
            "page": page,
            "page_size": min(30, requested - len(hotels)),
        }
        data = call_mcp_tool("search_hotels", arguments)
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        resolved_geo = resolved_geo or meta.get("resolved_geo")
        rows = data.get("hotels")
        if not isinstance(rows, list):
            rows = []
        for hotel in rows:
            if not isinstance(hotel, dict):
                continue
            offer = hotel.get("best_offer")
            if not isinstance(offer, dict):
                continue
            link = offer.get("checkout_url")
            if not isinstance(link, str) or not link.startswith(("http://", "https://")):
                continue
            link = append_mcp_attribution(link)
            key = link.rstrip("/")
            if key in seen_links:
                continue
            seen_links.add(key)
            hotels.append({
                "name": hotel.get("name") or "Отель",
                "stars": hotel.get("stars"),
                "rating": hotel.get("rating"),
                "address": hotel.get("address"),
                "price": offer.get("price"),
                "url": link,
            })
            if len(hotels) >= requested:
                break
        has_more = bool(meta.get("has_more")) and bool(rows)
        page += 1

    if not hotels:
        raise ApiError("Tutu не нашёл подходящих отелей. Попробуйте изменить даты или темы.", 404)
    return {
        "hotels": hotels,
        "requested": requested,
        "found": len(hotels),
        "resolvedGeo": resolved_geo,
    }


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
                        "supportsBlocks": True,
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
                elif path == "/api/hotel-search":
                    response = search_hotels_with_mcp(conn, payload)
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
            try:
                collection_id = int(parts[2]) if len(parts) == 3 else None
            except ValueError:
                collection_id = None
            if len(parts) != 3 or parts[:2] != ["api", "collections"] or collection_id is None:
                raise ApiError("Действие не найдено.", 404)
            with database() as conn:
                response = update_collection_links(conn, collection_id, payload.get("links"))
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
