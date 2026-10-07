const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
  BorderStyle, ShadingType, AlignmentType, HeadingLevel, Footer, PageNumber,
  CheckBox,
} = require("docx");

const OTHER = "Другое: ______________________";
const YN = ["да", "нет"];

// ---------- data ----------
const blocks = [
  {
    title: "А. Зарплата учителя",
    note: "Самый важный блок — без него нельзя начинать разработку расчёта.",
    questions: [
      { id: "А1", star: true, text: "Как сейчас считается зарплата учителя?",
        items: [
          { opts: ["фиксированная сумма за одно занятие", "за час", "процент от оплат учеников", "за каждого пришедшего ученика", "фиксированная сумма в месяц", "комбинация (опишите ниже)"], multi: true },
          { text: "Пожалуйста, посчитайте для примера зарплату одного учителя за прошлый месяц так, как вы это делаете обычно (сколько занятий, какая ставка, итог):", lines: 7 },
        ] },
      { id: "А2", star: true, text: "Ставка у всех учителей одинаковая или у каждого своя?",
        items: [
          { opts: ["одинаковая у всех", "у каждого учителя своя"] },
          { label: "Зависит ли ставка от предмета / типа группы (математика, химия, ОРТ, продлёнка, индивидуальные)?", opts: YN },
          { text: "Если зависит — как именно:", lines: 3 },
        ] },
      { id: "А3", star: true, text: "Сколько длится одно занятие по математике / химии / ОРТ?",
        items: [
          { opts: ["60 минут", "80 минут", "90 минут", "120 минут", OTHER] },
          { label: "Одинаково для всех предметов и классов?", opts: YN },
        ] },
      { id: "А4", star: true, text: "Из-за чего обычно возникает спор с учителем в день зарплаты? (можно отметить несколько)",
        items: [
          { opts: ["количество занятий — «было / не было»", "длительность — опоздал, ушёл раньше", "число учеников на занятии", "размер ставки", "забыли учесть замену / перенос", OTHER], multi: true },
          { text: "Опишите последний такой спор:", lines: 4 },
        ] },
      { id: "А5", text: "Если на занятие никто из учеников не пришёл, а учитель был на месте — ему платят?",
        items: [{ opts: ["да, полностью", "да, частично (сколько: __________)", "нет"] }] },
      { id: "А6", text: "Отменённые занятия",
        items: [
          { label: "Занятие отменил центр (праздник, нет света и т.п.) — учителю платят?", opts: ["да", "нет", "частично"] },
          { label: "Занятие отменил сам учитель — что происходит?", opts: ["просто не платим", "штраф", OTHER] },
        ] },
      { id: "А7", text: "Бывают ли замены учителей?",
        items: [
          { opts: ["да", "нет"] },
          { label: "Если да — кому идёт оплата за занятие?", opts: ["заменяющему учителю", "основному учителю", "делится", OTHER] },
        ] },
      { id: "А8", text: "Бывают ли премии, штрафы, авансы?",
        items: [
          { opts: ["да", "нет"] },
          { text: "За что и как часто:", lines: 3 },
        ] },
      { id: "А9", text: "Когда день зарплаты и за какой период считается?",
        items: [
          { label: "День выплаты:", opts: ["1-е число", "5-е число", "10-е число", "другое: ________"] },
          { label: "Период:", opts: ["календарный месяц", "с ___ по ___ число", OTHER] },
        ] },
      { id: "А10", text: "Хотите ли вы, чтобы учитель сам видел в системе свою предварительную сумму в течение месяца?",
        items: [{ opts: ["да, часы и сумму", "только часы и занятия, без суммы", "нет, только бухгалтер и я"] }] },
    ],
  },
  {
    title: "Б. Занятия и посещаемость",
    questions: [
      { id: "Б1", text: "До какого момента учитель может отметить проведённое занятие?",
        items: [{ opts: ["только во время занятия", "до конца этого дня", "до конца недели", OTHER] }] },
      { id: "Б2", text: "Если учитель забыл отметить занятие — кто и как исправляет?",
        items: [{ opts: ["учитель сам может подтвердить позже, до конца месяца", "только администратор", "не отмечено — не оплачивается", OTHER] }] },
      { id: "Б3", text: "Переносы занятий на другой день",
        items: [
          { label: "Как часто бывают?", opts: ["часто", "редко", "не бывает"] },
          { text: "Как это оформляется сейчас (кто решает, где записывается):", lines: 3 },
        ] },
      { id: "Б4", text: "По какому календарю праздники и выходные?",
        items: [{ opts: ["государственные праздники КР", "свой список", "и то и другое"] }] },
      { id: "Б5", text: "Продлёнка: ребёнок пришёл на 1 час из 3",
        items: [
          { label: "Для ребёнка это:", opts: ["присутствовал (день засчитан)", "отсутствовал", "засчитывается часть", OTHER] },
          { label: "Учителю оплачивается:", opts: ["3 часа по плану", "по фактическому времени"] },
        ] },
      { id: "Б6", text: "Сколько сейчас активных групп и учителей?",
        items: [
          { text: "Групп: ______    Учителей: ______    Учеников (примерно): ______", lines: 1 },
          { label: "Типичное расписание выглядит как в Instagram (например «8 класс — ВТ, ЧТ, СБ 09:00 и 18:00»)?", opts: YN },
        ] },
    ],
  },
  {
    title: "В. Тарифы, абонементы, пропуски",
    questions: [
      { id: "В1", star: true, text: "Абонемент — это:",
        items: [{ opts: ["12 занятий (сколько бы времени они ни заняли)", "календарный месяц (неиспользованное сгорает)", OTHER] }] },
      { id: "В2", star: true, text: "Пропуски по уважительной причине",
        items: [
          { label: "Сколько таких пропусков за абонемент не сгорают?", opts: ["0", "1", "2", "3", "все", "другое: ____"] },
          { label: "Кто решает, что причина уважительная?", opts: ["учитель при отметке", "администратор", "вы сами"] },
          { text: "Что считается уважительной причиной:", lines: 3 },
        ] },
      { id: "В3", text: "Как отрабатываются пропуски?",
        items: [{ opts: ["ученик приходит в другую группу того же уровня", "проводится дополнительное занятие", "не отрабатываются — сгорают", "переносятся на следующий абонемент", OTHER] }] },
      { id: "В4", text: "Ученик пришёл в середине абонемента группы — он платит:",
        items: [{ opts: ["полный абонемент и начинает свой отсчёт 12 занятий", "пропорционально оставшимся занятиям", OTHER] }] },
      { id: "В5", text: "Скидки",
        items: [
          { label: "15 % бывшим ученикам действует:", opts: ["только первый абонемент / месяц", "постоянно", OTHER] },
          { label: "5 % «приведи друга» получает:", opts: ["тот, кто привёл", "новый ученик", "оба"] },
          { label: "На какой срок:", opts: ["один абонемент", "постоянно", OTHER] },
          { text: "Другие скидки (братья/сёстры, предоплата за несколько месяцев и т.п.):", lines: 3 },
        ] },
      { id: "В6", text: "Как часто меняются тарифы?",
        items: [{ opts: ["раз в год (в сентябре)", "чаще", "почти не меняются"] }] },
      { id: "В7", text: "Разрешено ли ходить «в долг», если абонемент закончился, а оплаты ещё нет?",
        items: [{ opts: ["да, максимум ______ занятий", "да, без ограничений", "нет"] }] },
      { id: "В8", text: "Бывают ли возвраты денег, если ученик ушёл с неиспользованным остатком?",
        items: [{ opts: ["да", "нет", "переносим на другого ребёнка / другую группу"] }] },
    ],
  },
  {
    title: "Г. Оплаты учеников",
    questions: [
      { id: "Г1", text: "Кто принимает деньги от родителей и кто должен записывать оплату в систему?",
        items: [
          { label: "Принимает:", opts: ["администратор", "бухгалтер", "учитель", "вы сами"], multi: true },
          { label: "Записывает в систему:", opts: ["администратор", "бухгалтер", "вы сами"], multi: true },
        ] },
      { id: "Г2", text: "Способы оплаты",
        items: [
          { opts: ["наличные", "Mbank", "Optima", "O!Деньги / Элсом", OTHER], multi: true },
          { label: "Нужно ли различать способ оплаты в отчётах?", opts: YN },
        ] },
      { id: "Г3", text: "Оплата всегда за целый абонемент или бывает частями?",
        items: [{ opts: ["всегда целиком", "бывает частями"] }] },
      { id: "Г4", text: "Нужен ли отчёт «сколько денег пришло за месяц по группам / учителям»?",
        items: [{ opts: YN }] },
    ],
  },
  {
    title: "Д. Люди и доступ",
    questions: [
      { id: "Д1", text: "Вход по номеру телефона и паролю; пароль выдаёт администратор; SMS-кодов нет. Подходит?",
        items: [{ opts: ["да", "нет (почему: ______________)"] }] },
      { id: "Д2", text: "Кто какие роли занимает?",
        items: [
          { label: "Администратор:", opts: ["вы сами", "вы + ещё человек (кто: __________)"] },
          { label: "Бухгалтер:", opts: ["отдельный человек", "вы сами", "пока нет"] },
        ] },
      { id: "Д3", text: "Должен ли учитель видеть, кто из его учеников не оплатил, чтобы напомнить родителям?",
        items: [{ opts: ["да — только «оплачено / не оплачено», без сумм", "да — с суммами", "нет, не должен видеть"] }] },
      { id: "Д4", text: "У всех учителей есть смартфон и интернет в центре?",
        items: [{ opts: YN }] },
      { id: "Д5", text: "Нужен ли доступ родителям (посмотреть баланс и посещаемость ребёнка)?",
        items: [{ opts: ["не нужен", "позже, не сейчас", "хотелось бы сразу"] }] },
    ],
  },
  {
    title: "Е. Данные и запуск",
    questions: [
      { id: "Е1", text: "Где сейчас ведётся учёт?",
        items: [
          { opts: ["тетрадь", "Excel", "Google Таблица", "WhatsApp / Telegram", OTHER], multi: true },
          { label: "Можно будет посмотреть пример за один месяц?", opts: YN },
        ] },
      { id: "Е2", text: "Переносить ли историю прошлых месяцев?",
        items: [{ opts: ["нет, начинаем с чистого листа", "да, с __________ (месяц)"] }] },
      { id: "Е3", text: "Готовы ли один месяц вести учёт параллельно — по-старому и в системе, чтобы сверить?",
        items: [{ opts: YN }] },
      { id: "Е4", text: "Какой учитель мог бы первым начать пользоваться системой (пилот)?",
        items: [{ text: "", lines: 2 }] },
      { id: "Е5", text: "В каком виде нужен итоговый расчёт для выплаты?",
        items: [{ opts: ["таблица Excel", "PDF на печать", "достаточно экрана в системе", OTHER], multi: true }] },
    ],
  },
];

// ---------- rendering ----------
const FONT = "Calibri";
const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 22, ...o });

function p(children, o = {}) {
  return new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 80 }, ...o });
}

const box = () => new CheckBox({ checked: false, checkedState: { value: "2612", font: "MS Gothic" }, uncheckedState: { value: "2610", font: "MS Gothic" } });
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const thin = { style: BorderStyle.SINGLE, size: 4, color: "9A9A9A" };
const W = 9638; // A4 text width at 2 cm margins (DXA)

function answerBox(lines) {
  const paras = [];
  for (let i = 0; i < lines; i++) paras.push(new Paragraph({ children: [run("")], spacing: { after: 0, line: 360 } }));
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: [W],
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: W, type: WidthType.DXA },
      borders: { top: thin, bottom: thin, left: thin, right: thin },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: paras,
    })] })],
  });
}

function optionParas(opts, multi) {
  const total = opts.reduce((s, o) => s + o.length + 4, 0);
  const hint = multi ? "  (можно несколько)" : "";
  if (total <= 70 && !opts.some(o => o.includes("___") && o.length > 20)) {
    const children = [];
    opts.forEach((o, i) => { if (i) children.push(run("      ")); children.push(box()); children.push(run(" " + o)); });
    if (hint) children.push(run(hint, { italics: true, color: "777777", size: 18 }));
    return [p(children, { indent: { left: 360 } })];
  }
  const out = opts.map(o => p([box(), run(" " + o)], { indent: { left: 360 }, spacing: { after: 40 } }));
  if (hint) out.unshift(p(run(multi ? "Можно отметить несколько:" : "", { italics: true, color: "777777", size: 18 }), { indent: { left: 360 }, spacing: { after: 20 } }));
  return out;
}

function renderQuestion(q) {
  const out = [];
  const head = [run(q.id + ".  ", { bold: true, color: "B8860B" }), run(q.text, { bold: true })];
  if (q.star) head.push(run("  ★ важно", { color: "C0392B", size: 18 }));
  out.push(new Paragraph({ children: head, spacing: { before: 240, after: 100 }, keepNext: true }));
  for (const it of q.items) {
    if (it.label) out.push(p(run(it.label, { italics: true }), { indent: { left: 360 }, spacing: { after: 40 }, keepNext: true }));
    if (it.opts) out.push(...optionParas(it.opts, it.multi));
    if (it.text !== undefined) {
      if (it.text) out.push(p(run(it.text, { italics: true }), { indent: { left: 360 }, spacing: { after: 60 }, keepNext: true }));
      if (it.lines > 0) { out.push(answerBox(it.lines)); out.push(p(run(""), { spacing: { after: 40 } })); }
    }
  }
  return out;
}

function blockHeading(title, note) {
  const cell = new TableCell({
    width: { size: W, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: "F9E79F", color: "auto" },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [run(title, { bold: true, size: 28 })], spacing: { after: note ? 40 : 0 } }),
      ...(note ? [p(run(note, { italics: true, size: 20, color: "555555" }), { spacing: { after: 0 } })] : []),
    ],
  });
  return [
    new Paragraph({ children: [run("")], spacing: { before: 200, after: 0 } }),
    new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W], rows: [new TableRow({ children: [cell] })] }),
  ];
}

const body = [];
body.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [run("IQ UP — анкета для запуска системы учёта", { bold: true, size: 40 })], spacing: { after: 120 } }));
body.push(p(run("Занятия · посещаемость · оплаты · зарплата учителей", { italics: true, color: "555555" }), { alignment: AlignmentType.CENTER, spacing: { after: 300 } }));

body.push(p([run("Каныкей, здравствуйте! ", { bold: true }), run("Чтобы система считала зарплату и баланс учеников именно по вашим правилам, нужно ответить на вопросы ниже. Это займёт 30–40 минут.")]));
body.push(p(run("Как заполнять:", { bold: true }), { spacing: { before: 120 } }));
body.push(p([box(), run(" → "), new CheckBox({ checked: true, checkedState: { value: "2612", font: "MS Gothic" }, uncheckedState: { value: "2610", font: "MS Gothic" } }), run("  кликните на квадратик рядом с подходящим вариантом — он отметится. Если открыли с телефона и клик не работает — просто напишите «да» рядом или выделите цветом.")], { indent: { left: 360 } }));
body.push(p(run("Если ни один вариант не подходит — заполните «Другое» или напишите в рамке своими словами."), { indent: { left: 360 } }));
body.push(p([run("Вопросы со значком "), run("★ важно", { color: "C0392B" }), run(" — самые главные: без них нельзя начать делать расчёт зарплаты. Если времени мало — ответьте сначала на них.")], { indent: { left: 360 } }));
body.push(p(run("Если на вопрос нет ответа или «так не бывает» — так и напишите, это тоже полезный ответ."), { indent: { left: 360 } }));

body.push(p(run("Что мы уже знаем из Instagram (поправьте, если неверно):", { bold: true }), { spacing: { before: 200, after: 60 } }));
const known = [
  ["Групповые (5–10 учеников)", "12 занятий — 3 200 сом"],
  ["Мини-группы (до 4)", "12 занятий — 3 800 сом"],
  ["Парные (2 ученика)", "12 занятий — 4 400 сом"],
  ["Индивидуальные", "12 занятий — 7 200 сом"],
  ["Продлёнка (до 8, пн–пт, 3 часа)", "20 занятий — 7 400 сом"],
  ["Акции", "15 % бывшим ученикам на первый месяц; 5 % «приведи друга»"],
];
const c1 = 4000, c2 = W - c1;
body.push(new Table({
  width: { size: W, type: WidthType.DXA }, columnWidths: [c1, c2],
  rows: known.map(([a, b], i) => new TableRow({ children: [
    new TableCell({ width: { size: c1, type: WidthType.DXA }, borders: { top: thin, bottom: thin, left: thin, right: thin }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, shading: { type: ShadingType.CLEAR, fill: "F4F4F4", color: "auto" }, children: [p(run(a), { spacing: { after: 0 } })] }),
    new TableCell({ width: { size: c2, type: WidthType.DXA }, borders: { top: thin, bottom: thin, left: thin, right: thin }, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [p(run(b), { spacing: { after: 0 } })] }),
  ] })),
}));
body.push(p(run("Исправления / что изменилось:", { italics: true }), { spacing: { before: 100, after: 60 } }));
body.push(answerBox(2));

for (const b of blocks) {
  body.push(...blockHeading(b.title, b.note));
  for (const q of b.questions) body.push(...renderQuestion(q));
}

body.push(...blockHeading("Ж. Что ещё важно?"));
body.push(p(run("Что в текущем учёте раздражает больше всего? Что система обязательно должна уметь, а что — лишнее? Любые мысли:", { italics: true }), { spacing: { before: 160, after: 60 } }));
body.push(answerBox(10));
body.push(p(run("Спасибо! Ответы можно прислать в этом же файле или просто фото заполненных страниц.", { italics: true, color: "555555" }), { spacing: { before: 200 }, alignment: AlignmentType.CENTER }));

const doc = new Document({
  creator: "Kairat",
  title: "IQ UP — анкета для запуска системы учёта",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 28, bold: true, color: "000000" }, paragraph: { spacing: { before: 0, after: 0 }, outlineLevel: 0 } },
      { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: FONT, size: 40, bold: true }, paragraph: { spacing: { after: 120 } } },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("IQ UP — анкета · стр. ", { size: 18, color: "777777" }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: "777777" })] })] }) },
    children: body,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = process.argv[2];
  fs.writeFileSync(out, buf);
  console.log("written", out, buf.length);
});
