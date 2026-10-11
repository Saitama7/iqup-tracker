# IQUP Tracker

Внутренняя система учёта для учебного центра **IQ UP** (Бишкек): занятия, посещаемость, оплаты учеников и расчёт зарплаты учителей.

**Главная цель** — фиксировать факт и время каждого проведённого занятия, чтобы зарплата считалась автоматически и бесспорно.

## Документация

| Файл | Содержание |
|---|---|
| [docs/00-vision.md](docs/00-vision.md) | Проблема, цель, принципы, роли, пользовательские сценарии |
| [docs/01-domain-model.md](docs/01-domain-model.md) | Сущности, ERD, тарифы, жизненный цикл занятия, баланс, расчёт ЗП, спорные кейсы |
| [docs/02-architecture.md](docs/02-architecture.md) | Стек (Next.js + Supabase + Vercel, всё бесплатно), RLS, структура проекта, риски |
| [docs/03-project-plan.md](docs/03-project-plan.md) | Этапы R1–R3, пилот, метрики, риски |
| [docs/04-questions-for-kanykei.md](docs/04-questions-for-kanykei.md) | Вопросы владелице перед стартом разработки |
| `docs/05-decisions.md` | Появится после интервью — зафиксированные правила |

## Статус

🟡 **Фаза подготовки** — документы написаны, ждём ответов на вопросы, код ещё не начат.

## Стек

Vite + React 19 (TypeScript, SPA, PWA) · TanStack Router/Query · Tailwind v4 + shadcn/ui + Motion · Supabase (Postgres, Auth, RLS, Edge Function) · Cloudflare Pages · GitHub Actions (CI, пинг, бэкапы). Всё на бесплатных тарифах, ничего не засыпает.

Дизайн-прототип: Claude Design канвас «IQ UP Tracker — экраны учителя».

## Запуск локально

Нужны Node 22+, pnpm 10 (`corepack enable`), для БД — Supabase CLI и Docker.

```bash
pnpm install
cp .env.example .env.local      # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
pnpm dev                        # http://localhost:5173
```

| Команда | Что делает |
|---|---|
| `pnpm lint` | ESLint + Prettier check |
| `pnpm typecheck` | `tsc -b` (strict) |
| `pnpm test` | Vitest (jsdom) |
| `pnpm e2e` | Playwright, WebKit 390×844 (iPhone 13); первый раз — `pnpm exec playwright install webkit` |
| `pnpm build` / `pnpm preview` | прод-сборка в `dist/` + PWA (manifest, service worker) |
| `supabase start` / `supabase db reset` | локальный Postgres + Auth + Realtime на портах **544xx** (API `http://127.0.0.1:54421`, Studio `:54423`), миграции + `supabase/seed.sql` |
| `pnpm seed:users` | логины для сид-людей (учителя из `teachers`, Каныкей, Алишка, бухгалтер), пароль `iqup-demo`; вход — телефон, напр. `0555 123 456` (Гульзат) |
| `supabase functions serve` | Edge Function `create-user` локально |
| `pnpm test:integration` | вход через supabase-js и `create-user` против локального стека (нужны `seed:users` и `functions serve`) |
| `supabase test db` | pgTAP-тесты RLS и инвариантов (`supabase/tests/`) |
| `pnpm gen:types` | типы БД из локального Supabase → `src/lib/supabase/types.gen.ts` |

Маршруты — файлы в `src/routes/` (TanStack Router генерирует `src/routeTree.gen.ts` при `dev`/`build`, файл коммитится). Токены цветов — `src/styles/tokens.css`. Деплой — Cloudflare Pages (`wrangler.jsonc`, SPA-fallback `public/_redirects`) по push в `main`.
