# CLAUDE.md — правила работы агентов в IQUP Tracker

## Контекст
Система учёта занятий, посещаемости, оплат и зарплат для учебного центра IQ UP (Бишкек). Один центр, ~10 учителей, ~200 учеников. Эксплуатация должна оставаться бесплатной (Vercel Hobby + Supabase Free).

Перед любой задачей прочитай `docs/05-decisions.md` (подтверждённые правила владелицы), `docs/01-domain-model.md` (термины и модель) и `docs/02-architecture.md` (где что живёт). Если правило не описано там — **не придумывай**, спроси Кайрата.

Ключевая формула: за каждого ученика на каждом проведённом занятии учитель получает `процент_учителя × (цена_пакета / уроков_в_пакете)` по полному тарифу (скидки не влияют). Период — календарный месяц, выплата 15-го.

## Роли
- Кайрат — технический руководитель, принимает решения по продукту и архитектуре.
- Claude — проектирует, пишет код и тесты, документирует. Предлагает, не решает за владельца бизнес-правила.

## Стек
Vite + React 19 + TypeScript (strict), SPA · TanStack Router + Query · Tailwind v4 + shadcn/ui + Motion + lucide · PWA (`vite-plugin-pwa`) · Supabase (Postgres, Auth, RLS, одна Edge Function `create-user`) · SQL-миграции в `supabase/migrations` · Cloudflare Pages · Vitest · Playwright (WebKit) · pnpm.

Сервера нет: вся логика доступа — RLS, расчёты — SQL-views. Никакого Node-бэкенда не добавлять.

## UI
Палитра и принципы — `docs/02-architecture.md` §3; прототип — Claude Design канвас «IQ UP Tracker — экраны учителя». Шрифты Unbounded (заголовки) + Manrope (текст) через `@fontsource`. Mobile-first 390 px, Safari: `100dvh`, safe-area, 16 px в инпутах, анимировать только `transform`/`opacity`, `prefers-reduced-motion`. 3D только в трёх местах (колода занятий, flip ученика, tilt карточки ЗП).

## Инварианты домена — нарушать нельзя
1. `lessons.confirmed_at` ставится один раз системным временем и никогда не редактируется.
2. Записи в закрытом периоде (`is_locked = true`) не меняются никем. Исправления — только `payroll_adjustments`.
3. Баланс ученика и сумма ЗП **вычисляются** из первичных данных (views/чистые функции), не хранятся как редактируемые числа.
4. Любое изменение `lessons`, `attendance`, `subscriptions`, `payments`, `teacher_rates`, `enrollments` попадает в `audit_log` триггером.
4a. `attendance.consumes_credit` ⇔ `status ∈ {present, absent_burned}`; `absent_frozen` на одном абонементе — не больше `tariff.freeze_limit` (2).
4b. ЗП начисляется `group.teacher_id`, никогда `substitute_teacher_id`. Отменённые занятия не оплачиваются и не списывают уроки.
5. Все правила доступа — в RLS. Server Action дублирует проверку роли, но не заменяет RLS.
6. Время — `timestamptz` в БД, отображение в `Asia/Bishkek`.

## Правила кода
- Логика расчёта ЗП и баланса — чистые функции в `src/features/payroll/calc.ts` и `src/features/payments/balance.ts`, покрытые тестами. Та же логика в SQL-view — при изменении менять оба места и тест, сверяющий их.
- Запись в БД — через `supabase-js` из `features/*/api.ts` с валидацией `zod` на входе; RLS — единственная защита, поэтому каждая новая таблица создаётся сразу с политиками и тестом «учитель не видит чужое».
- Интерфейс на русском. Экраны учителя — mobile-first (360 px).
- Миграции только вперёд; никаких правок уже применённых миграций.
- Перед коммитом: `pnpm lint && pnpm typecheck && pnpm test`.

## Команды
```
pnpm dev                 # vite dev
supabase start           # локальный Postgres + Auth
supabase db reset        # применить миграции + seed
supabase gen types typescript --local > src/lib/supabase/types.gen.ts
pnpm test                # vitest
pnpm e2e                 # playwright (webkit, iPhone viewport)
pnpm build && npx wrangler pages deploy dist   # ручной деплой (обычно — push в main)
```

## MCP в этом репо (.mcp.json)
21st.dev Magic — UI-компоненты; shadcn — компоненты/блоки; Context7 — доки; Supabase — миграции и типы; Playwright — скриншоты в WebKit.

## Чего не делать
- Не добавлять функциональность вне `docs/03-project-plan.md` без явного решения Кайрата.
- Не включать платные сервисы (SMS, платные тиры).
- Не хранить service-role ключ нигде, кроме server-side env.
