# Данные

- `catalog-seed.json` — единый редактируемый источник каталога. После изменений запустите `python3 scripts/sync_catalog.py`.
- `collections.sqlite3` — локальная база для изолированного режима.

Общая рабочая база находится в Cloudflare D1 и не хранится в этой папке. Подробнее: [`../docs/DATABASE.md`](../docs/DATABASE.md).
