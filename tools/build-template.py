#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Обновление ID_shablon.xlsx под текущий состав справочников и доработки инструмента.

Почему правка идёт по XML, а не через библиотеку работы с книгами: в шаблоне
двадцать проверок ввода (выпадающие списки, в том числе связанный список марок
опор через INDIRECT), семь листов с примечаниями и собственное оформление.
Пересохранение книги любой библиотекой всё это теряет. Поэтому листы
справочников перегенерируются целиком, а остальное правится точечно.
"""
import io, os, re, shutil, sys, zipfile, subprocess, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ID_shablon.xlsx')      # правится на месте
WORK = os.path.join(ROOT, '.tplwork')
OUT = SRC
REFS = os.path.join(ROOT, 'tools', 'refs.json')  # выгрузка справочников из ядра

# ---------------------------------------------------------------- данные ядра
if not os.path.exists(REFS):
    sys.exit('Нет tools/refs.json — выполните: node tools/dump-refs.js')
REF = json.load(io.open(REFS, encoding='utf-8'))

KV_ORDER = ['0,4', '6', '10', '10/0,4', '35', '110']
# Классы, для которых своих марок в справочнике нет: показываем ближайший
# доступный перечень и честно это подписываем.
KV_FALLBACK = [('20', 'Опоры_10', 'своих марок нет — показан перечень 10 кВ (серии 6—20 кВ общие)'),
               ('150', 'Опоры_110', 'своих марок нет — показан перечень 110 кВ'),
               ('220', 'Опоры_110', 'своих марок нет — показан перечень 110 кВ'),
               ('330', 'Опоры_110', 'своих марок нет — показан перечень 110 кВ')]

def esc(v):
    return (str(v).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))

def colname(i):
    """0 -> A, 25 -> Z, 26 -> AA"""
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def cell(col, row, value, style=None):
    if value is None or value == '':
        return ''
    ref = '%s%d' % (colname(col), row)
    st = ' s="%s"' % style if style is not None else ''
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return '<c r="%s"%s t="n"><v>%s</v></c>' % (ref, st, value)
    return ('<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
            % (ref, st, esc(value)))

def sheet_xml(rows, cols=None, freeze=None):
    """rows: список списков [(значение, стиль), …]; индекс строки — с 1."""
    body = []
    maxc = 0
    for ri, r in enumerate(rows, start=1):
        cs = []
        for ci, item in enumerate(r):
            if item is None:
                continue
            v, st = item if isinstance(item, tuple) else (item, None)
            c = cell(ci, ri, v, st)
            if c:
                cs.append(c)
                maxc = max(maxc, ci + 1)
        if cs:
            body.append('<row r="%d">%s</row>' % (ri, ''.join(cs)))
    ref = 'A1:%s%d' % (colname(max(maxc, 1) - 1), max(len(rows), 1))
    colxml = ''
    if cols:
        colxml = '<cols>' + ''.join(
            '<col width="%s" customWidth="1" min="%d" max="%d"/>' % (w, i + 1, i + 1)
            for i, w in enumerate(cols)) + '</cols>'
    pane = ''
    if freeze:
        pane = ('<sheetView workbookViewId="0"><pane xSplit="0" ySplit="%d" topLeftCell="A%d"'
                ' activePane="bottomLeft" state="frozen"/></sheetView>' % (freeze, freeze + 1))
        pane = '<sheetViews>%s</sheetViews>' % pane
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<dimension ref="%s"/>%s%s<sheetData>%s</sheetData></worksheet>'
            % (ref, pane, colxml, ''.join(body)))

# стили, подсмотренные в исходном шаблоне
S_TITLE, S_NOTE, S_HEAD, S_BODY, S_MAPHEAD = '1', '2', '2', '3', '27'

# ------------------------------------------------------------ Спр_Опоры
def build_poles():
    rows = []
    rows.append([(u'СПРАВОЧНИК МАРОК ОПОР ПО ТИПОВЫМ ПРОЕКТАМ', S_TITLE)])
    rows.append([(u'Допустимый изгибающий момент задан ПО СТОЙКЕ, а не по назначению опоры: '
                  u'одна и та же стойка не может иметь разные допустимые моменты. Подкосы, вторая '
                  u'стойка и оттяжки анкерных опор в запас несущей способности не учитываются. '
                  u'Момент от тяжения на анкерных, угловых, концевых и ответвительных опорах '
                  u'считается отдельно — см. графу «Схема». Отметка «по аналогии» в графе K означает, '
                  u'что момент, высота подвеса и габаритный пролёт приняты по стойке-аналогу: '
                  u'марка, назначение, серия и стойка взяты из типового проекта, а расчётные '
                  u'величины перед выпуском отчёта подтверждаются по проекту.', S_NOTE)])
    head = [u'Класс напряжения, кВ', u'Марка опоры', u'Материал', u'Тип по назначению',
            u'Типовой проект / серия', u'Стойка', u'Схема (учёт тяжения)',
            u'Доп. изгибающий момент стойки, кН·м', u'Высота подвеса, м',
            u'Габаритный пролёт, м', u'Источник расчётных величин', '',
            u'Класс', u'Имя диапазона', u'Примечание к перечню']
    rows.append([(h, S_HEAD) if h else None for h in head])

    ranges = {}
    r = 4
    for kv in KV_ORDER:
        first = r
        for p in REF['poles']:
            if p['kv'] != kv:
                continue
            rows.append([
                (p['kv'], S_BODY), (p['mark'], S_BODY), (p['mat'], S_BODY), (p['type'], S_BODY),
                (p['proj'], S_BODY), (p['st'], S_BODY), (p['sch'], S_BODY),
                (p['m_adm'], S_BODY), (p['h'], S_BODY), (p['lgab'], S_BODY),
                ((u'по аналогии со стойкой' if p.get('approx') else u'типовой проект'), S_BODY)])
            r += 1
        ranges[kv] = (first, r - 1)

    # таблица соответствия «класс → имя диапазона» для связанного списка марок
    def rng(kv):
        # имя именованного диапазона: запятая и дробь в именах Excel недопустимы
        return u'Опоры_' + kv.replace(',', '_').replace('/', '_')
    mapping = [(kv, rng(kv), '') for kv in KV_ORDER] + KV_FALLBACK
    for i, (kv, nm, note) in enumerate(mapping):
        ri = 4 + i                       # таблица соответствия начинается со строки 4
        while len(rows) < ri:
            rows.append([])
        row = rows[ri - 1] if ri - 1 < len(rows) else []
        while len(row) < 15:
            row.append(None)
        row[12] = (kv, None)
        row[13] = (nm, None)
        row[14] = (note, None) if note else None
        if ri - 1 < len(rows):
            rows[ri - 1] = row
        else:
            rows.append(row)
    # заголовки таблицы соответствия
    while len(rows[2]) < 15:
        rows[2].append(None)
    rows[2][12] = (u'Класс', S_MAPHEAD)
    rows[2][13] = (u'Имя диапазона', S_MAPHEAD)
    rows[2][14] = (u'Примечание к перечню', S_MAPHEAD)

    cols = ['14', '34', '26', '36', '26', '20', '22', '16', '14', '16', '24', '3', '10', '16', '46']
    return sheet_xml(rows, cols, freeze=3), ranges

# ------------------------------------------------------------ Спр_Кабели
def build_cables():
    rows = [[(u'СПРАВОЧНИК МАРОК РАЗМЕЩАЕМЫХ КАБЕЛЕЙ (ОКСН, ОКГТ, ОКНН, КМЖ и др.)', S_TITLE)],
            [(u'Характеристики типовые для класса и подлежат уточнению по паспорту конкретного '
              u'изделия. Тип элемента и диапазон напряжений — по ТТ № 282р. Свои марки заводятся '
              u'в разделе «Справочники» рабочего места и в этот лист не переносятся: '
              u'книга — снимок данных, справочник живёт в самом инструменте.', S_NOTE)]]
    head = [u'Марка', u'Тип элемента', u'Наружный диаметр, мм', u'Погонная масса, кг/км',
            u'Допустимое тяжение, кН', u'Область применения (кВ)', u'Примечание']
    rows.append([(h, S_HEAD) for h in head])
    for c in REF['cables']:
        rows.append([(c['mark'], S_BODY), (c.get('type', ''), S_BODY), (c['d'], S_BODY),
                     (c['m'], S_BODY), (c.get('t', ''), S_BODY),
                     (c.get('area', ''), S_BODY), (c.get('note', ''), S_BODY)])
    return sheet_xml(rows, ['30', '44', '18', '18', '18', '20', '34'], freeze=3)

# ------------------------------------------------------------ Спр_Провода (новый)
def build_wires():
    rows = [[(u'СПРАВОЧНИК ПРОВОДОВ ВЛ И ГРОЗОЗАЩИТНЫХ ТРОСОВ', S_TITLE)],
            [(u'Собственные провода линии участвуют в расчёте несущей способности наравне с '
              u'размещаемым кабелем. Без них приложение Ж считает нагрузку только по кабелю '
              u'связи и завышает запас в разы. Графа F — сводный перечень марок для выпадающего '
              u'списка Блока 2 листа «Нагрузки»: сначала кабели, затем провода.', S_NOTE)]]
    head = [u'Марка провода / троса', u'Наружный диаметр, мм', u'Погонная масса, кг/км',
            u'Вид', '', u'Марки для Блока 2 «Нагрузки»']
    rows.append([(h, S_HEAD) if h else None for h in head])
    combo = [c['mark'] for c in REF['cables']] + [w['mark'] for w in REF['wires']]
    for i in range(max(len(REF['wires']), len(combo))):
        row = [None] * 6
        if i < len(REF['wires']):
            w = REF['wires'][i]
            row[0] = (w['mark'], S_BODY)
            row[1] = (w['d'], S_BODY)
            row[2] = (w['m'], S_BODY)
            row[3] = (w.get('note', ''), S_BODY)
        if i < len(combo):
            row[5] = (combo[i], S_BODY)
        rows.append(row)
    return sheet_xml(rows, ['30', '18', '20', '28', '3', '34'], freeze=3), len(combo)

# ------------------------------------------------------------ Спр_Приборы (новый)
def build_si():
    rows = [[(u'СПРАВОЧНИК СРЕДСТВ ИЗМЕРЕНИЙ', S_TITLE)],
            [(u'Первые строки — приборы подразделения: по ним известны заводской номер и запись '
              u'о поверке во ФГИС «Аршин», и в рабочем месте они подставляются целиком. Остальные '
              u'позиции типовые: наименование и марка берутся отсюда, заводской номер и поверка '
              u'заполняются по конкретному экземпляру. Дата окончания поверки — год минус день от '
              u'даты поверки (ФЗ от 26.06.2008 № 102-ФЗ, приказ Минпромторга № 2510).', S_NOTE)]]
    head = [u'Наименование прибора', u'Тип / марка', u'Заводской номер',
            u'№ записи о поверке (ФГИС «Аршин»)', u'Дата поверки',
            u'Закреплён за подразделением', u'Для каких измерений пригоден']
    rows.append([(h, S_HEAD) for h in head])
    for s in REF['si']:
        rows.append([(s['name'], S_BODY), (s['mark'], S_BODY), (s.get('sn', ''), S_BODY),
                     (s.get('fgis', ''), S_BODY), (s.get('d1', ''), S_BODY),
                     ((u'да' if s.get('own') else ''), S_BODY), (s.get('can', ''), S_BODY)])
    return sheet_xml(rows, ['40', '24', '20', '30', '16', '22', '46'], freeze=3), len(REF['si'])

# ------------------------------------------------------------ Спр_ВЛ
def build_vl():
    rows = [[(u'СПРАВОЧНИК ПАРАМЕТРОВ ВЛ ПО КЛАССАМ НАПРЯЖЕНИЯ (константы ПУЭ-7, ПП РФ № 160)', S_TITLE)]]
    head = [u'Класс напряжения, кВ', u'Габарит провода до земли (насел.), м',
            u'Габарит провода до земли (ненасел.), м', u'Габарит ОКСН до земли, м',
            u'Мин. расстояние ОКСН–провод, м', u'Охранная зона, м (ПП № 160)',
            u'Габарит до зданий (насел.), м', u'Сортировка']
    rows.append([(h, S_HEAD) for h in head])
    for i, v in enumerate(REF['vl']):
        rows.append([(v['kv'], S_BODY), (v['gz_nas'], S_BODY), (v['gz_nen'], S_BODY),
                     (v['g_oksn'], S_BODY), (v['d_oksn_prov'], S_BODY), (v['oz'], S_BODY),
                     (v.get('gz_zd', ''), S_BODY), (i + 1, S_BODY)])
    rows.append([])
    rows.append([(u'Примечание. Габариты проводов — ПУЭ-7 табл. 2.5.20/2.5.22 для нормального '
                  u'режима. Габарит ОКСН 5,0 м — ПУЭ-7 п. 2.4.89 и п. 3.2.4 ТТ № 282р. '
                  u'Охранная зона — ПП РФ № 160.', S_NOTE)])
    return sheet_xml(rows, ['16', '22', '24', '18', '20', '20', '20', '12'], freeze=2)

# ------------------------------------------------------------ Спр_Измерения
def build_meas():
    rows = [[(u'СПРАВОЧНИК ВИДОВ ИЗМЕРЕНИЙ (осмотр и измерения — в границах отчёта ППО)', S_TITLE)],
            [(u'Раздел Г.1 — фактическое состояние конструкции. Раздел Г.2 — фактически свободные '
              u'интервалы под ещё не смонтированный кабель: кабеля на опоре нет, измерять нечего, '
              u'поэтому вывод даётся в форме «достаточно / недостаточно». Графа «Что вводится» '
              u'показывает измеряемые в поле величины: остальное рабочее место считает само.', S_NOTE)]]
    head = [u'Вид измерения', u'Место (отметка)', u'Что вводится в поле', u'Значение (образец)',
            u'Ед. изм.', u'Нормативное требование', u'Вывод (образец)', u'Раздел протокола']
    rows.append([(h, S_HEAD) for h in head])
    for m in REF['meas']:
        rows.append([(m['name'], S_BODY), (m['place'], S_BODY), (m['inputs'], S_BODY),
                     (m['sample'], S_BODY), (m['unit'], S_BODY), (m['norm'], S_BODY),
                     (m['verdict'], S_BODY), (m['proto'], S_BODY)])
    return sheet_xml(rows, ['46', '20', '40', '18', '12', '52', '18', '30'], freeze=3)

# ------------------------------------------------------------ Спр_Дефекты
def build_def():
    rows = [[(u'СПРАВОЧНИК ДЕФЕКТОВ И ПОСЛЕДСТВИЙ (осмотр по ГОСТ 31937-2024)', S_TITLE)],
            [(u'Дефектной опору делает КАТЕГОРИЯ, и только она: категория задаёт состояние '
              u'конструкции, вывод о технологической возможности и коэффициент снижения несущей '
              u'способности. Описание при категории «—» дефектом не считается: опора остаётся '
              u'бездефектной, а описание уходит в графу «Примечание» перечня опор. Типовое описание зависит от материала стойки: у железобетонной это разрушение защитного слоя, у деревянной — загнивание древесины; категория, состояние и вывод при этом одни и те же.', S_NOTE)]]
    head = [u'Категория дефекта', u'Дефект (типовое описание)',
            u'То же для деревянной стойки', u'Состояние конструкции (ГОСТ 31937-2024)',
            u'Технологическая возможность', u'Коэффициент снижения',
            u'Мероприятие (рекомендация в проект)', u'Примечание']
    rows.append([(h, S_HEAD) for h in head])
    for d in REF['defects']:
        rows.append([(d['cat'], S_BODY), (d.get('txt', ''), S_BODY),
                     (d.get('txtWood', ''), S_BODY), (d['state'], S_BODY),
                     (d['tv'], S_BODY), (d.get('k', ''), S_BODY),
                     (d.get('act', ''), S_BODY), (d.get('note', ''), S_BODY)])
    return sheet_xml(rows, ['18', '58', '34', '32', '24', '18', '44', '44'], freeze=3)

# ------------------------------------------------------------ Спр_Списки
LIST_COLS = [
    (u'Класс напряжения', 'kv'), (u'Характер местности', 'mestnost'),
    (u'Вывод по измерению', 'verdict'), (u'Принадлежность подвески', 'belong'),
    (u'Исполнитель мероприятия', 'performer'), (u'Местность опоры', 'mest'),
    (u'Группа мероприятия', 'actGrp'), (u'Схема производства работ', 'scheme'),
    (u'Раздел протокола', 'proto'), (u'Вывод по достаточности', '_dost'),
    (u'Правило выборки при измерении заземления', 'zaborka'),
]
def build_lists():
    data = []
    for title, key in LIST_COLS:
        vals = [u'достаточно', u'недостаточно'] if key == '_dost' else REF['lists'][key]
        data.append([title] + list(vals))
    n = max(len(c) for c in data)
    rows = []
    for ri in range(n):
        row = []
        for c in data:
            row.append((c[ri], S_HEAD if ri == 0 else S_BODY) if ri < len(c) else None)
        rows.append(row)
    widths = ['18', '22', '20', '34', '30', '20', '40', '52', '30', '22', '44']
    return sheet_xml(rows, widths, freeze=1)

# ============================================ ЛИСТ «ИНСТРУКЦИЯ» И ПОЯСНЕНИЯ
INSTR = [
 (u'ID_shablon.xlsx — файл исходных данных для отчёта ППО ВОЛС', ''),
 (u'Отчёт по пункту 13 Правил недискриминационного доступа (ПП РФ от 22.11.2022 № 2106). Книга соответствует рабочему месту версии 3.5.10.', ''),
 ('', ''),
 (u'ДВА ЦВЕТА ЯЧЕЕК', ''),
 (u'ЖЁЛТЫЕ', u'Заполняете вручную.'),
 (u'ЗЕЛЁНЫЕ', u'Заполняются формулами. Не трогайте: при вводе своего значения формула стирается безвозвратно.'),
 (u'Треугольник в углу', u'Выпадающий список. Выбирайте мышкой, не печатайте — иначе автозаполнение не сработает.'),
 (u'Строки ПРИМЕР', u'Серый курсив, слово ПРИМЕР в последнем столбце. Удалите целиком перед заполнением.'),
 ('', ''),
 (u'ПОРЯДОК ЗАПОЛНЕНИЯ ЛИСТОВ', ''),
 (u'1. Паспорт', u'Реквизиты запроса, стороны, объект, климат, работы, оформление. Габариты, охранную зону и протяжённость участка не заполняйте — подставятся.'),
 (u'2. Линии', u'По строке на каждую ВЛ: инвентарный номер, год ввода, основание права. Наименование линии должно совпадать с листом «Опоры» посимвольно.'),
 (u'3. Кабели', u'Что просит разместить оператор. Высота подвеса = нормируемый габарит (5,0 м) ПЛЮС стрела провеса.'),
 (u'4. Опоры', u'Сначала класс напряжения, затем марка: перечень марок связан с классом. Координаты обязательны — по ним считаются пролёты и протяжённость.'),
 (u'5. Измерения', u'Одна опора + один вид измерения = одна строка. Графа «№ опоры» обязательна, линия выводится от опоры.'),
 (u'6. СИ', u'Приборы. Номер записи во ФГИС «Аршин» и дата окончания поверки обязательны. Наименование и марка — из листа «Спр_Приборы».'),
 (u'7. Нагрузки, Блок 2', u'Провода ВЛ, грозотрос, ранее размещённые кабели. Собственные провода ВЛ — обязательно. Марки берутся из сводного перечня «кабели + провода».'),
 (u'8. Мероприятия', u'Заполнится само. Вручную — только срок и стоимость.'),
 ('', ''),
 (u'ЧТО СЧИТАЕТСЯ САМО И ВРУЧНУЮ НЕ ВВОДИТСЯ', ''),
 (u'Пролёт между опорами', u'Определяется по координатам опор. Порядок опор в линии тоже строится по координатам, а не по номеру, поэтому одинаковые номера у разных опор расчёту не мешают.'),
 (u'Протяжённость участка', u'Сумма пролётов по координатам, включая звенья ручной привязки соседей.'),
 (u'Отклонение от вертикали', u'В поле измеряется УГОЛ. Отклонение верха в миллиметрах и величина 1/N считаются по углу и высоте опоры.'),
 (u'Ранее размещённые ОК', u'Позиция подвески в Блоке 2 выводится из графы «Существующих подвесов связи» листа «Опоры»: количество — наибольшее число подвесов на опоре класса, характеристики — по типовому самонесущему ОК.'),
 ('', ''),
 (u'СЛУЖЕБНАЯ ГРАФА ЛИСТА «ОПОРЫ» (последний столбец)', ''),
 (u'КОНЕЧНАЯ', u'Опора отмечена как конец участка: пролёт до следующей опоры не считается, цепь на ней обрывается.'),
 (u'СЛЕД=линия|номер', u'Следующая опора указана вручную — обычно когда продолжение лежит на другой линии или в другом классе напряжения.'),
 (u'ПРЕД=линия|номер', u'То же для предыдущей опоры. Пролёт всё равно считается по координатам обеих опор.'),
 (u'Графу не правьте руками', u'Она заполняется рабочим местом и читается им обратно. Признаки задаются в карточке опоры либо в карточке метки на карте.'),
 ('', ''),
 (u'ЧЕТЫРЕ ОШИБКИ, КОТОРЫЕ ОБЕСЦЕНИВАЮТ ОТЧЁТ', ''),
 (u'Нет проводов ВЛ в Блоке 2', u'Расчёт учтёт только кабели связи и завысит запас несущей способности в разы.'),
 (u'Одно значение на всю линию', u'Тиражирование замера на десяток опор — формально фальсификация протокола. Измеряйте раздельно.'),
 (u'Высота подвеса 5,0 м', u'В середине пролёта норматив не будет обеспечен ни при какой стреле провеса.'),
 (u'Дефекты опор — на оператора', u'Дефекты, возникшие до заявки, устраняет владелец (ст. 210 ГК РФ). Иное — риск по ч. 1 ст. 10 № 135-ФЗ.'),
 ('', ''),
 (u'ГРАНИЦА ОТЧЁТА И ПРОЕКТНОЙ ДОКУМЕНТАЦИИ', ''),
 (u'В отчёт входит', u'Осмотр, инструментальные измерения, учёт ранее размещённых сетей, сводная оценка технологической возможности.'),
 (u'В проект входит', u'Поверочные расчёты, выбор марок и арматуры, точки и высоты подвеса, стрелы провеса, тяжения, технические решения по дефектам.'),
 (u'Отчёт не является', u'Результатом инженерных изысканий (ст. 47 ГрК РФ), проектной документацией (ст. 48 ГрК РФ), заключением об обследовании строительных конструкций.'),
 ('', ''),
 (u'СПРАВОЧНИКИ КНИГИ', ''),
 (u'Спр_Опоры', u'131 марка по типовым проектам, сгруппированы по классу напряжения. Отметка «по аналогии» — расчётные величины приняты по стойке-аналогу и подтверждаются по проекту.'),
 (u'Спр_Кабели / Спр_Провода', u'Размещаемые ОК и собственные провода ВЛ. Графа F листа «Спр_Провода» — сводный перечень марок для Блока 2.'),
 (u'Спр_Приборы', u'Средства измерений. Первые строки — приборы подразделения с заводским номером и записью о поверке.'),
 (u'Спр_ВЛ / Спр_Измерения / Спр_Дефекты / Спр_Списки', u'Константы ПУЭ-7 и ПП № 160, виды измерений, категории дефектов, значения выпадающих списков.'),
 (u'Свои позиции', u'Заводятся в разделе «Справочники» рабочего места и в эту книгу не переносятся: книга — снимок данных, справочник живёт в инструменте.'),
]

def patch_instruction(rd, w):
    rows = [[None, (a, '2' if not b and a else None), (b, None)] for a, b in INSTR]
    # стиль заголовков разделов — как у исходных (жирный), прочие строки обычные
    out = []
    for a, b in INSTR:
        if not a and not b:
            out.append([])
        elif not b:
            out.append([None, (a, S_TITLE)])
        else:
            out.append([None, (a, S_HEAD), (b, None)])
    w('xl/worksheets/sheet1.xml', sheet_xml(out, ['3', '44', '120']))


# ============================================================ СБОРКА КНИГИ
def main():
    if os.path.exists(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK)
    with zipfile.ZipFile(SRC) as z:
        names = z.namelist()
        z.extractall(WORK)

    def w(path, text):
        io.open(os.path.join(WORK, path), 'w', encoding='utf-8').write(text)

    def rd(path):
        return io.open(os.path.join(WORK, path), encoding='utf-8').read()

    poles_xml, ranges = build_poles()
    wires_xml, combo_n = build_wires()
    si_xml, si_n = build_si()

    w('xl/worksheets/sheet10.xml', build_vl())
    w('xl/worksheets/sheet11.xml', build_cables())
    w('xl/worksheets/sheet12.xml', poles_xml)
    w('xl/worksheets/sheet13.xml', build_meas())
    w('xl/worksheets/sheet14.xml', build_def())
    w('xl/worksheets/sheet15.xml', build_lists())
    w('xl/worksheets/sheet16.xml', wires_xml)      # Спр_Провода
    w('xl/worksheets/sheet17.xml', si_xml)         # Спр_Приборы

    # ---------- workbook.xml: новые листы и именованные диапазоны ----------
    wbx = rd('xl/workbook.xml')
    ns = ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    # Листы «Спр_Провода» и «Спр_Приборы» добавляются только при первом запуске:
    # сборщик запускается повторно при каждой правке справочников, и без этой
    # проверки книга обрастала бы копиями одних и тех же листов.
    add = ''
    if 'name="Спр_Провода"' not in wbx:
        add += '<sheet%s name="Спр_Провода" sheetId="16" state="visible" r:id="rId18"/>' % ns
    if 'name="Спр_Приборы"' not in wbx:
        add += '<sheet%s name="Спр_Приборы" sheetId="17" state="visible" r:id="rId19"/>' % ns
    if add:
        wbx = wbx.replace('</sheets>', add + '</sheets>', 1)

    names_xml = []
    for kv, (a, b) in ranges.items():
        names_xml.append('<definedName name="Опоры_%s">\'Спр_Опоры\'!$B$%d:$B$%d</definedName>'
                         % (kv.replace(',', '_').replace('/', '_'), a, b))
    names_xml.append('<definedName name="Подвеска_Марки">\'Спр_Провода\'!$F$4:$F$%d</definedName>'
                     % (3 + combo_n))
    names_xml.append('<definedName name="Приборы_Наим">\'Спр_Приборы\'!$A$4:$A$%d</definedName>'
                     % (3 + si_n))
    names_xml.append('<definedName name="Приборы_Марки">\'Спр_Приборы\'!$B$4:$B$%d</definedName>'
                     % (3 + si_n))
    block = '<definedNames>' + ''.join(names_xml) + '</definedNames>'
    if '<definedNames>' in wbx:
        wbx = re.sub(r'<definedNames>.*?</definedNames>', block, wbx, flags=re.S)
    else:
        wbx = wbx.replace('</sheets>', '</sheets>' + block, 1)
    w('xl/workbook.xml', wbx)

    rels = rd('xl/_rels/workbook.xml.rels')
    if 'sheet16.xml' not in rels:
        rels = rels.replace('</Relationships>',
            '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
            ' Target="/xl/worksheets/sheet16.xml" Id="rId18"/>'
            '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
            ' Target="/xl/worksheets/sheet17.xml" Id="rId19"/></Relationships>', 1)
    w('xl/_rels/workbook.xml.rels', rels)

    ct = rd('[Content_Types].xml')
    if 'sheet16.xml' not in ct:
        ct = ct.replace('</Types>',
            '<Override PartName="/xl/worksheets/sheet16.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/worksheets/sheet17.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>', 1)
    w('[Content_Types].xml', ct)

    # ---------- проверки ввода ----------
    # Книгу открывают и сохраняют в Excel, и он переписывает формулы проверок
    # обычным текстом вместо экранированного, а ссылки на именованные диапазоны
    # иногда теряет вовсе. Поэтому работаем по обеим формам записи и при каждой
    # сборке заново приводим диапазоны к фактической длине справочников:
    # справочник вырос — список в книге должен вырасти вместе с ним.
    def both(name):
        """имя листа в двух видах: как есть и экранированное"""
        esc = ''.join('&#%d;' % ord(c) if ord(c) > 127 else c for c in name)
        return ["'%s'" % name, name, "'%s'" % esc, esc]

    n_kv   = 1 + len(REF['lists']['kv'])
    n_mest = 1 + len(REF['lists']['mest'])
    n_cab  = 3 + len(REF['cables'])
    n_def  = 3 + len(REF['defects'])
    n_meas = 3 + len(REF['meas'])
    n_sch  = 1 + len(REF['lists']['scheme'])
    # (лист, графа, первая строка, сколько строк) — пересчитывается каждый раз
    RANGES = [
        ('Спр_Списки',    'A', 2, n_kv),
        ('Спр_Списки',    'F', 2, n_mest),
        ('Спр_Списки',    'H', 2, n_sch),
        ('Спр_Кабели',    'A', 4, n_cab),
        ('Спр_Дефекты',   'A', 4, n_def),
        ('Спр_Измерения', 'A', 4, n_meas),
    ]
    import glob as _glob
    fixed = 0
    for sh in sorted(_glob.glob(os.path.join(WORK, 'xl/worksheets/sheet*.xml'))):
        rel = os.path.relpath(sh, WORK).replace(os.sep, '/')
        t = rd(rel); t0 = t
        for sheet, col, first, last in RANGES:
            for nm in both(sheet):
                t = re.sub(re.escape('%s!$%s$%d:$%s$' % (nm, col, first, col)) + r'\d+',
                           '%s!$%s$%d:$%s$%d' % (nm, col, first, col, last), t)
        # связанный список марок опор: таблица соответствия «класс → перечень»
        for nm in both('Спр_Опоры'):
            t = re.sub(re.escape('%s!$M$4:$N$' % nm) + r'\d+',
                       '%s!$M$4:$N$%d' % (nm, 3 + len(KV_ORDER) + len(KV_FALLBACK)), t)
        if t != t0:
            w(rel, t); fixed += 1

    # Блок 2 листа «Нагрузки»: марки берутся из сводного перечня «кабели +
    # провода». Excel эту проверку при сохранении теряет — восстанавливаем.
    s9 = rd('xl/worksheets/sheet9.xml')
    if 'Подвеска_Марки' not in s9:
        dv = ('<dataValidation type="list" allowBlank="1" showInputMessage="1"'
              ' showErrorMessage="0" sqref="A29:A44">'
              '<formula1>Подвеска_Марки</formula1></dataValidation>')
        if '<dataValidations' in s9:
            s9 = re.sub(r'(<dataValidations[^>]*>)', r'\1' + dv, s9, count=1)
            s9 = re.sub(r'<dataValidations count="(\d+)"',
                        lambda m: '<dataValidations count="%d"' % (int(m.group(1)) + 1), s9, count=1)
        else:
            for tag in ['<pageMargins', '<pageSetup', '</worksheet>']:
                if tag in s9:
                    s9 = s9.replace(tag, '<dataValidations count="1">' + dv + '</dataValidations>' + tag, 1)
                    break
        w('xl/worksheets/sheet9.xml', s9)
        print('  восстановлена проверка марок подвески в «Нагрузках»')

    # Лист «СИ»: наименование и марка — из справочника приборов
    s7 = rd('xl/worksheets/sheet7.xml')
    if 'Приборы_Наим' not in s7:
        dv = ('<dataValidations count="2">'
              '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0"'
              ' sqref="A2:A30"><formula1>Приборы_Наим</formula1></dataValidation>'
              '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="0"'
              ' sqref="B2:B30"><formula1>Приборы_Марки</formula1></dataValidation>'
              '</dataValidations>')
        for tag in ['<pageMargins', '<pageSetup', '</worksheet>']:
            if tag in s7:
                s7 = s7.replace(tag, dv + tag, 1); break
        w('xl/worksheets/sheet7.xml', s7)

    # Строка-пример листа «СИ»: окончание поверки не может быть раньше самой
    # поверки. Значение задаётся явно, чтобы пример не учил неверному.
    s7d = rd('xl/worksheets/sheet7.xml')
    s7d = re.sub(r'(<c r="F3"[^>]*>)<v>\d+</v>(</c>)', r'\g<1><v>46625</v>\g<2>', s7d)
    w('xl/worksheets/sheet7.xml', s7d)

    # ---------- упаковка ----------
    tmp = OUT + '.new'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        order = list(names)
        for extra in ('xl/worksheets/sheet16.xml', 'xl/worksheets/sheet17.xml'):
            if extra not in order:
                order.append(extra)
        for n in order:
            fp = os.path.join(WORK, n)
            if os.path.isfile(fp):
                z.write(fp, n)
    shutil.move(tmp, OUT)
    print('готово:', OUT)
    print('  марок опор:', len(REF['poles']), '| диапазоны:', {k: '%d-%d' % v for k, v in ranges.items()})
    print('  сводный перечень подвески:', combo_n, '| приборов:', si_n)

if __name__ == '__main__':
    main()

