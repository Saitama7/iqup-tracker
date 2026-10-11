# Артборды макета (источник правды для UI)

Это экспорт канваса Claude Design «IQ UP Tracker — дизайн всех экранов» (ссылка в `../06-design.md`). Каждый `*.dc.html` — самодостаточная HTML-страница одного экрана: открой в браузере или читай разметку — там финальные тексты, отступы, цвета (hex из палитры = токены в `src/styles/tokens.css`), состояния. `canvas.json` — какой файл какому артборду соответствует (заголовки вида «У1 · Вход»).

Как пользоваться при реализации экрана:
1. Найти артборд в таблице `../06-design.md` (маршрут → артборд) и открыть соответствующий `.dc.html`.
2. Воспроизвести структуру и тексты 1:1; цвета — через токены/утилиты (`bg-brand`, `text-ink-muted`, `bg-teal`…), не hex.
3. Телефон 390 px и десктоп 1280 px — разные артборды одного маршрута (например `Login` и `TeacherToday` / `Main`).
4. Снять скриншот WebKit и сравнить с артбордом перед PR.

Соответствие имён (кратко): Login=У1, Main=У2, Attendance=У3, Groups=У4, GroupDetail=У5, MyMonth=У6, Profile=У7, TeacherToday=УД1, TeacherAttendance=УД2, TeacherGroupsDesk=УД3, TeacherMonthDesk=УД4, AdminDashboard=А1, AdminSchedule=А2, AdminGroups=А3, AdminGroup=А4, AdminStudents=А5, AdminStudent=А6, AdminPayments=А7, AdminUsers=А8, AdminSettings=А9 (+SettingsTariffHistory=А9а), AuditLog=А10, AdminTrials=А11, AdminMobileToday=АМ1, AdminMobileStudent=АМ2, AdminMobilePayment=АМ3, Payroll=Б1 (+PayrollPeriods=Б1а, PayrollClose=Б1б, PayrollCompare=Б1в), PayrollTeacher=Б2 (+PayrollAdjustment=Б2а, PayrollSlip=Б2б), MoneyReport=Б3, AccMobilePayroll=БМ1, AccMobileTeacher=БМ2.

Файлы не редактировать руками — правки делаются в канвасе и переэкспортируются.
