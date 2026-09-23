import tempfile
import unittest
from pathlib import Path

from local_server import server


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.original_path = server.DB_PATH
        server.DB_PATH = Path(self.temp.name) / "collections.sqlite3"
        server.initialize_database()

    def tearDown(self):
        server.DB_PATH = self.original_path
        self.temp.cleanup()

    def test_catalog_seed_and_edit(self):
        with server.database() as conn:
            self.assertEqual(len(server.catalog_rows(conn, "geographies")), 200)
            self.assertEqual(len(server.catalog_rows(conn, "themes")), 101)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM collections").fetchone()[0], 3)
            item = server.create_catalog_item(conn, "geographies", {"name": "Тестовск", "type": "населенный пункт"})
            self.assertEqual(item["name"], "Тестовск")
            changed = server.update_catalog_item(conn, "geographies", item["id"], {"name": "Тестоград", "type": "местность"})
            self.assertEqual(changed["type"], "местность")
            with self.assertRaises(server.ApiError):
                server.create_catalog_item(conn, "geographies", {"name": "Тестоград", "type": "местность"})
            with self.assertRaises(server.ApiError):
                server.update_catalog_item(conn, "geographies", 1, {"name": "Нет", "type": "регион"})

    def test_collection_lookup_and_similar(self):
        with server.database() as conn:
            first = server.normalize_config(conn, {"geographyId": 2, "themeIds": [3, 2], "hotelCount": 2, "discountPercent": None})
            reordered = server.normalize_config(conn, {"geographyId": 2, "themeIds": [2, 3], "hotelCount": 2, "discountPercent": None})
            self.assertEqual(first["key"], reordered["key"])
            self.assertIsNone(server.lookup_collection(conn, first)["exact"])
            saved = server.save_collection(conn, first, ["https://tutu.ru/hotel/a", "https://tutu.ru/hotel/b"])
            self.assertEqual(saved["links"], ["https://tutu.ru/hotel/a", "https://tutu.ru/hotel/b"])
            self.assertEqual(server.lookup_collection(conn, reordered)["exact"]["id"], saved["id"])
            nearby = server.normalize_config(conn, {"geographyId": 2, "themeIds": [1], "hotelCount": 1, "discountPercent": 10})
            matches = server.lookup_collection(conn, nearby)["similar"]
            self.assertEqual(matches[0]["id"], saved["id"])
            self.assertIn("та же география", matches[0]["similarity"])
            updated = server.update_collection_links(conn, saved["id"], ["https://tutu.ru/hotel/c", "https://tutu.ru/hotel/d"])
            self.assertEqual(updated["links"][0], "https://tutu.ru/hotel/c")
            with self.assertRaises(server.ApiError):
                server.save_collection(conn, reordered, ["https://tutu.ru/hotel/x", "https://tutu.ru/hotel/y"])

    def test_seed_collection_is_available(self):
        with server.database() as conn:
            config = server.normalize_config(
                conn,
                {"geographyId": 7, "themeIds": [21, 67, 94], "hotelCount": 3, "discountPercent": None},
            )
            exact = server.lookup_collection(conn, config)["exact"]
            self.assertIsNotNone(exact)
            self.assertEqual(exact["id"], -3)
            self.assertEqual(len(exact["links"]), 3)

    def test_invalid_links_and_themes(self):
        with server.database() as conn:
            for theme_ids in ([1, 2], [2, 2], []):
                with self.assertRaises(server.ApiError):
                    server.normalize_config(conn, {"geographyId": 2, "themeIds": theme_ids, "hotelCount": 1})
            config = server.normalize_config(conn, {"geographyId": 1, "themeIds": [1], "hotelCount": 2})
            for links in (["https://tutu.ru/a"], ["https://tutu.ru/a"] * 2, ["not-a-url", "https://tutu.ru/b"], ["https://[bad", "https://tutu.ru/b"]):
                with self.assertRaises(server.ApiError):
                    server.save_collection(conn, config, links)

    def test_catalog_blocks_are_enforced(self):
        with server.database() as conn:
            theme = next(item for item in server.catalog_rows(conn, "themes") if item["id"] == 2)
            changed = server.update_catalog_item(conn, "themes", theme["id"], {
                "name": theme["name"],
                "type": theme["type"],
                "blockedGeographyIds": [2],
                "blockedThemeIds": [3],
            })
            self.assertEqual(changed["blockedGeographyIds"], [2])
            self.assertEqual(changed["blockedThemeIds"], [3])
            with self.assertRaisesRegex(server.ApiError, "не сочетается"):
                server.normalize_config(conn, {"geographyId": 2, "themeIds": [2], "hotelCount": 1})
            with self.assertRaisesRegex(server.ApiError, "не сочетаются"):
                server.normalize_config(conn, {"geographyId": 3, "themeIds": [2, 3], "hotelCount": 1})


if __name__ == "__main__":
    unittest.main()
