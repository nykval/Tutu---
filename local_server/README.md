# Локальный сервер

Локальная альтернатива Cloudflare Worker для разработки и резервной проверки.

Запуск из корня проекта:

```bash
python3 local_server/server.py --port 8765
```

Тесты:

```bash
python3 -m unittest local_server.test_server
```

Чтобы фронтенд обращался сюда, в `assets/js/config.js` должен быть пустой `apiBaseUrl`.

