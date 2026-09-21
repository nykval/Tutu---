PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY,
  catalog TEXT NOT NULL CHECK (catalog IN ('geographies', 'themes')),
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  type TEXT NOT NULL,
  UNIQUE(catalog, name_key, type)
);

CREATE INDEX IF NOT EXISTS catalog_items_catalog_idx
ON catalog_items(catalog, name_key);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  geography_id INTEGER NOT NULL,
  theme_ids TEXT NOT NULL,
  hotel_count INTEGER NOT NULL,
  benefit_type TEXT,
  discount_percent INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS collections_updated_idx
ON collections(updated_at DESC);

CREATE TABLE IF NOT EXISTS hotel_links (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY(collection_id, position)
);

INSERT OR IGNORE INTO collections
  (id, key, geography_id, theme_ids, hotel_count, benefit_type, discount_percent, created_at, updated_at)
VALUES
  (-1, '[2,[2,66],3,null,null]', 2, '[2,66]', 3, NULL, NULL, '2026-09-20T12:00:00+00:00', '2026-09-20T12:00:00+00:00'),
  (-2, '[6,[14,66,91],3,null,null]', 6, '[14,66,91]', 3, NULL, NULL, '2026-09-20T13:00:00+00:00', '2026-09-20T13:00:00+00:00'),
  (-3, '[7,[21,67,94],3,null,null]', 7, '[21,67,94]', 3, NULL, NULL, '2026-09-20T14:00:00+00:00', '2026-09-20T14:00:00+00:00');

INSERT OR IGNORE INTO hotel_links (collection_id, position, url) VALUES
  (-1, 1, 'https://hotel.tutu.ru/h_otel_kopengagen_launzhotel/'),
  (-1, 2, 'https://hotel.tutu.ru/h_meblirovannye_komnaty_zolotoy_kolos/'),
  (-1, 3, 'https://hotel.tutu.ru/h_kortyard_marriott_moskva_paveletskaya/'),
  (-2, 1, 'https://hotel.tutu.ru/h_sanktpeterburg/'),
  (-2, 2, 'https://hotel.tutu.ru/h_valo_biznes_rossiya_192102_g_sanktpeterburg_ul_salova_d_61_k3/'),
  (-2, 3, 'https://hotel.tutu.ru/h_izzziup_4_community_l_and_c_g_sanktpeterburg_ul_gorokhovaya_d_47v/'),
  (-3, 1, 'https://hotel.tutu.ru/h_gostevoy_dom_oganessea/'),
  (-3, 2, 'https://hotel.tutu.ru/h_apartotel_bulgakov_by_sateen_group_ieahdjlj/'),
  (-3, 3, 'https://hotel.tutu.ru/h_otel_sochi_galereya_park/');
