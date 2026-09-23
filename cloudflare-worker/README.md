# Cloudflare Worker

Общий API приложения. Код находится в `src/index.js`, схема Cloudflare D1 — в `migrations/`.

Production:

- Worker: `tutu-collections-api.skorokirzhaboy.workers.dev`;
- база D1: `tutu-collections`;
- binding базы: `DB`.

## Что делает Worker

- хранит общие подборки и изменения справочников в D1;
- проверяет блокировки географий и тем;
- ищет точные и похожие подборки;
- вызывает Tutu MCP для автоматического поиска отелей;
- создаёт, редактирует и удаляет подборки.

## Документация

- [Архитектура и API](../docs/ARCHITECTURE.md)
- [База и миграции](../docs/DATABASE.md)
- [Публикация и восстановление](../docs/OPERATIONS.md)

## Локальные команды

Установка Wrangler:

```bash
npm install
```

Проверка синтаксиса:

```bash
npm run check
```

Локальный запуск Worker:

```bash
npm run dev
```

## Важно

В `wrangler.jsonc` намеренно нет `database_id`: production binding был создан через Cloudflare Dashboard. Не выполняйте CLI-деплой, пока не добавите привязку именно существующей базы `tutu-collections` в локальную конфигурацию.

Миграция `0002_catalog_blocks.sql` уже выполнена вручную через D1 Console, но может не быть отмечена в таблице `d1_migrations`. Не запускайте `migrations apply` без проверки схемы — повторное добавление колонок завершится ошибкой.
