/**
 * ĐĂNG KÝ MUA HIỆN VẬT BỒI DƯỠNG - TTKSKL LONG THÀNH
 * Backend Google Apps Script + Auth (đăng ký / đăng nhập / đổi / reset mật khẩu)
 *
 * TRIỂN KHAI:
 * 1. Sheet đăng ký -> Extensions -> Apps Script
 * 2. Xoá code cũ, dán toàn bộ file này
 * 3. SHEET_NAME đúng tên tab (mặc định "Tổng hợp")
 * 4. Deploy -> New deployment -> Web app
 *    Execute as: Me | Who has access: Anyone
 * 5. Copy Web app URL -> dán vào APPS_SCRIPT_URL trong index.html
 * 6. Mỗi lần sửa code: Manage deployments -> Edit -> New version
 *
 * CORS: không set Content-Type: application/json khi fetch từ web.
 *
 * AUTH:
 * - Sheet "Auth" tự tạo: Tên | Hash | Salt | Ngày tạo
 * - Reset: POST {action:'resetPassword', name, key:ADMIN_KEY}
 * - Đổi mật khẩu: POST {action:'changePassword', name, oldPassword, newPassword}
 * - updatePrices: ?action=updatePrices&key=ADMIN_KEY&items=STT:GIA,...
 */

const SHEET_NAME = 'Tổng hợp';
const AUTH_SHEET_NAME = 'Auth';
const ADMIN_KEY = 'bdhvlongthanh'; // ĐỔI thành mã bí mật riêng

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Không tìm thấy sheet "' + SHEET_NAME + '".');
  return sheet;
}

function readStructure_(sheet) {
  const data = sheet.getDataRange().getValues();
  const numRows = data.length;
  const numCols = data[0].length;

  let nameRow = -1, budgetRow = -1;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const val = String(data[r][c]).trim();
      if (val === 'Họ và tên') nameRow = r;
      if (val.indexOf('Mức chi bồi dưỡng') === 0) budgetRow = r;
    }
    if (nameRow >= 0 && budgetRow >= 0) break;
  }
  if (nameRow < 0) throw new Error('Không tìm thấy hàng "Họ và tên".');
  if (budgetRow < 0) budgetRow = nameRow + 1;

  let firstMemberCol = -1, lastMemberCol = -1;
  for (let c = 0; c < numCols; c++) {
    const val = String(data[nameRow][c]).trim();
    if (val !== '' && val !== 'Họ và tên') {
      if (firstMemberCol < 0) firstMemberCol = c;
      lastMemberCol = c;
    }
  }
  if (firstMemberCol < 0) throw new Error('Không tìm thấy tên thành viên.');

  const members = [];
  for (let c = firstMemberCol; c <= lastMemberCol; c++) {
    const name = String(data[nameRow][c]).trim();
    if (!name) continue;
    members.push({ name: name, col: c, budget: Number(data[budgetRow][c]) || 0 });
  }

  let itemHeaderRow = -1;
  let colSTT = -1, colName = -1, colUnit = -1, colPrice = -1, colImage = -1;
  for (let r = nameRow; r < numRows; r++) {
    let hasStt = false, hasName = false, hasPrice = false;
    for (let c = 0; c < numCols; c++) {
      const val = String(data[r][c]).trim();
      if (val === 'STT') { hasStt = true; colSTT = c; }
      if (val === 'Tên hàng hoá' || val === 'Tên hàng hóa') { hasName = true; colName = c; }
      if (val === 'Đơn vị tính') colUnit = c;
      if (val === 'Đơn giá') { hasPrice = true; colPrice = c; }
      if (val === 'Hình ảnh' || val === 'Link ảnh' || val === 'URL ảnh') colImage = c;
    }
    if (hasStt && hasName && hasPrice) { itemHeaderRow = r; break; }
  }
  if (itemHeaderRow < 0) throw new Error('Không tìm thấy hàng tiêu đề STT / Tên hàng hoá / Đơn giá.');

  const items = [];
  let currentCategory = '';
  for (let r = itemHeaderRow + 1; r < numRows; r++) {
    const sttVal = String(data[r][colSTT]).trim();
    const nameVal = String(data[r][colName]).trim();
    if (sttVal === '' && nameVal === '') continue;
    if (sttVal === '' && nameVal !== '') { currentCategory = nameVal; continue; }
    if (nameVal === '') continue;
    items.push({
      row: r,
      stt: data[r][colSTT],
      name: nameVal,
      unit: colUnit >= 0 ? String(data[r][colUnit]).trim() : '',
      price: Number(data[r][colPrice]) || 0,
      image: colImage >= 0 ? String(data[r][colImage]).trim() : '',
      category: currentCategory
    });
  }

  return { data: data, members: members, items: items, colPrice: colPrice };
}

function getAuthSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AUTH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(AUTH_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['Tên', 'Hash', 'Salt', 'Ngày tạo']]);
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function hashPassword_(password, salt) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password) + String(salt),
    Utilities.Charset.UTF_8
  );
  return digest.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function findAuthEntry_(name) {
  const data = getAuthSheet_().getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]).trim() === name) {
      return { row: r + 1, hash: String(data[r][1]), salt: String(data[r][2]) };
    }
  }
  return null;
}

function verifyPassword_(name, password) {
  const entry = findAuthEntry_(name);
  if (!entry) return false;
  return hashPassword_(password, entry.salt) === entry.hash;
}

function registerPassword_(name, password) {
  if (!password || String(password).length < 4) {
    return { ok: false, error: 'Mật khẩu phải có ít nhất 4 ký tự.' };
  }
  if (findAuthEntry_(name)) {
    return { ok: false, error: 'Tài khoản này đã có mật khẩu. Hãy đăng nhập.' };
  }
  const salt = Utilities.getUuid();
  getAuthSheet_().appendRow([name, hashPassword_(password, salt), salt, new Date()]);
  SpreadsheetApp.flush();
  return { ok: true };
}

function changePassword_(name, oldPassword, newPassword) {
  if (!newPassword || String(newPassword).length < 4) {
    return { ok: false, error: 'Mật khẩu mới phải có ít nhất 4 ký tự.' };
  }
  const entry = findAuthEntry_(name);
  if (!entry) return { ok: false, error: 'Tài khoản chưa đăng ký mật khẩu.' };
  if (hashPassword_(oldPassword, entry.salt) !== entry.hash) {
    return { ok: false, error: 'Mật khẩu hiện tại không đúng.' };
  }
  const salt = Utilities.getUuid();
  const sheet = getAuthSheet_();
  sheet.getRange(entry.row, 2).setValue(hashPassword_(newPassword, salt));
  sheet.getRange(entry.row, 3).setValue(salt);
  sheet.getRange(entry.row, 4).setValue(new Date());
  SpreadsheetApp.flush();
  return { ok: true };
}

function resetPassword_(name) {
  const entry = findAuthEntry_(name);
  if (!entry) return { ok: false, error: 'Không tìm thấy mật khẩu của: ' + name };
  getAuthSheet_().deleteRow(entry.row);
  SpreadsheetApp.flush();
  return { ok: true, message: 'Đã xoá mật khẩu của «' + name + '». Người dùng có thể đăng ký lại.' };
}

function doGet(e) {
  try {
    const action = (e.parameter.action || 'catalog').trim();
    const sheet = getSheet_();
    const struct = readStructure_(sheet);

    if (action === 'catalog') {
      return jsonOut_({
        ok: true,
        members: struct.members.map(function (m) { return { name: m.name, budget: m.budget }; }),
        items: struct.items.map(function (it) {
          return { stt: it.stt, name: it.name, unit: it.unit, price: it.price, image: it.image, category: it.category };
        })
      });
    }

    if (action === 'authStatus') {
      const name = (e.parameter.name || '').trim();
      if (!name) return jsonOut_({ ok: false, error: 'Thiếu tên.' });
      const member = struct.members.filter(function (m) { return m.name === name; })[0];
      if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });
      return jsonOut_({ ok: true, name: name, hasPassword: !!findAuthEntry_(name) });
    }

    if (action === 'resetPassword') {
      if ((e.parameter.key || '') !== ADMIN_KEY) return jsonOut_({ ok: false, error: 'Sai mã xác thực (key).' });
      const name = (e.parameter.name || '').trim();
      if (!name) return jsonOut_({ ok: false, error: 'Thiếu tên.' });
      return jsonOut_(resetPassword_(name));
    }

    if (action === 'updatePrices') {
      if ((e.parameter.key || '') !== ADMIN_KEY) return jsonOut_({ ok: false, error: 'Sai mã xác thực (key).' });
      const pairs = ((e.parameter.items || '').trim()).split(',').filter(Boolean);
      const updated = [], notFound = [];
      pairs.forEach(function (pair) {
        const parts = pair.split(':');
        const stt = String(parts[0] || '').trim();
        const price = Number(parts[1]);
        const item = struct.items.filter(function (it) { return String(it.stt).trim() === stt; })[0];
        if (!item || !price || price <= 0) { notFound.push(stt); return; }
        sheet.getRange(item.row + 1, struct.colPrice + 1).setValue(price);
        updated.push({ stt: stt, name: item.name, price: price });
      });
      SpreadsheetApp.flush();
      return jsonOut_({ ok: true, updated: updated, notFound: notFound });
    }

    if (action === 'member') {
      const name = (e.parameter.name || '').trim();
      const password = e.parameter.password || '';
      const member = struct.members.filter(function (m) { return m.name === name; })[0];
      if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });
      if (!findAuthEntry_(name)) return jsonOut_({ ok: false, error: 'Tài khoản chưa đăng ký mật khẩu.' });
      if (!verifyPassword_(name, password)) return jsonOut_({ ok: false, error: 'Mật khẩu không đúng.' });
      const selections = {};
      let tongTien = 0;
      struct.items.forEach(function (it) {
        const qty = Number(struct.data[it.row][member.col]) || 0;
        if (qty > 0) { selections[it.name] = qty; tongTien += qty * it.price; }
      });
      return jsonOut_({ ok: true, name: member.name, budget: member.budget, selections: selections, tongTien: tongTien });
    }

    return jsonOut_({ ok: false, error: 'Tham số action không hợp lệ.' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = String(body.action || 'save').trim();
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const sheet = getSheet_();
    const struct = readStructure_(sheet);

    if (action === 'register') {
      const member = struct.members.filter(function (m) { return m.name === name; })[0];
      if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });
      return jsonOut_(registerPassword_(name, password));
    }

    if (action === 'login') {
      const member = struct.members.filter(function (m) { return m.name === name; })[0];
      if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });
      if (!findAuthEntry_(name)) return jsonOut_({ ok: false, error: 'Tài khoản chưa đăng ký mật khẩu.' });
      if (!verifyPassword_(name, password)) return jsonOut_({ ok: false, error: 'Mật khẩu không đúng.' });
      return jsonOut_({ ok: true, name: member.name, budget: member.budget });
    }

    if (action === 'changePassword') {
      const member = struct.members.filter(function (m) { return m.name === name; })[0];
      if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });
      return jsonOut_(changePassword_(name, String(body.oldPassword || ''), String(body.newPassword || '')));
    }

    if (action === 'resetPassword') {
      if (String(body.key || '') !== ADMIN_KEY) return jsonOut_({ ok: false, error: 'Sai mã xác thực (key).' });
      if (!name) return jsonOut_({ ok: false, error: 'Thiếu tên.' });
      return jsonOut_(resetPassword_(name));
    }

    const member = struct.members.filter(function (m) { return m.name === name; })[0];
    if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });
    if (!findAuthEntry_(name)) return jsonOut_({ ok: false, error: 'Tài khoản chưa đăng ký mật khẩu.' });
    if (!verifyPassword_(name, password)) return jsonOut_({ ok: false, error: 'Mật khẩu không đúng. Không thể lưu.' });

    const selections = body.selections || {};
    let tongTien = 0;
    struct.items.forEach(function (it) {
      const qty = Number(selections[it.name]) || 0;
      sheet.getRange(it.row + 1, member.col + 1).setValue(qty === 0 ? '' : qty);
      tongTien += qty * it.price;
    });
    SpreadsheetApp.flush();
    return jsonOut_({ ok: true, name: member.name, budget: member.budget, tongTien: tongTien });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function _test() {
  const struct = readStructure_(getSheet_());
  Logger.log('Thành viên: %s | Mặt hàng: %s', struct.members.length, struct.items.length);
}
