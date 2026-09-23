#!/usr/bin/env python3
"""Build the browser catalog from the canonical JSON seed."""

import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SOURCE = PROJECT_ROOT / "data" / "catalog-seed.json"
TARGET = PROJECT_ROOT / "assets" / "js" / "catalog-data.js"


def main():
    catalog = json.loads(SOURCE.read_text(encoding="utf-8"))
    rendered = "window.COLLECTION_CATALOG = " + json.dumps(
        catalog, ensure_ascii=False, indent=2
    ) + ";\n"
    TARGET.write_text(rendered, encoding="utf-8")
    print(f"Каталог обновлён: {TARGET.relative_to(PROJECT_ROOT)}")


if __name__ == "__main__":
    main()

