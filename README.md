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
