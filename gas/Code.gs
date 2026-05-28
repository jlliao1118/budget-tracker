// ============================================================
//  我的記帳本 — Google Apps Script 後端 v2
// ============================================================

const CONFIG = {
  // 你的 Google Sheet ID（從網址複製）
  // 若是從 Sheet 內「擴充功能→Apps Script」開啟的，可留空字串
  SHEET_ID: '',

  // LINE Channel Access Token（選填）
  LINE_CHANNEL_ACCESS_TOKEN: '',

  // ★ API 金鑰（重要！自訂一組密碼，前端設定頁也要填入同樣的密碼）
  // 沒有正確金鑰的請求將被拒絕，保護你的記帳資料不被外人讀取
  API_KEY: '',
};

// ── 支出分類關鍵字 ────────────────────────────────────────
const EXPENSE_KEYWORDS = {
  '餐飲': ['早餐','午餐','晚餐','早午餐','宵夜','飲料','咖啡','奶茶','茶','便當','麵','飯','火鍋','燒烤','餐廳','小吃','滷味','炸雞','漢堡','披薩','壽司','拉麵','牛排'],
  '交通': ['捷運','公車','計程車','uber','油費','停車','高鐵','火車','台鐵','機票','加油','停車費'],
  '購物': ['衣服','鞋子','包包','3c','電腦','手機','超市','量販','購物','全聯','家樂福','好市多','costco'],
  '娛樂': ['電影','遊戲','ktv','唱歌','旅遊','門票','展覽','livehouse','演唱會'],
  '醫療': ['掛號','藥','醫院','診所','健保','牙醫','藥局'],
  '住居': ['房租','水費','電費','瓦斯','網路','第四台','管理費','租金'],
  '教育': ['課程','補習','學費','文具','書籍'],
  '生活': ['洗衣','理髮','美髮','指甲','保養','健身','gym'],
};

const INCOME_KEYWORDS = {
  '薪資': ['薪水','薪資','工資','月薪','底薪'],
  '獎金': ['獎金','紅包','紅利','年終'],
  '兼職': ['兼職','打工','外快','稿費'],
  '投資': ['股票','基金','利息','股利','租金收入'],
  '其他': ['收入','入帳'],
};

// ── HTTP 進入點 ───────────────────────────────────────────

function doGet(e) {
  const action   = (e.parameter && e.parameter.action)   ? e.parameter.action   : 'ping';
  const callback = (e.parameter && e.parameter.callback) ? e.parameter.callback : null;
  const reqKey   = (e.parameter && e.parameter.key)      ? e.parameter.key      : '';
  let result;

  try {
    // ping 不需要驗證（用於基本連線測試）
    // 其他操作：若有設定 API_KEY，則必須驗證
    const PROTECTED = ['diagnose', 'getRecords', 'addRecord', 'deleteRecord'];
    if (PROTECTED.includes(action) && CONFIG.API_KEY && reqKey !== CONFIG.API_KEY) {
      result = { success: false, error: '金鑰錯誤，請在設定頁輸入正確的 API 金鑰' };
    } else {
      switch (action) {
        case 'ping':         result = { success: true, message: '記帳系統運作中 ✅', version: 3 }; break;
        case 'diagnose':     result = diagnose();                        break;
        case 'getRecords':   result = getRecords(e.parameter);          break;
        case 'addRecord':    result = addRecord(e.parameter);           break;
        case 'deleteRecord': result = deleteRecord(e.parameter.id);     break;
        default:             result = { success: false, error: '未知指令: ' + action };
      }
    }
  } catch (err) {
    console.error('doGet error [' + action + ']:', err.message, err.stack);
    result = { success: false, error: err.message };
  }

  const jsonStr = JSON.stringify(result);

  // JSONP 模式：繞過瀏覽器 CORS 限制
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + jsonStr + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(jsonStr)
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LINE Webhook（含有 events 陣列）
    if (body && body.events) {
      handleLineWebhook(body);
      return ContentService.createTextOutput('OK');
    }

    // 前端 POST 備用路徑
    let result;
    switch (body.action) {
      case 'addRecord':    result = addRecord(body);          break;
      case 'deleteRecord': result = deleteRecord(body.id);   break;
      default: result = { success: false, error: '未知指令' };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    console.error('doPost error:', err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── 診斷函式 ─────────────────────────────────────────────

function diagnose() {
  const info = {
    success: true,
    timestamp: new Date().toISOString(),
    scriptType: '',
    sheetAccess: false,
    sheetName: '',
    sheetId: '',
    recordCount: 0,
    configSheetId: CONFIG.SHEET_ID || '(未設定)',
    error: null,
  };

  try {
    // 判斷是 container-bound 還是 standalone
    try {
      const bound = SpreadsheetApp.getActiveSpreadsheet();
      info.scriptType = bound ? 'container-bound' : 'standalone';
    } catch (e) {
      info.scriptType = 'standalone';
    }

    const ss = getSpreadsheet();
    info.sheetAccess = true;
    info.sheetId = ss.getId();
    info.sheetName = ss.getName();

    const sheet = ss.getSheetByName('Records');
    if (sheet) {
      info.recordCount = Math.max(0, sheet.getLastRow() - 1);
    }
  } catch (err) {
    info.success = false;
    info.error = err.message;
  }

  return info;
}

// ── Google Sheets 操作 ───────────────────────────────────

function getSpreadsheet() {
  // 優先使用 CONFIG.SHEET_ID
  if (CONFIG.SHEET_ID && CONFIG.SHEET_ID.trim() !== '') {
    try {
      return SpreadsheetApp.openById(CONFIG.SHEET_ID.trim());
    } catch (e) {
      throw new Error('無法用 SHEET_ID 開啟試算表（' + CONFIG.SHEET_ID + '）：' + e.message);
    }
  }

  // 嘗試 container-bound 方式
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {
    // ignore
  }

  throw new Error(
    '找不到 Google Sheet！\n' +
    '請在 Code.gs 的 CONFIG.SHEET_ID 填入你的試算表 ID。\n' +
    '試算表網址：https://docs.google.com/spreadsheets/d/【ID在這裡】/edit'
  );
}

function getSheet() {
  const ss = getSpreadsheet();

  let sheet = ss.getSheetByName('Records');
  if (!sheet) {
    sheet = ss.insertSheet('Records');
    const header = [['ID','Date','Type','Category','Description','Amount','Source','CreatedAt']];
    sheet.getRange(1, 1, 1, 8).setValues(header);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8)
      .setBackground('#6C63FF')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    console.log('已自動建立 Records 工作表');
  }
  return sheet;
}

function getRecords(params) {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: true, records: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

  let records = data
    .filter(row => row[0] !== '' && row[0] !== null)
    .map(row => ({
      id:          String(row[0]),
      date:        row[1] instanceof Date
                     ? Utilities.formatDate(row[1], 'Asia/Taipei', 'yyyy-MM-dd')
                     : String(row[1]),
      type:        String(row[2]),
      category:    String(row[3]),
      description: String(row[4]),
      amount:      parseFloat(row[5]) || 0,
      source:      String(row[6]),
      createdAt:   row[7] instanceof Date ? row[7].toISOString() : String(row[7]),
    }));

  if (params && params.month) {
    records = records.filter(r => r.date.startsWith(params.month));
  }

  records.sort((a, b) => b.date.localeCompare(a.date));
  return { success: true, records };
}

function addRecord(params) {
  if (!params.amount) return { success: false, error: '缺少 amount 參數' };

  const amount = parseFloat(String(params.amount).replace(/,/g, ''));
  if (isNaN(amount) || amount <= 0) return { success: false, error: '金額必須大於 0，收到：' + params.amount };

  const sheet = getSheet();
  const now   = new Date();
  const id    = now.getTime();
  const date  = params.date || Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');

  sheet.appendRow([
    id,
    date,
    params.type        || '支出',
    params.category    || '其他',
    params.description || '',
    amount,
    params.source      || 'web',
    now.toISOString(),
  ]);

  console.log('新增記錄成功: id=' + id + ', amount=' + amount + ', type=' + params.type);
  return { success: true, message: '新增成功', id: String(id) };
}

function deleteRecord(id) {
  if (!id) return { success: false, error: '缺少 ID' };

  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: '找不到記錄' };

  const ids    = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIdx = ids.findIndex(v => String(v) === String(id));
  if (rowIdx === -1) return { success: false, error: '找不到 ID: ' + id };

  sheet.deleteRow(rowIdx + 2);
  return { success: true, message: '刪除成功' };
}

// ── LINE Webhook ──────────────────────────────────────────

function handleLineWebhook(body) {
  const events = body.events || [];
  events.forEach(event => {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const text       = event.message.text.trim();
    const replyToken = event.replyToken;

    if (text === '查詢' || text === '本月' || text === '餘額') {
      const ym = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
      const { records } = getRecords({ month: ym });
      let income = 0, expense = 0;
      records.forEach(r => { if (r.type === '收入') income += r.amount; else expense += r.amount; });
      replyLine(replyToken, [
        '📊 本月統計（' + ym.replace('-','年') + '月）',
        '💰 收入：$' + income.toLocaleString(),
        '💸 支出：$' + expense.toLocaleString(),
        '📈 結餘：$' + (income - expense).toLocaleString(),
      ].join('\n'));
      return;
    }

    const parsed = parseLineMessage(text);
    if (parsed) {
      addRecord({
        date:        Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd'),
        type:        parsed.type,
        category:    parsed.category,
        description: parsed.description,
        amount:      parsed.amount,
        source:      'line',
      });
      const sign  = parsed.type === '支出' ? '-' : '+';
      const emoji = parsed.type === '支出' ? '💸' : '💰';
      replyLine(replyToken, [
        '✅ 已記錄',
        emoji + ' ' + parsed.description,
        '分類：' + parsed.category,
        '金額：' + sign + '$' + parsed.amount.toLocaleString(),
      ].join('\n'));
    } else {
      replyLine(replyToken, [
        '❌ 格式有誤，請使用：',
        '',
        '  晚餐 60',
        '  捷運票 30元',
        '  薪水 50000',
        '',
        '輸入「查詢」看本月統計',
      ].join('\n'));
    }
  });
}

function parseLineMessage(text) {
  const cleaned     = text.replace(/NT\$|＄|\$/gi, '').trim();
  const amountMatch = cleaned.match(/(\d[\d,]*\.?\d*)\s*元?/);
  if (!amountMatch) return null;

  const amount      = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (amount <= 0) return null;

  const description = cleaned.replace(amountMatch[0], '').replace(/\s+/g, ' ').trim();

  for (const [cat, keywords] of Object.entries(INCOME_KEYWORDS)) {
    if (keywords.some(kw => cleaned.toLowerCase().includes(kw))) {
      return { type: '收入', category: cat, description: description || '收入', amount };
    }
  }

  let category = '其他';
  for (const [cat, keywords] of Object.entries(EXPENSE_KEYWORDS)) {
    if (keywords.some(kw => cleaned.toLowerCase().includes(kw.toLowerCase()))) {
      category = cat;
      break;
    }
  }

  return { type: '支出', category, description: description || category, amount };
}

function replyLine(replyToken, text) {
  if (!CONFIG.LINE_CHANNEL_ACCESS_TOKEN) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post', contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_ACCESS_TOKEN },
      payload: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.error('LINE reply error:', e.message);
  }
}
