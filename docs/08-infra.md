# Инфраструктура: Supabase + Cloudflare Pages — пошагово

Всё на бесплатных тарифах. Делает Кайрат один раз (issue #4). Секреты — в менеджер паролей, в репо не попадают.

## 1. Supabase — два проекта

Free-тариф даёт **2 активных проекта** на организацию — ровно `iqup-dev` и `iqup-prod`. Оба создаются одинаково, в одном регионе.

### 1.1 Форма «Create a new project»

| Поле | Значение | Почему |
|---|---|---|
| Organization | saitama7's projects (Free) | — |
| GitHub (optional) | **не выбирать** | Миграции применяем сами (`supabase db push` из CI/локально). Автодеплой из GitHub и ветки БД — платные/лишние на пилоте |
| Project name | `iqup-dev`, потом `iqup-prod` | Не просто `iqup` — будет два |
| Database password | «Generate a password» → **Copy → в менеджер паролей** | Нужен для `supabase link` и `db push`; восстановить нельзя, только сбросить |
| Region | Asia-Pacific; если даёт выбрать конкретный — **Mumbai (ap-south-1)**, иначе любой Asia-Pacific | Ближе всего к Бишкеку. Dev и prod — в одном регионе |
| Enable Data API | ✅ | supabase-js ходит через PostgREST |
| Automatically expose new tables | ✅ оставить | Иначе каждой миграции нужны ручные `grant`; защита у нас — RLS |
| Enable automatic RLS | ✅ **включить** | Страховка: любая новая таблица в `public` получает RLS даже если миграция забыла. Миграции всё равно пишут `enable row level security` явно (локальный стек без этого триггера) |
| Advanced configuration | не трогать | Postgres последний, compute Micro — всё бесплатное |

### 1.2 После создания (каждый проект)

**Authentication → Sign In / Providers → Email**
- Enable Email provider — ✅
- Confirm email — **выкл** (email у нас синтетический `996…@iqup.local`, письма никуда не уходят)
- Secure email change / Secure password change — выкл
- Minimum password length — 8

**Authentication → Sign In / Providers → вверху «Allow new users to sign up» — выкл.** Пользователей создаёт только админ через Edge Function (`auth.admin.createUser` работает и при выключенной регистрации). Без этого любой с anon-ключом мог бы зарегистрироваться.

**Authentication → URL Configuration**
- Site URL: `https://iqup-tracker.pages.dev` (prod) / `https://dev.iqup-tracker.pages.dev` или preview-URL (dev). Для входа по паролю это не критично, но пусть будет правильным.

**Authentication → Sessions**: JWT expiry 3600 (по умолчанию), refresh token rotation ✅ — оставить.

**Realtime**: отдельно включать не нужно. Таблицы добавляются в публикацию миграцией: `alter publication supabase_realtime add table lessons, attendance;` — это уже в issue #2.

**Project Settings → API** (или «API Keys»): скопировать
- Project URL → `VITE_SUPABASE_URL`
- anon / publishable key (`sb_publishable_…` или `eyJ…` anon) → `VITE_SUPABASE_ANON_KEY`
- service_role / secret key — **никуда в клиент и в репо**; Edge Functions получают его автоматически как `SUPABASE_SERVICE_ROLE_KEY`, настраивать не надо.

**Project Settings → General → Reference ID** → `<project-ref>` для `supabase link`.

### 1.3 Аккаунт

**supabase.com/dashboard/account/tokens → Generate new token** «iqup-cli» → `SUPABASE_ACCESS_TOKEN` (для CLI локально и для GitHub Actions).

### 1.4 Локально

```bash
brew install supabase/tap/supabase      # если нет; нужен Docker Desktop
supabase login                           # вставить access token
cd ~/Development/iqup-tracker
supabase link --project-ref <dev-ref>    # спросит database password dev
cp .env.example .env.local               # и заменить на URL/anon dev-проекта
```
`supabase start` — локальный стек для разработки; `supabase db push` — применить миграции на залинкованный проект (dev). На prod — `supabase link --project-ref <prod-ref> && supabase db push` только после мержа в `main`, руками, пока не появится workflow (R1-10).

### 1.5 Пауза Free-проектов

Проект без запросов 7 дней ставится на паузу. `supabase-keepalive.yml` пингует prod ежедневно. Dev может заснуть в перерывах — кнопка **Restore** в дашборде, 1–2 минуты. Хочешь, чтобы не засыпал — добавь в workflow второй пинг с секретами `SUPABASE_URL_DEV` / `SUPABASE_ANON_KEY_DEV`.

## 2. Cloudflare Pages

Деплой из Git: Cloudflare сам собирает `main` и каждую ветку PR. Никаких токенов Cloudflare в GitHub не нужно.

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → GitHub → при авторизации выбрать **Only select repositories: iqup-tracker** → Install & Authorize.
2. Выбрать репо `Saitama7/iqup-tracker` → **Begin setup**.
3. Build settings:
   - Project name: `iqup-tracker` (даст `iqup-tracker.pages.dev`)
   - Production branch: `main`
   - Framework preset: **Vite** (или None)
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Root directory: `/`
4. **Environment variables** (Add variable) — заполнить **отдельно для Production и Preview**:

   | Переменная | Production | Preview |
   |---|---|---|
   | `NODE_VERSION` | `22` | `22` |
   | `VITE_SUPABASE_URL` | URL **prod** | URL **dev** |
   | `VITE_SUPABASE_ANON_KEY` | anon **prod** | anon **dev** |

   pnpm Cloudflare возьмёт из `packageManager` в `package.json` (build system v3). Если сборка скажет «pnpm not found» — добавить `PNPM_VERSION=10`.
5. **Save and Deploy**. Первая сборка ~2 мин → `https://iqup-tracker.pages.dev`.
6. После деплоя: **Settings → Builds & deployments → Preview deployments: All non-Production branches** (по умолчанию так) — каждый PR получает URL `https://<hash>.iqup-tracker.pages.dev`, ссылка появляется в PR как check «Cloudflare Pages».
7. Проверить: открыть `https://iqup-tracker.pages.dev/some/route` — должен открыться SPA, не 404 (`public/_redirects`). На iPhone в Safari — «Поделиться → На экран Домой» → ставится как PWA.

8. Кэш и обновления (#56): `public/_headers` — `index.html`, `sw.js`, `manifest.webmanifest` с `Cache-Control: no-cache`, `/assets/*` — `immutable`. Проверка: `curl -sI https://iqup-tracker.pages.dev/sw.js | grep -i cache-control`. Service worker нового деплоя активируется сразу (`skipWaiting` + `clientsClaim`): новая вкладка получает новый бандл, открытая — тост «Доступна новая версия · Обновить». Версия сборки (`CF_PAGES_COMMIT_SHA`, задаёт Cloudflare сам) — внизу профиля, «Версия abc1234». Если у пользователя всё равно белый/ошибочный экран — кнопка «Обновить приложение» на экране ошибки сбрасывает service worker и кэши.

Домен `*.pages.dev` бесплатный; свой (`tracker.iqup.kg`) — позже, Custom domains, тоже бесплатно.

`wrangler.jsonc` в репо **не держим**: если Cloudflare находит wrangler-конфиг, он берёт настройки из него и игнорирует переменные из дашборда («Build environment variables: (none found)») — сборка без `VITE_SUPABASE_*` даёт белый экран. Переменные живут только в Settings → Variables and secrets.

## 3. GitHub → Settings → Secrets and variables → Actions

| Secret | Откуда | Для чего |
|---|---|---|
| `SUPABASE_URL` | prod Project URL | keepalive |
| `SUPABASE_ANON_KEY` | prod anon key | keepalive |
| `SUPABASE_ACCESS_TOKEN` | account token (1.3) | миграции из Actions (R1-10) |
| `SUPABASE_PROJECT_REF_PROD` | prod Reference ID | миграции |
| `SUPABASE_DB_PASSWORD_PROD` | пароль БД prod | миграции |

Cloudflare-секреты **не нужны** (Git-интеграция). `MAGIC_API_KEY` (21st.dev) — только в `~/.zshrc` локально.

## 4. Проверка, что всё работает

- [ ] `supabase start` → `supabase db reset` локально без ошибок (после #2)
- [ ] `supabase db push` на dev применил миграции, в Table Editor видны таблицы, у каждой включён RLS
- [ ] Push в `main` → Cloudflare собрал → сайт открывается с телефона, прямой URL не даёт 404
- [ ] Actions → «Supabase keepalive» → Run workflow → зелёный
- [ ] В prod-проекте «Allow new users to sign up» выключен
