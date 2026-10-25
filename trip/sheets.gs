// Планировщик поездок: хранение в Google Таблице.
// Вставьте этот код в таблицу: Расширения -> Apps Script. Замените секретную фразу ниже на свою (не короче 8 символов).
// Читать данные может любой, у кого есть адрес развёртывания, а записывать - только тот, кто знает секретную фразу.
// После любого изменения кода: Развернуть -> Управление развёртываниями -> карандаш -> Версия: Новая версия -> Развернуть.

const CODE = 'замените-на-свой-секретный-код';
const DATA = 'data';      // служебный лист: в нём лежат все поездки (не правьте его руками)
const PLAN = 'План';      // читаемая копия: её страница перезаписывает при каждом сохранении
const CHUNK = 40000;      // в одну ячейку помещается не больше 50 000 знаков

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function reply_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function read_() {
  const sh = sheet_(DATA), n = sh.getLastRow();
  if (n < 1) return { rev: 0, data: null };
  const col = sh.getRange(1, 1, n, 1).getValues().map(function (r) { return String(r[0]); });
  const text = col.slice(1).join('');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { rev: Number(col[0]) || 0, data: data };
}

function write_(rev, data) {
  const sh = sheet_(DATA), text = JSON.stringify(data), rows = [[rev]];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + CHUNK, text.length);
    const c = text.charCodeAt(end - 1);
    if (end < text.length && c >= 0xD800 && c <= 0xDBFF) end--;      // не разрезаем пару-суррогат (эмодзи)
    rows.push([text.slice(i, end)]);
    i = end;
  }
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);   // '@' - обычный текст, без превращения в числа и формулы
}

function safe_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;       // чужой текст не должен стать формулой
}

function mirror_(data) {
  const kinds = { flight: 'перелёт', arrive: 'прибытие', transport: 'транспорт', lodging: 'жильё', food: 'еда', walk: 'прогулка', work: 'дела', rest: 'отдых', idea: 'идея', other: 'другое' };
  const status = ['', 'нужно подтвердить', 'подтверждено'];
  const rows = [['Поездка', 'Дата', 'Время', 'Конец', 'Название', 'Место', 'Вид', 'Стоимость', 'Статус', 'Заметка']];
  (data.trips || []).forEach(function (t) {
    (t.items || []).slice().sort(function (a, b) {
      return (a.date + ' ' + (a.time || '99:99')) < (b.date + ' ' + (b.time || '99:99')) ? -1 : 1;
    }).forEach(function (i) {
      rows.push([t.title, i.date, i.time || '', i.end || '', i.title, i.place || '', kinds[i.kind] || '', i.cost || 0, status[i.conf || 0] || '', i.note || ''].map(safe_));
    });
  });
  const sh = sheet_(PLAN);
  sh.clear();
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function doGet() {
  const r = read_();
  return reply_({ ok: true, rev: r.rev, data: r.data });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return reply_({ ok: false, error: 'bad' }); }
  if (typeof CODE !== 'string' || CODE.length < 8 || CODE.indexOf('замените') === 0) return reply_({ ok: false, error: 'setup' });
  if (!req || req.code !== CODE) return reply_({ ok: false, error: 'code' });
  if (!req.data || !Array.isArray(req.data.trips)) return reply_({ ok: false, error: 'bad' });
  if (JSON.stringify(req.data).length > 2000000) return reply_({ ok: false, error: 'large' });
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (x) { return reply_({ ok: false, error: 'busy' }); }
  try {
    const cur = read_();
    if (Number(req.base) !== cur.rev) return reply_({ ok: false, conflict: true, rev: cur.rev, data: cur.data });
    const rev = cur.rev + 1;
    write_(rev, req.data);
    try { mirror_(req.data); } catch (x) { /* читаемая копия не обязательна */ }
    return reply_({ ok: true, rev: rev });
  } finally {
    lock.releaseLock();
  }
}
