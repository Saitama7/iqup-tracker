# CLAUDE.md — правила работы Claude Code в IQUP Tracker

## Контекст
Система учёта занятий, посещаемости, оплат и зарплат для учебного центра IQ UP (Бишкек). Один центр, ~10 учителей, ~200 учеников. Эксплуатация бесплатная: Cloudflare Pages + Supabase Free. Сервера нет — SPA + Postgres (RLS, views, триггеры) + одна Edge Function `create-user`.

Перед любой задачей прочитай `docs/05-decisions.md` (подтверждённые правила владелицы), `docs/01-domain-model.md` (термины и модель), `docs/02-architecture.md` (где что живёт) и `docs/06-design.md` (какой артборд = какой маршрут). Если правило не описано там — **не придумывай**, напиши вопрос в issue и остановись.

Ключевая формула: за каждого ученика на каждом проведённом занятии учитель получает `процент_учителя × (цена_пакета / уроков_в_пакете)` по полной цене **абонемента, с которого списан урок** (`attendance.subscription_id` → `price_full / lessons_total`, К6), а не по тарифу на дату занятия; скидки не влияют; процент — на дату занятия. Период — календарный месяц, выплата 15-го. Продлёнка (К13, #111, И93): **пакет дней за сумму**, как остальные типы (`lessons_total` = дней, цена своя `p_price`, 12 дней за 5 400), ЗП — `% × price_full / lessons_total` за проведённый день ученика; график ученика (`afterschool_plans`, И59) определяет только состав занятия, отметка в день с 0 ч не списывается и не начисляется (`consumes_credit`), смена графика с прошлой даты удаляет отметки ставших-нулевыми дней (журнал, предпросмотр). Помесячный счёт в часах (`hours_total`, `issue_afterschool_invoice`, кредит часов, `v_afterschool_unbilled`) отключён.

## Как устроена работа
- **Backlog — GitHub Issues** этого репо. Одна issue = одна задача для Claude Code; в ней контекст, экраны, что сделать, критерии приёмки. Задачи заводит и ревьюит Claude (Cowork, менеджер проекта); Кайрат запускает `claude` в терминале и говорит «сделай #N».
- **Ветка** `feat/N-kebab-slug` (или `fix/`, `chore/`) от свежего `main`. Коммиты — Conventional Commits на русском или английском: `feat(attendance): лимит заморозок (#N)`.
- **PR** на `main` по шаблону `.github/PULL_REQUEST_TEMPLATE.md`, заголовок `#N · <суть>`, в теле `Closes #N`. Один PR = одна issue. Открывай PR через `gh pr create`, не мержи сам — мержит Кайрат после ревью.
- **Definition of Done:** `pnpm lint && pnpm typecheck && pnpm test` зелёные, для UI-задач — e2e или скриншот WebKit 390 px приложен к PR, для миграций — `supabase db reset` проходит и есть pgTAP-тест RLS, все пункты «Критерии приёмки» из issue отмечены в PR, CLAUDE.md/документация обновлены, если менялось поведение.
- Нашёл расхождение между docs и issue, или issue требует решения по бизнес-правилу — **не додумывай**: оставь комментарий в issue с вопросом и сделай только однозначную часть.

## Стек
Vite + React 19 + TypeScript (strict) · TanStack Router + Query · Tailwind v4 + shadcn/ui + Motion + lucide · PWA (`vite-plugin-pwa`) · Supabase (Postgres, Auth, RLS, Realtime, Edge Function `create-user`) · SQL-миграции в `supabase/migrations` · Cloudflare Pages · Vitest · Playwright (WebKit) · pnpm.

Никакого Node-бэкенда, Server Actions, ORM. Вся логика доступа — RLS, расчёты — SQL-views + чистые TS-функции.

## UI
Палитра и принципы — `docs/02-architecture.md` §3; макет — артборды в `docs/design/*.dc.html` (экспорт канваса Claude Design, см. `docs/design/README.md`), каждый артборд = маршрут; перед реализацией экрана открой его артборд и воспроизведи структуру и тексты 1:1. Шрифты Unbounded (заголовки, суммы) + Manrope (текст) через `@fontsource`. Телефон 390 px и десктоп 1280 px — один маршрут, разные `MobileShell` / `DesktopShell` по `matchMedia('(min-width: 900px)')`. Safari: `100dvh`, safe-area, 16 px в инпутах, анимировать только `transform`/`opacity`, `prefers-reduced-motion` отключает 3D. 3D только в трёх местах (колода занятий, flip ученика, tilt карточки ЗП). Цвета — токены из `src/styles/tokens.css`, не hex в компонентах; вторичный текст — `text-ink-muted`, бирюза (время, ссылки, заморозка) — `text-teal`/`bg-teal`, а `muted`/`accent` — светлые поверхности shadcn (не путать). Кнопки по умолчанию 44 px (`size="default"`/`"icon"`), `sm` — только для плотных десктопных таблиц. Статус всегда цвет + текст. «Назад» — только `BackButton` (`src/components/shell/back-button.tsx`): на телефоне `MobileShell` сам ставит его на не-табовых экранах, pushed-экраны (`isPushedScreen`) кладут его в свою шапку; родитель — `backTarget()` в `nav.ts`; ссылка на карточку занятия всегда передаёт источник (`from*` из `src/features/lessons/return-to.ts`, И64), состояние вкладок/фильтров экрана — в URL. Диалоги/шиты из `@/components/ui` на телефоне закрываются системной «назад» (`useBackClose`). Бейджи и телефоны — `whitespace-nowrap`. Поля дат — `DateInput` (ДД.ММ.ГГГГ + календарь, `min`/`max` ISO), заголовки периодов — `DatePickerButton` / `MonthPickerButton` из `src/components/ui/date-picker.tsx` (И46); на телефоне тап по полю — шторка, ручной ввод — «Ввести вручную» (И46+). Выбор ученика из списка — `StudentPicker` (`src/features/students/student-picker.tsx`: поиск по `nameKey`/телефону, поповер / шторка, опционально статус и чипы «Не оплатили», #93). Тосты (`sonner`, `src/routes/__root.tsx`): до 900 px — сверху по центру (внизу таб-бар и панели действий), на десктопе — справа снизу.

## Время и синхронизация (`docs/02-architecture.md` §7.1)
`useNow()` тикает раз в 30 с, всё зависящее от времени — чистые функции от `(data, now)`. `now = Date.now() + serverOffset` (offset берём RPC `server_now()` при входе). На `visibilitychange`/`focus`/`online` — немедленный tick + `invalidateQueries`. Чужие изменения — Supabase Realtime → `invalidateQueries`; страховка `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchInterval: 60_000`. Времена в таблицы пишет только БД (`default now()`).

## Инварианты домена — нарушать нельзя
1. `lessons.confirmed_at` ставит только БД в `confirm_lesson`; сбросить его может только `unconfirm_lesson` с причиной (журнал; админ, открытый период, отметки удаляются — И76, #95). Дату, время, длительность и учителя проведённого занятия меняет только админ — `update_lesson` с причиной и предпросмотром ЗП (И79) или `change_group_teacher`.
2. Закрытый период (`payroll_periods`, `lessons.is_locked = true`) — единственная «стена»: в нём ничего не меняется никем, включая админа; закрывают admin и accountant (`close_payroll_period`), открыть обратно — только admin с причиной (`reopen_payroll_period`, И77), после чего правки как в открытом. Вне закрытого периода админ — суперадминистратор (Г9, #94): правит и удаляет что угодно, но только через RPC `security definer` с причиной (1…500), строкой в журнале и предпросмотром «учитель → ±сом», если меняется начисленная ЗП; гарды пропускают такие правки только по флагу `iqup.admin_edit` изнутри RPC. Отметки проведённого занятия исправляет админ — `correct_attendance`, учитель своего занятия в открытом периоде — `teacher_correct_attendance` (К10, И92; `attendance_guard` пускает его по флагу `iqup.teacher_correct`); старые запросы `attendance_correction_requests` (И52) решает админ. Смена тарифа не меняет уже начисленное: ЗП — по цене абонемента (К6); новый тариф для типа с абонементами по умолчанию — с 1-го числа следующего месяца (`tariffs_guard`), «Применить с сегодняшнего дня» и правка действующей версии — только админ с причиной (И80).
3. Баланс ученика и сумма ЗП **вычисляются** из первичных данных (views / чистые функции), не хранятся как редактируемые числа.
4. Любое изменение `lessons`, `attendance`, `subscriptions`, `payments`, `teacher_rates`, `enrollments`, `trials`, `tariffs`, `subjects`, `attendance_correction_requests`, `attendance_presets`, `afterschool_plans`, `payroll_periods`, `holidays` (а также смена учителя и удаление `groups`, удаление `students`) попадает в `audit_log` триггером (`write_audit_log`). Экран — А10 `/admin/audit` из `v_audit_feed` (0014), описания строк — `describeAuditRow` в `src/features/audit/describe.ts`; новая таблица с аудитом → добавить её описание и тест.
5. `attendance.consumes_credit` ⇔ `status ∈ {present, absent_burned}` и не продлёнка в день с 0 ч по графику (`hours = 0`, К13); лимит заморозок снят (К9, #108): `tariffs.freeze_limit = null` — без лимита, `enforce_freeze_limit` ограничивает только при заданном числе.
6. ЗП начисляется `lessons.teacher_id` (при создании = `groups.teacher_id`; смена учителя группы — с даты, `change_group_teacher`, #73), никогда `substitute_teacher_id`. Отменённые занятия не оплачиваются и не списывают уроки. Пробные (`trials`) не списывают урок, не начисляются и не входят в заполненность.
7. Все правила доступа — в RLS. Клиент дублирует проверку роли для UI, но не заменяет RLS.
8. Время — `timestamptz` в БД, отображение в `Asia/Bishkek` (UTC+6, без летнего времени).

## Правила кода
- Логика расчёта ЗП и баланса — чистые функции `src/features/payroll/calc.ts`, `src/features/payments/balance.ts` с тестами. Та же логика в SQL-view (`v_payroll_preview`, `v_student_balance`) — при изменении менять оба места и тест, сверяющий их на одном сиде (`tests/integration/payroll.test.ts`, `balance.test.ts`). Оплаты пишет только админ через RPC `record_payment` / `buy_subscription` / `refund_subscription` (0016); «Что оплачивает» — `payOptions` (`model.ts`): все абонементы зачисления, которому должны, затем «новый» (И94, #119); размер нового абонемента — `p_lessons` (1 … 2 × пакета, цена `round(package_price × N / lessons_in_package)`, И89, 0030) в `buy_subscription` / `enroll_student` / `enroll_trial`, UI — `LessonsField`; своя цена — `p_price` (1 … 1 000 000, `null` — `subscription_default_price`: индивидуальные — 12 **часов** за цену пакета, 1,5 ч → 8 занятий по 900, К11; И91, 0033) там же и в `transfer_student`, UI — `PriceField`; внесённый абонемент админ меняет с причиной и предпросмотром ЗП / баланса — `update_subscription` / `subscription_update_preview` / `subscription_balance_preview` (`subscriptions_guard` пускает правку размера и цены только из неё), «⋯ → Изменить абонемент»; ошибочную оплату админ удаляет / правит с причиной — `delete_payment` / `update_payment` (0026, Г10; перенос на другой абонемент зачисления — `p_subscription_id`, 0036, И94; `payments_guard` пускает UPDATE/DELETE только из них); перенос/возврат при выходе из группы — `transfer_student` / `withdraw_enrollment` / `delete_enrollment` (#81, `payments.kind = transfer` — пара записей, в итогах А7 не считается). Авансы — админ и бухгалтер через `issue_advance` / `delete_payroll_adjustment` (0022, И53); «К выплате» = начислено − авансы (`v_payroll_preview.to_pay` ↔ `calc.ts` `toPay`).
- Доступ к БД — `supabase-js` из `src/features/*/api.ts`, вход валидируется `zod`. Каждая новая таблица создаётся сразу с RLS-политиками и pgTAP-тестом «учитель не видит чужое».
- Миграции только вперёд, имена `NNNN_slug.sql`; никаких правок уже применённых миграций. После миграции — `supabase gen types` и коммит `types.gen.ts`.
- Экраны за входом — `src/routes/_app/*` (сессия обязательна); роль — `requireRole(context.auth, '…'[, '…'])` (любая из ролей) в `beforeLoad` → страница 403. Пункты меню по ролям — `src/components/shell/nav.ts`, сессия — `useSession()` из `src/lib/auth.tsx`, время — только `useNow()` из `src/lib/now.ts`.
- Интерфейс на русском. Тестовые данные — из `supabase/seed.sql` (имена и группы совпадают с макетом: Гульзат, 8 класс А, Айжан Б. и т. д.).
- Перед коммитом: `pnpm lint && pnpm typecheck && pnpm test`. Если в шелле выставлен `NODE_ENV=production`, vitest падает на `React.act` — запускай `NODE_ENV=test pnpm test`. Node ≥ 22 (`nvm use 22`).
- После `shadcn add` проверь импорты: генератор может переписать `@/lib/utils` на пакет `cn` — лишний пакет в `package.json` не оставлять.
- Триггерные функции — по одной на таблицу (`lessons_guard`, `attendance_guard`…), не одна общая.
- Решения, принятые при ревью без Каныкей, — `docs/05-decisions.md` блок И; они обязательны так же, как ✅.

## Команды
```
pnpm dev                 # vite dev
supabase start           # локальный Postgres + Auth + Realtime
supabase db reset        # применить миграции + seed
supabase test db         # pgTAP-тесты RLS
pnpm seed:users          # логины для сид-людей, пароль iqup-demo (после db reset)
supabase functions serve # Edge Function create-user локально
pnpm test:integration    # supabase-js + create-user против локального стека
pnpm gen:types           # supabase gen types typescript --local > src/lib/supabase/types.gen.ts
pnpm test                # vitest
pnpm e2e                 # playwright webkit 390 + 1280; нужен supabase start + pnpm seed:users; E2E_PORT=… если 4173 занят
                         # payroll.spec сверяет сид (сентябрь проведён, 38 160 у Гульзат); спеки, временно меняющие сид (группы/ученики/занятия, тарифы, праздники), берут lockSeed('write'), пинящие его числа — lockSeed('read') (tests/e2e/support/seed-lock.ts)
                         # фикстуры групп/учеников чистит wipeFixtures (support/undo-fixtures.ts, одна транзакция, ошибки наружу), смена пользователя — switchUser (support/auth.ts); CI идёт в 2 воркера
pnpm build               # деплой — push в main (Cloudflare Pages)
```

## MCP в этом репо (`.mcp.json`)
shadcn — компоненты и блоки; Context7 — актуальные доки библиотек (используй перед тем, как писать код по Tailwind v4 / TanStack / Supabase); Playwright — скриншоты в WebKit; Supabase — схема и типы (read-only); 21st.dev Magic — UI-компоненты (нужен `MAGIC_API_KEY` в окружении).

## Чего не делать
- Не добавлять функциональность вне открытых issues без явного решения Кайрата.
- Не включать платные сервисы (SMS, платные тиры), не добавлять Node-бэкенд.
- Не хранить service-role ключ нигде, кроме секретов Supabase Edge Functions и GitHub Actions.
- Не мержить PR и не пушить в `main` напрямую.
