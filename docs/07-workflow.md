# IQUP Tracker — процесс разработки

Репозиторий: `github.com/Saitama7/iqup-tracker` (приватный). Код пишет Claude Code, проектом управляет Claude (Cowork), решения принимает Кайрат.

## Роли

| Кто | Делает |
|---|---|
| **Кайрат** | Запускает Claude Code («сделай #N»), читает ревью, мержит PR, принимает решения по бизнес-правилам, деплой-секреты и аккаунты (GitHub, Supabase, Cloudflare) |
| **Claude · Cowork (менеджер)** | Ведёт backlog в GitHub Issues (спецификации с критериями приёмки), ревьюит PR, следит за docs, готовит демо для Каныкей, обновляет план |
| **Claude Code (разработчик)** | Берёт issue, делает ветку и PR по `CLAUDE.md`, прогоняет тесты, отвечает на ревью |
| **Каныкей** | Отвечает на вопросы о правилах (через Кайрата), принимает демо |

## Цикл одной задачи

```
Cowork: issue #N (контекст · экраны · что сделать · критерии приёмки)
   │
   ▼
Кайрат в терминале:  claude  →  «сделай issue #N»
   │
   ▼
Claude Code: ветка feat/N-slug → код + тесты → pnpm lint/typecheck/test
             → gh pr create  «#N · …»  (Closes #N, скриншот WebKit для UI)
   │
   ▼
Cowork: gh pr diff → ревью (комментарии в PR) → «approve» или «request changes»
   │                         │
   │                         └─► Кайрат: «поправь по ревью #N» → Claude Code → push
   ▼
Кайрат: merge → Cloudflare Pages деплоит main → Cowork закрывает issue, обновляет docs
```

Правила: одна issue — один PR; в `main` только через PR; миграции — только вперёд; вопрос по бизнес-правилу останавливает задачу, а не додумывается.

## Milestones

| Milestone | Срок | Результат |
|---|---|---|
| **R0 · Скелет** | до 12 окт | Репо, CI, Supabase локально + миграция ядра, Edge Function, деплой на Cloudflare Pages |
| **R1 · Занятия и ЗП** | 13–24 окт | Учитель отмечает занятия с телефона, админ ведёт группы и расписание, оба видят предварительную ЗП. Демо Каныкей |
| **R2 · Абонементы, оплаты, пробные** | 27–31 окт | Абонементы, платежи частями, долги, пробные занятия, отчёт по деньгам |
| **R3 · Закрытие периода** | 3–7 ноя | Закрытие месяца, корректировки, сверка со старой схемой, расчётный лист, журнал, бэкапы |
| **Пилот** | 10 ноя – 15 дек | Гульзат, затем все учителя; первая ЗП по системе за ноябрь |

Метки issues: `area:db`, `area:ui`, `area:infra`, `role:teacher`, `role:admin`, `role:accountant`, `blocked`, `question`.

## Автономный режим (с 11.10)

Кайрат делегировал Cowork полный цикл: Cowork сам запускает Claude Code, ревьюит и мержит. Механика:

- Claude Code запускается на Mac Кайрата в headless-режиме: `~/Development/iqup-wt/run-issue.sh <N> <slug> ["уточнения"]` создаёт worktree `~/Development/iqup-wt/<N>` на ветке `feat/<N>-<slug>` от `origin/main` и запускает `claude -p` с промптом «сделай issue #N по CLAUDE.md… открой PR, не мержи». Лог — `<worktree>/.claude-run.log`. Повторный заход с правками по ревью — `run-followup.sh <N> "<промпт>"`.
- Интерактивная сессия Кайрата в терминале не затрагивается (другой worktree, общий локальный Supabase-стек).
- Ревью: Cowork читает дифф и скриншоты, сравнивает со своими рендерами артбордов, пишет review-комментарий в PR («approve» / «нужны правки» — Request changes на PR своего же аккаунта GitHub не даёт). Мерж — `gh pr merge --squash --delete-branch`, worktree удаляется.
- Артборды макета — `docs/design/*.dc.html` (источник правды для UI, см. README там); Claude Code обязан открыть артборд до реализации экрана.
- Мелкие правки инфраструктуры и docs Cowork коммитит в `main` напрямую (через worktree), код — только через PR.

## Ревью: на что смотрит Cowork

1. Инварианты из `CLAUDE.md` (confirmed_at, is_locked, RLS на каждой таблице, audit_log).
2. Соответствие макету (`docs/06-design.md`) — маршруты, состояния, цвета-токены, nowrap у бейджей.
3. Тесты: чистые функции расчёта, pgTAP на RLS, e2e на ключевые сценарии (отметить занятие, провести).
4. Safari/iOS: `100dvh`, safe-area, 16 px инпуты, `prefers-reduced-motion`.
5. Ничего платного, ничего вне issue.

## Секреты и окружения

| Что | Где лежит | Кто заводит |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` (dev / prod) | Cloudflare Pages env, `.env.local` | Кайрат |
| `SUPABASE_SERVICE_ROLE_KEY` | только Supabase Edge Function secrets | Кайрат |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | GitHub Actions secrets (миграции, keepalive, бэкап) | Кайрат |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secrets | Кайрат |
| `MAGIC_API_KEY` (21st.dev) | локальное окружение Кайрата | Кайрат |
