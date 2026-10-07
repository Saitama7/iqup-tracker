# CLAUDE.md — правила работы агентов в IQUP Tracker

## Контекст
Система учёта занятий, посещаемости, оплат и зарплат для учебного центра IQ UP (Бишкек). Один центр, ~10 учителей, ~200 учеников. Эксплуатация должна оставаться бесплатной (Vercel Hobby + Supabase Free).

Перед любой задачей прочитай `docs/01-domain-model.md` (термины и правила) и `docs/02-architecture.md` (где что живёт). Если правило не описано в `docs/` или `docs/05-decisions.md` — **не придумывай**, спроси Кайрата.

## Роли
- Кайрат — технический руководитель, принимает решения по продукту и архитектуре.
- Claude — проектирует, пишет код и тесты, документирует. Предлагает, не решает за владельца бизнес-правила.

## Стек
Next.js 15 App Router + TypeScript (strict) · Tailwind + shadcn/ui · Supabase (Postgres, Auth, RLS) · SQL-миграции в `supabase/migrations` · Vitest · Playwright · pnpm.

## Инварианты домена — нарушать нельзя
1. `lessons.confirmed_at` ставится один раз системным временем и никогда не редактируется.
2. Записи в закрытом периоде (`is_locked = true`) не меняются никем. Исправления — только `payroll_adjustments`.
3. Баланс ученика и сумма ЗП **вычисляются** из первичных данных (views/чистые функции), не хранятся как редактируемые числа.
4. Любое изменение `lessons`, `attendance`, `payments`, `pay_rates`, `enrollments` попадает в `audit_log` триггером.
5. Все правила доступа — в RLS. Server Action дублирует проверку роли, но не заменяет RLS.
6. Время — `timestamptz` в БД, отображение в `Asia/Bishkek`.

## Правила кода
- Логика расчёта ЗП и баланса — чистые функции в `src/features/payroll/calc.ts` и `src/features/payments/balance.ts`, покрытые тестами. Та же логика в SQL-view — при изменении менять оба места и тест, сверяющий их.
- Мутации — через Server Actions с валидацией `zod`. Никаких прямых вызовов supabase из клиентских компонентов для записи.
- Интерфейс на русском. Экраны учителя — mobile-first (360 px).
- Миграции только вперёд; никаких правок уже применённых миграций.
- Перед коммитом: `pnpm lint && pnpm typecheck && pnpm test`.

## Команды
```
pnpm dev                 # next dev
supabase start           # локальный Postgres + Auth
supabase db reset        # применить миграции + seed
supabase gen types typescript --local > src/lib/supabase/types.ts
pnpm test                # vitest
pnpm e2e                 # playwright
```

## Чего не делать
- Не добавлять функциональность вне `docs/03-project-plan.md` без явного решения Кайрата.
- Не включать платные сервисы (SMS, платные тиры).
- Не хранить service-role ключ нигде, кроме server-side env.
