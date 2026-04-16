export type IncomeRule = {
  match: string
  code: string
  name: string
}

export type ExpenseRule = {
  match: string
  code: string
  name: string
  group: string
}

export const importMapping = {
  incomeFallback: {
    code: "OTHER_SERVICES",
    name: "Прочие услуги",
  },
  expenseFallback: {
    code: "EXP-NONOPERATING",
    name: "Прочие внереализационные расходы",
    group: "Прочие внереализационные расходы",
  },
  incomeRules: [
    { match: "Поступление от услуг предоставления парковочных мест", code: "PARKING", name: "Паркинг" },
    { match: "Поступление от эксплуатационных услуг", code: "OPERATION", name: "Эксплуатация" },
    { match: "Поступление от услуг Коворкинга", code: "COWORKING", name: "Коворкинг" },
    { match: "Агентское вознаграждение", code: "OTHER_SERVICES", name: "Прочие услуги" },
    { match: "Постоянная часть арендной платы", code: "RENT_FIXED", name: "Аренда: постоянная часть" },
    { match: "Переменная часть арендной платы", code: "RENT_VARIABLE", name: "Аренда: переменная часть" },
    { match: "Процент", code: "INTEREST_INCOME", name: "Проценты к получению" },
    { match: "Реализац", code: "REAL_ESTATE_SALE", name: "Доходы от реализации недвижимости" },
    { match: "Коворкинг", code: "COWORKING", name: "Коворкинг" },
    { match: "Паркинг", code: "PARKING", name: "Паркинг" },
    { match: "Эксплуатац", code: "OPERATION", name: "Эксплуатация" },
    { match: "Аренд", code: "RENT_FIXED", name: "Аренда: постоянная часть" },
  ] satisfies IncomeRule[],
  expenseRules: [
    { match: "НДФЛ", code: "EXP-NDFL", name: "НДФЛ", group: "Налоги и сборы" },
    { match: "Страховые взносы", code: "EXP-INSURANCE-CONTRIB", name: "Страховые взносы", group: "Расходы на персонал" },
    { match: "взносы от ФОТ", code: "EXP-INSURANCE-CONTRIB", name: "Страховые взносы", group: "Расходы на персонал" },
    { match: "Оплата труда", code: "EXP-SALARY", name: "Заработная плата", group: "Расходы на персонал" },
    { match: "Выплата заработной платы", code: "EXP-SALARY", name: "Заработная плата", group: "Расходы на персонал" },
    { match: "Заработная плата по реестру", code: "EXP-SALARY", name: "Заработная плата", group: "Расходы на персонал" },
    { match: "Заработная плата", code: "EXP-SALARY", name: "Заработная плата", group: "Расходы на персонал" },
    { match: "Комиссии и услуги банков", code: "EXP-BANK-FEE", name: "Комиссии и услуги банков", group: "Прочие внереализационные расходы" },
    { match: "Доработка и обновление ПО", code: "EXP-SOFTWARE", name: "Расходы на программное обеспечение", group: "Административно-управленческие расходы" },
    { match: "Подача воды, отведение стоков", code: "EXP-UTIL-WATER", name: "Водоснабжение и водоотведение", group: "Коммунальные расходы" },
    { match: "Плата за негативное воздействие на ЦСВ", code: "EXP-UTIL-WATER", name: "Водоснабжение и водоотведение", group: "Коммунальные расходы" },
    { match: "Электроэнергия", code: "EXP-ELECTRICITY", name: "Электроэнергия", group: "Коммунальные расходы" },
    { match: "Тепло", code: "EXP-UTIL-HEAT", name: "Теплоснабжение и ГВС", group: "Коммунальные расходы" },
    { match: "Отоплен", code: "EXP-UTIL-HEAT", name: "Теплоснабжение и ГВС", group: "Коммунальные расходы" },
    { match: "ГВС", code: "EXP-UTIL-HEAT", name: "Теплоснабжение и ГВС", group: "Коммунальные расходы" },
    { match: "Штрафные санкции налоговых и иных органов", code: "EXP-TAX", name: "Налоги и сборы", group: "Налоги и сборы" },
    { match: "Единый налоговый платеж", code: "EXP-TAX", name: "Налоги и сборы", group: "Налоги и сборы" },
    { match: "Налог", code: "EXP-TAX", name: "Налоги и сборы", group: "Налоги и сборы" },
    { match: "Обслуживание и ремонт", code: "EXP-MAINT-EQUIP", name: "Текущие расходы на содержание помещений и оборудования", group: "Текущие расходы на содержание помещений и оборудования" },
    { match: "Текущий ремонт", code: "EXP-MAINT-CURRENT", name: "Текущие эксплуатационные и ремонтные расходы", group: "Текущие эксплуатационные и ремонтные расходы" },
    { match: "Материалы на содержание", code: "EXP-MAINT-CURRENT", name: "Текущие эксплуатационные и ремонтные расходы", group: "Текущие эксплуатационные и ремонтные расходы" },
    { match: "Охран", code: "EXP-SECURITY", name: "Охрана помещений, контроль доступа", group: "Охрана помещений, контроль доступа" },
    { match: "Контроль доступа", code: "EXP-SECURITY", name: "Охрана помещений, контроль доступа", group: "Охрана помещений, контроль доступа" },
    { match: "Реклам", code: "EXP-MARKETING", name: "Маркетинг и реклама", group: "Маркетинг и реклама" },
    { match: "Маркет", code: "EXP-MARKETING", name: "Маркетинг и реклама", group: "Маркетинг и реклама" },
    { match: "Коворкинг", code: "EXP-COWORKING", name: "Расходы на содержание коворкинга", group: "Расходы на содержание коворкинга" },
    { match: "Капремонт помещений", code: "EXP-CAPEX-PREMISES", name: "Инвестиционные расходы на капремонт помещений", group: "Инвестиционные расходы" },
    { match: "Капремонт сет", code: "EXP-CAPEX-EQUIP", name: "Инвестиционные расходы на капремонт сетей и оборудования", group: "Инвестиционные расходы" },
    { match: "Капремонт оборуд", code: "EXP-CAPEX-EQUIP", name: "Инвестиционные расходы на капремонт сетей и оборудования", group: "Инвестиционные расходы" },
  ] satisfies ExpenseRule[],
}
