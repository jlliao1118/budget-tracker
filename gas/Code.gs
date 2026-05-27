// ============================================================
//  我的記帳本 — Google Apps Script 後端
//  1. 複製此檔內容到你的 Apps Script 專案
//  2. 填寫下方 CONFIG 設定
//  3. 部署為「網路應用程式」，存取權限選「所有人」
//  4. 將部署網址填入前端設定頁面
// ============================================================

const CONFIG = {
  // 你的 Google Sheet ID（從網址複製，docs.google.com/spreadsheets/d/【這裡】/edit）
  // 若 GAS 是從 Sheet 內「擴充功能→Apps Script」開啟的，可留空字串
  SHEET_ID: '',

  // LINE Channel Access Token（從 LINE Developers 取得，選填）
  LINE_CHANNEL_ACCESS_TOKEN: '',
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

// ── 收入分類關鍵字 ────────────────────────────────────────
const INCOME_KEYWORDS = {
  '薪資': ['薪水','薪資','工資','月薪','底薪'],
  '獎金': ['獎金','紅包','紅利','年終'],
  '兼職': ['兼職','打工','外快','稿費'],
  '投資': ['股票','基金','利息','股利','租金收入'],
  '其他': ['收入','入帳'],
};

// ── HTTP 進入點 ───────────────────────────────────────────

function doGet(e) {
  const action = e.parameter.action || '';
  let result;
  try {
    switch (action) {
      case 'getRecords':   result = getRecords(e.parameter);    break;
      case 'addRecord':    result = addRecord(e.parameter);     break;
      case 'deleteRecord': result = deleteRecord(e.parameter.id); break;
      default:             result = { success: true, message: '記帳系統運作中 ✅' };
    }
  } catch (err) {
    result = { success: false, error: err.message };
  }
  return jsonResponse(result);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    // LINE Webhook 事件包含 events 陣列
    if (body && body.events) {
      handleLineWebhook(body);
      return ContentService.createTextOutput('OK');
    }

    // 前端 POST（備用，主要用 GET）
    let result;
    switch (body.action) {
      case 'addRecord': result = addRecord(body); break;
      default:          result = { success: false, error: '未知動作' };
    }
    return jsonResponse(result);

  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Google Sheets 操作 ───────────────────────────────────

function getSheet() {
  const ss = CONFIG.SHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) throw new Error('找不到 Google Sheet，請確認 SHEET_ID 設定是否正確');

  let sheet = ss.getSheetByName('Records');
  if (!sheet) {
    sheet = ss.insertSheet('Records');
    sheet.getRange(1, 1, 1, 8).setValues([[
      'ID', 'Date', 'Type', 'Category', 'Description', 'Amount', 'Source', 'CreatedAt'
    ]]);
    sheet.setFrozenRows(1);
    // 格式化標題行
    sheet.getRange(1, 1, 1, 8)
      .setBackground('#6C63FF')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
  }
  return sheet;
}

function getRecords(params) {
  const sheet = getSheet();
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

  // 依月份篩選（可選）
  if (params && params.month) {
    records = records.filter(r => r.date.startsWith(params.month));
  }

  // 依日期降冪排序
  records.sort((a, b) => b.date.localeCompare(a.date));

  return { success: true, records };
}

function addRecord(params) {
  const sheet   = getSheet();
  const now     = new Date();
  const id      = now.getTime(); // 用時間戳作為 ID，確保唯一性
  const date    = params.date || Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');
  const amount  = parseFloat(params.amount) || 0;

  if (amount <= 0) return { success: false, error: '金額必須大於 0' };

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

  return { success: true, message: '新增成功', id: String(id) };
}

function deleteRecord(id) {
  if (!id) return { success: false, error: '缺少 ID' };

  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { success: false, error: '找不到記錄' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIdx = ids.findIndex(v => String(v) === String(id));

  if (rowIdx === -1) return { success: false, error: '找不到記錄' };

  sheet.deleteRow(rowIdx + 2); // +2: 標題列 + 0-based index
  return { success: true, message: '刪除成功' };
}

// ── LINE Webhook 處理 ─────────────────────────────────────

function handleLineWebhook(body) {
  const events = body.events || [];
  events.forEach(event => {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const text       = event.message.text.trim();
    const replyToken = event.replyToken;

    if (text === '查詢' || text === '本月' || text === '餘額') {
      // 本月統計
      const ym      = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
      const { records } = getRecords({ month: ym });
      let income = 0, expense = 0;
      records.forEach(r => {
        if (r.type === '收入') income  += r.amount;
        else                   expense += r.amount;
      });
      const reply = [
        `📊 本月統計（${ym.replace('-', '年')}月）`,
        `💰 收入：$${income.toLocaleString()}`,
        `💸 支出：$${expense.toLocaleString()}`,
        `📈 結餘：$${(income - expense).toLocaleString()}`,
      ].join('\n');
      replyLine(replyToken, reply);
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
      const reply = [
        `✅ 已記錄`,
        `${emoji} ${parsed.description}`,
        `分類：${parsed.category}`,
        `金額：${sign}$${parsed.amount.toLocaleString()}`,
      ].join('\n');
      replyLine(replyToken, reply);
    } else {
      replyLine(replyToken, [
        '❌ 格式有誤，請使用以下格式：',
        '',
        '📝 範例：',
        '  晚餐 60',
        '  捷運票 30元',
        '  薪水 50000',
        '',
        '🔍 查詢本月統計，輸入「查詢」',
      ].join('\n'));
    }
  });
}

function parseLineMessage(text) {
  // 移除貨幣符號
  const cleaned = text.replace(/NT\$|＄|\$/gi, '').trim();

  // 擷取金額（數字＋可選的「元」）
  const amountMatch = cleaned.match(/(\d[\d,]*\.?\d*)\s*元?/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (amount <= 0) return null;

  // 移除金額部分，剩餘為描述
  const description = cleaned.replace(amountMatch[0], '').replace(/\s+/g, ' ').trim();

  // 判斷收入
  for (const [cat, keywords] of Object.entries(INCOME_KEYWORDS)) {
    if (keywords.some(kw => cleaned.toLowerCase().includes(kw))) {
      return { type: '收入', category: cat, description: description || '收入', amount };
    }
  }

  // 判斷支出分類
  let category = '其他';
  for (const [cat, keywords] of Object.entries(EXPENSE_KEYWORDS)) {
    if (keywords.some(kw => cleaned.toLowerCase().includes(kw.toLowerCase()))) {
      category = cat;
      break;
    }
  }

  return {
    type:        '支出',
    category,
    description: description || category,
    amount,
  };
}

function replyLine(replyToken, text) {
  if (!CONFIG.LINE_CHANNEL_ACCESS_TOKEN) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method:      'post',
      contentType: 'application/json',
      headers:     { 'Authorization': 'Bearer ' + CONFIG.LINE_CHANNEL_ACCESS_TOKEN },
      payload:     JSON.stringify({
        replyToken,
        messages: [{ type: 'text', text }],
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('LINE reply error: ' + e.message);
  }
}
