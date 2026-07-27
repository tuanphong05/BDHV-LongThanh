/**
 * ĐĂNG KÝ MUA HIỆN VẬT BỒI DƯỠNG - TTKSKL LONG THÀNH
 * Backend Google Apps Script (container-bound với Google Sheet đăng ký)
 *
 * ─────────────────────────────────────────────────────────────
 * CÁCH TRIỂN KHAI
 * ─────────────────────────────────────────────────────────────
 * 1. Mở Google Sheet đăng ký -> menu "Tiện ích mở rộng" (Extensions) -> "Apps Script"
 * 2. Xoá toàn bộ nội dung mặc định trong file Code.gs, dán nguyên văn file này vào
 * 3. Kiểm tra hằng số SHEET_NAME bên dưới đúng với tên tab chứa bảng đăng ký
 *    (mặc định là "Tổng hợp")
 * 4. Bấm "Triển khai" (Deploy) -> "Deployment mới" (New deployment)
 *      - Loại (Select type): Web app
 *      - Execute as: Me (tài khoản của anh)
 *      - Who has access: Anyone (để trang web gọi được, không cần đăng nhập Google)
 * 5. Copy "Web app URL" -> dán vào biến APPS_SCRIPT_URL trong file site/index.html
 * 6. Mỗi khi sửa code này, phải "Triển khai" > "Quản lý deployment" > sửa phiên bản
 *    (Edit) > New version, thì URL cũ mới nhận code mới.
 *
 * LƯU Ý QUAN TRỌNG VỀ CORS:
 * Không thêm header "Content-Type: application/json" khi gọi fetch() từ web,
 * hãy để trình duyệt tự gửi "text/plain" (xem site/index.html). Nếu đổi sang
 * application/json, trình duyệt sẽ gửi preflight OPTIONS mà Apps Script không
 * hỗ trợ, request sẽ bị lỗi CORS.
 * CẬP NHẬT GIÁ TỰ ĐỘNG (action=updatePrices):
 * Cho phép ghi trực tiếp giá mới vào cột "Đơn giá" bằng cách gọi URL Web App dạng:
 *   .../exec?action=updatePrices&key=ADMIN_KEY&items=STT:GIA,STT:GIA,...
 *   ví dụ: .../exec?action=updatePrices&key=xxx&items=1:33500,6:146000,9:27500
 * (khớp theo cột STT trong sheet, không phải tên, để URL ngắn gọn). Phải khớp đúng
 * ADMIN_KEY bên dưới mới ghi được. Đây là cách Claude có thể tự cập nhật giá vào sheet
 * "Tổng hợp" giúp anh mà không cần anh copy/paste tay — chỉ cần triển khai lại (New
 * version) sau khi dán code này.
 */

const SHEET_NAME = 'Tổng hợp'; // đổi nếu tên tab khác

// Mã bí mật để xác thực khi cập nhật giá qua action=updatePrices — ĐỔI chuỗi này thành
// một chuỗi riêng của anh, không chia sẻ công khai (khác với việc URL Web App vẫn "Anyone"
// truy cập được, nhưng phải biết đúng mã này thì mới ghi/sửa được giá).
const ADMIN_KEY = 'longthanh-bdhv-2026-doimatkhau';

// ───────────────────────── Đọc cấu trúc bảng tính (tự động, không hard-code ô) ─────────────────────────

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Không tìm thấy sheet "' + SHEET_NAME + '". Kiểm tra lại SHEET_NAME trong Code.gs.');
  return sheet;
}

function readStructure_(sheet) {
  const data = sheet.getDataRange().getValues();
  const numRows = data.length;
  const numCols = data[0].length;

  // 1) Tìm hàng "Họ và tên" và hàng "Mức chi bồi dưỡng..."
  let nameRow = -1, budgetRow = -1;
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const val = String(data[r][c]).trim();
      if (val === 'Họ và tên') nameRow = r;
      if (val.indexOf('Mức chi bồi dưỡng') === 0) budgetRow = r;
    }
    if (nameRow >= 0 && budgetRow >= 0) break;
  }
  if (nameRow < 0) throw new Error('Không tìm thấy hàng "Họ và tên" trong sheet "' + SHEET_NAME + '".');
  if (budgetRow < 0) budgetRow = nameRow + 1;

  // 2) Xác định cột bắt đầu/kết thúc của các thành viên
  let firstMemberCol = -1, lastMemberCol = -1;
  for (let c = 0; c < numCols; c++) {
    const val = String(data[nameRow][c]).trim();
    if (val !== '' && val !== 'Họ và tên') {
      if (firstMemberCol < 0) firstMemberCol = c;
      lastMemberCol = c;
    }
  }
  if (firstMemberCol < 0) throw new Error('Không tìm thấy tên thành viên trên hàng "Họ và tên".');

  const members = [];
  for (let c = firstMemberCol; c <= lastMemberCol; c++) {
    const name = String(data[nameRow][c]).trim();
    if (!name) continue;
    const budget = Number(data[budgetRow][c]) || 0;
    members.push({ name: name, col: c, budget: budget });
  }

  // 3) Tìm hàng tiêu đề bảng hàng hoá: có cả "STT", "Tên hàng hoá", "Đơn giá"
  //    Cột "Hình ảnh" là tuỳ chọn — có thì đọc, không có vẫn chạy bình thường.
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
  if (itemHeaderRow < 0) throw new Error('Không tìm thấy hàng tiêu đề "STT / Tên hàng hoá / Đơn giá".');

  // 4) Đọc danh sách mặt hàng (bỏ qua hàng tiêu đề nhóm như "Sữa các loại")
  const items = [];
  let currentCategory = '';
  for (let r = itemHeaderRow + 1; r < numRows; r++) {
    const sttVal = String(data[r][colSTT]).trim();
    const nameVal = String(data[r][colName]).trim();
    if (sttVal === '' && nameVal === '') continue; // hàng trắng
    if (sttVal === '' && nameVal !== '') {          // hàng tiêu đề nhóm hàng
      currentCategory = nameVal;
      continue;
    }
    if (nameVal === '') continue;
    items.push({
      row: r, // index 0-based trong mảng data, dùng để ghi lại: getRange(row+1, col+1)
      stt: data[r][colSTT],
      name: nameVal,
      unit: colUnit >= 0 ? String(data[r][colUnit]).trim() : '',
      price: Number(data[r][colPrice]) || 0,
      image: colImage >= 0 ? String(data[r][colImage]).trim() : '',
      category: currentCategory
    });
  }

  return { data: data, nameRow: nameRow, budgetRow: budgetRow, members: members, items: items, colPrice: colPrice };
}

// ───────────────────────── API ─────────────────────────

function doGet(e) {
  try {
    const action = (e.parameter.action || 'catalog').trim();
    const sheet = getSheet_();
    const struct = readStructure_(sheet);

    if (action === 'catalog') {
      const members = struct.members.map(function (m) { return { name: m.name, budget: m.budget }; });
      const items = struct.items.map(function (it) {
        return { stt: it.stt, name: it.name, unit: it.unit, price: it.price, image: it.image, category: it.category };
      });
      return jsonOut_({ ok: true, members: members, items: items });
    }

    if (action === 'updatePrices') {
      const key = e.parameter.key || '';
      if (key !== ADMIN_KEY) return jsonOut_({ ok: false, error: 'Sai mã xác thực (key).' });

      // Định dạng gọn để URL ngắn: "stt:gia,stt:gia,..."  ví dụ "1:33500,6:146000"
      const raw = (e.parameter.items || '').trim();
      const pairs = raw ? raw.split(',') : [];

      const updated = [];
      const notFound = [];
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
      const member = struct.members.filter(function (m) { return m.name === name; })[0];
      if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });

      const selections = {};
      let tongTien = 0;
      struct.items.forEach(function (it) {
        const qty = Number(struct.data[it.row][member.col]) || 0;
        if (qty > 0) {
          selections[it.name] = qty;
          tongTien += qty * it.price;
        }
      });
      return jsonOut_({ ok: true, name: member.name, budget: member.budget, selections: selections, tongTien: tongTien });
    }

    return jsonOut_({ ok: false, error: 'Tham số action không hợp lệ (dùng catalog hoặc member).' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const name = String(body.name || '').trim();
    const selections = body.selections || {}; // { "Tên hàng hoá đúng như trong sheet": soLuong }

    const sheet = getSheet_();
    const struct = readStructure_(sheet);

    const member = struct.members.filter(function (m) { return m.name === name; })[0];
    if (!member) return jsonOut_({ ok: false, error: 'Không tìm thấy thành viên: ' + name });

    // Ghi đè toàn bộ lựa chọn của thành viên này (mặt hàng không có trong selections -> để trống)
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

// ───────────────────────── Kiểm tra nhanh trong Apps Script Editor ─────────────────────────
function _test() {
  const sheet = getSheet_();
  const struct = readStructure_(sheet);
  Logger.log('Số thành viên: %s', struct.members.length);
  Logger.log('Số mặt hàng: %s', struct.items.length);
  Logger.log(JSON.stringify(struct.members.slice(0, 3)));
  Logger.log(JSON.stringify(struct.items.slice(0, 3)));
}
