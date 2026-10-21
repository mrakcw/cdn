# Browser Risk Assessment

Диагностика браузерного окружения: страница собирает сведения, которые браузер сообщает любому сайту, проверяет их
согласованность и объясняет каждый балл риска. Назначение — сравнить обычный Chrome и Chromium под Playwright на одном
компьютере и увидеть, чем они различаются.

Инструмент **не маскирует автоматизацию и не обещает прохождение проверок**. Балл — эвристика, а не вероятность
обнаружения и не доказательство того, что браузером управляет программа.

## Состав

| Файл | Назначение |
| --- | --- |
| `index.html` | Готовая страница: открывается по URL и сразу запускает диагностику |
| `browser-risk.js` | Библиотека: сбор, проверки, баллы, отчёт, сравнение (`window.BrowserRisk`) |
| `app.js`, `style.css` | Интерфейс страницы (тёмная панель, без внешних шрифтов и фреймворков) |
| `server/server.js` | Необязательный обработчик HTTP-заголовков (Node.js 18+, без зависимостей) |
| `examples/` | Настоящие отчёты обычного Chrome и Chromium бота и их сравнение, [разбор](examples/comparison.md) |

## Размещение на GitHub Pages (отдельный репозиторий)

Страница статическая, сборка не нужна.

1. Создайте публичный репозиторий, например `browser-risk`.
2. Скопируйте в его корень содержимое этой папки `cdn/` (вместе с `examples/`; `server/` можно не копировать — на
   Pages он не выполняется).
3. В репозитории: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, ветка `main`, папка `/ (root)`.
4. Через минуту страница доступна по адресу `https://<пользователь>.github.io/browser-risk/`.

На GitHub Pages работает только **client-side**: статический хостинг (и любой CDN) не передаёт странице заголовки,
которые получил сервер. Server-side в отчёте будет помечен как недоступный — не как нулевой.

## Server-side: заголовки, которые видит сервер

```bash
node cdn/server/server.js --port 8787
```

Откройте `http://127.0.0.1:8787/`. Обработчик подставляет в страницу заголовки **именно этого перехода**
(`Sec-Fetch-Mode: navigate`) — так же их видит сервер обычного сайта. Анализируются только: `User-Agent`,
`Accept-Language`, `Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Mobile`, `Sec-Fetch-Site`, `Sec-Fetch-Mode`,
`Sec-Fetch-Dest`, `Accept`, `Accept-Encoding`. Cookie, Authorization и IP-адрес не читаются и не сохраняются.

Если страница размещена на другом адресе (Pages), а обработчик запущен отдельно, передайте его адрес:
`https://…/browser-risk/?server=https://ваш-сервер/api/headers`. Это запрос `fetch` с CORS: `Sec-Fetch-Mode` будет
`cors`, `Sec-Fetch-Dest` — `empty`, а не как при переходе на страницу; страница это помечает.

Важно: заголовки запроса к диагностическому серверу и к целевому сайту могут различаться (другой домен, прокси, CDN,
cookies). Отчёт описывает браузер, а не то, что получил конкретный чужой сервер.

Параметры обработчика: `--port`, `--host` (по умолчанию `127.0.0.1`), `--save-dir` — разрешить кнопку «Save to server»
и `?autosave=1` (отчёт сохраняется только в этот локальный каталог как `report-<env>.json`).

## Использование

- Страница запускает диагностику сразу при открытии; «Run again» — новое измерение и новый отчёт.
- Поле **Environment** (или `?env=chrome`, `?env=playwright`) — метка окружения в отчёте.
- **Export JSON** — скачать отчёт; **Copy report** — в буфер обмена.
- **Compare two reports** — загрузить два JSON (A — обычный Chrome, B — Chromium под Playwright) или взять текущий отчёт
  кнопками «Current → A/B». Файлы читаются локально и никуда не отправляются.

В боте: «🛠 Инструменты → 🧪 Dev-test → 🌐 Браузер бота: диагностика» открывает страницу в том же Chromium, что и
проверка СИТЫ (локальный сервер, есть server-side), и присылает сводку и JSON. «⚖️ Сравнить с отчётом Chrome» — пришлите
JSON, экспортированный в обычном Chrome, бот сравнит его с последним отчётом своего браузера.

Подключение библиотеки на своей странице:

```html
<script src="https://<пользователь>.github.io/browser-risk/browser-risk.js"></script>
<script>
  BrowserRisk.run({ environment: 'chrome' }).then((report) => console.log(report));
</script>
```

API: `collectClient()`, `analyzeClient(params)`, `analyzeServer(headers, clientParams)`, `score(checks)`,
`buildReport({ client, server, environment })`, `run(options)`, `compareReports(a, b)`. Веса настраиваются:
`BrowserRisk.run({ weights: { 'client.webdriver': 30 }, weakCap: 10 })`.

## Интерпретация

Каждый параметр хранится как `{ state, value }`: `ok` — значение получено (в том числе `false`, `0` или `[]`),
`unsupported` — API нет в браузере, `error` — API бросил исключение, `absent` — заголовка не было. Недоступное значение
никогда не подменяется выдуманным.

Каждая проверка в отчёте: `id`, `status`, `params` (затронутые параметры), `observed` (что увидели), `explanation`
(возможная причина), `severity`, `points`, `factor`, `weak`. Статусы:

| Статус | Смысл |
| --- | --- |
| `ok` | Сигналы согласованы |
| `mismatch` | Фактическое несоответствие — правило сработало, начислены баллы |
| `acceptable` | Отличие, допустимое для обычных браузеров (баллов нет) |
| `insufficient` | Недостаточно данных для вывода (баллов нет) |
| `info` | Справочно (баллов нет) |

Уровни: **0–34 низкий** (зелёный), **35–69 средний** (жёлтый), **70–100 высокий** (красный), серый — недоступно.

## Алгоритм баллов

1. Каждое сработавшее правило (`mismatch`) даёт свой вес.
2. Правила одного **фактора** не суммируются: учитывается максимум (одна причина — один раз). Например,
   `client.window-outer-smaller`, `client.screen-equals-viewport` и `client.dpr-fractional` — фактор `window-geometry`.
3. **Слабые** признаки (`weak`) вместе дают не больше `weakCap` = 15.
4. Сумма ограничивается диапазоном 0–100. `insufficient`, `acceptable` и недоступные значения дают 0.
5. Client-side и server-side считаются независимо. Итог — среднее двух, если доступны оба; если доступен один —
   итог равен ему, и отчёт явно пишет, что вошло в расчёт (`overall.basedOn`, `overall.method`).
6. Всё, что вошло в расчёт, сохраняется в `scoring`: веса, `counted`, `skippedDuplicates`, `weakPoints`, `weakApplied`.

### Правила client-side

| Правило | Вес | Фактор | Срабатывает | Ограничения сигнала |
| --- | --- | --- | --- | --- |
| `client.webdriver` | 45 | automation-flag | `navigator.webdriver === true` | Флаг можно выключить флагом запуска; `false` не доказывает, что браузер не автоматизирован |
| `client.headless-ua` | 40 | headless | `HeadlessChrome` в User-Agent | Только старый headless; новый headless и окно его не показывают |
| `client.ua-hints-headless` | 40 | headless | `HeadlessChrome` в userAgentData.brands | Как выше |
| `client.chrome-object-missing` | 10 | headless | UA заявляет настольный Chrome, а `window.chrome` нет | Нестандартные сборки Chromium тоже без него |
| `client.notification-permission` | 10 | headless | `Notification.permission = denied`, а `permissions.query = prompt` | Особенность старого headless; в обычных браузерах встречается редко |
| `client.window-outer-zero` | 20 | headless | `outerWidth = outerHeight = 0` | Headless без окна |
| `client.ua-hints-version` | 20 | ua-consistency | Версия в UA ≠ версии в userAgentData | Расширения, подменяющие UA, дают то же |
| `client.platform-mismatch` | 20 | platform | Платформа UA ≠ navigator.platform / Client Hints | Как выше |
| `client.languages-empty` | 15 | languages | `navigator.languages = []` | Нестандартные профили |
| `client.language-order` | 5, слабый | languages | `language ≠ languages[0]` | Возможна ручная настройка |
| `client.screen-equals-viewport` | 10 | window-geometry | Экран точно равен видимой области | Полноэкранный режим (F11) даёт то же |
| `client.window-larger-than-screen` | 10 | window-geometry | Видимая область больше экрана | Масштаб страницы |
| `client.window-outer-smaller` | 10 | window-geometry | Внешнее окно меньше видимой области | Масштаб страницы (Ctrl+колесо) |
| `client.dpr-fractional` | 5, слабый | window-geometry | `devicePixelRatio` с «хвостом» (1.0000000298) | Нестандартный масштаб Windows |
| `client.software-gpu` | 15 | gpu | Рендерер SwiftShader / llvmpipe / Basic Render | Удалённый рабочий стол и ВМ без GPU дают то же (см. пример Chrome) |
| `client.webgl-unavailable` | 5, слабый | gpu | WebGL недоступен | Политики, драйверы, флаги |
| `client.plugins-empty` | 5, слабый | plugins | У настольного Chromium 0 плагинов | Отключённый PDF-просмотрщик |
| `client.hardware-concurrency` | 5, слабый | hardware | `hardwareConcurrency = 0` | Ограничения приватности |
| `client.webrtc-missing` | 5, слабый | apis | Нет `RTCPeerConnection` | Отключение ради приватности или VPN |
| `client.timezone-language` | 0, справочно | — | Показывает пояс и языки | Расхождение с IP нормально для VPN и путешествий |

### Правила server-side

| Правило | Вес | Фактор | Срабатывает | Ограничения сигнала |
| --- | --- | --- | --- | --- |
| `server.headless-ua` | 40 | headless | `HeadlessChrome` в заголовке User-Agent | Как в client-side |
| `server.ua-mismatch-client` | 25 | ua-consistency | Заголовок User-Agent ≠ `navigator.userAgent` | Прокси может переписывать заголовок |
| `server.ch-ua-version` | 20 | ua-consistency | Версия в User-Agent ≠ Sec-CH-UA | Как выше |
| `server.ch-ua-missing` | 10 | client-hints | Chromium без Sec-CH-UA при переходе | По HTTP и через прокси/CDN заголовка может не быть |
| `server.ch-platform-mismatch` | 15 | platform | Платформа UA ≠ Sec-CH-UA-Platform | Подмена UA |
| `server.accept-language-missing` | 15 | languages | Нет Accept-Language при переходе | Прокси может удалить |
| `server.accept-language-client` | 10 | languages | Язык HTTP ≠ `navigator.languages[0]` | Язык подменён на одном уровне |
| `server.fetch-metadata-missing` | 10 | fetch-metadata | Нет ни одного Sec-Fetch-* | HTTP-клиенты и старые прокси |
| `server.accept-unusual` | 10 | accept | При переходе Accept без `text/html` | Нестандартные клиенты |
| `server.accept-encoding` | 5, слабый | accept | Нет gzip или br | Прокси, HTTP-библиотеки |

Отсутствующий заголовок никогда не считается доказательством автоматизации: его наличие зависит от типа запроса,
браузера, прокси и серверной инфраструктуры.

## Ограничения

- Защитные системы сайтов (например, F5 BIG-IP) используют собственные, закрытые сигналы и поведенческий анализ.
  Низкий балл здесь не означает, что такой сайт пропустит браузер; высокий — не означает, что заблокирует.
- Сравнение показывает отличия окружений; не каждое отличие — ошибка (разные версии, язык профиля, GPU, масштаб).
- Отчёт содержит язык, часовой пояс, модель GPU, разрешение экрана и версию браузера — это данные о компьютере.
  Публикуйте примеры осознанно.
- Страница не делает запросов к сторонним сервисам, не использует cookies и хранилище, не отправляет отчёт никуда,
  кроме своего обработчика по явной кнопке или `?autosave=1` при запущенном `--save-dir`.

## Формат отчёта (`browser-risk-report/1`)

`schema`, `tool { name, version }`, `measuredAt`, `environment`, `components { client, server }` (доступность, балл,
уровень, источник), `overall { available, score, level, basedOn, method }`, `params { client, server.headers }`,
`checks { client[], server[] }`, `warnings[]`, `errors[]` (ошибки этапов сбора), `scoring` (веса и разбор расчёта).

Пример — [examples/report-playwright.json](examples/report-playwright.json).
