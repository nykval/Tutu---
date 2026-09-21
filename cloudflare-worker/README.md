# Общий сервер подборок

Этот Cloudflare Worker выполняет две задачи:

- хранит общие подборки в базе Cloudflare D1;
- обращается к Tutu MCP и возвращает найденные ссылки приложению.

## Первое подключение

1. Создайте бесплатный аккаунт Cloudflare.
2. Откройте терминал в этой папке и выполните:

       npm install
       npx wrangler login
       npm run db:create
       npm run db:migrate
       npm run deploy

3. После публикации Cloudflare покажет адрес вида:

       https://tutu-collections-api.<ваш-поддомен>.workers.dev

4. Вставьте этот адрес в поле apiBaseUrl файла config.js в корне проекта.

После обновления сайта все сотрудники будут читать и сохранять подборки в одной базе.

## Важно

Сервер разрешает браузерные запросы с https://nykval.github.io. Дополнительные
адреса можно перечислить через запятую в ALLOWED_ORIGINS файла wrangler.jsonc.
