# Đăng ký mua hiện vật bồi dưỡng — TTKSKL Long Thành

Trang web cho 42 thành viên tự chọn mặt hàng (giá tham chiếu Co.op Online), tự động
so sánh tổng tiền đã chọn với mức bồi dưỡng cá nhân. Dữ liệu đọc/ghi trực tiếp vào
Google Sheet "Danh sách đăng ký mua hiện vật TTKSKL LT 2026" — sheet **"Biên bản"**
không bị đụng tới, các công thức có sẵn ở đó vẫn chạy bình thường vì nó tham chiếu
tới sheet **"Tổng hợp"** (nơi trang web ghi dữ liệu vào).

```
bdhv-longthanh/
├── apps-script/
│   └── Code.gs        ← dán vào Apps Script gắn với Google Sheet (backend)
└── site/
    └── index.html      ← trang web tĩnh, deploy lên Netlify (frontend)
```

## Kiến trúc

```
Trình duyệt (điện thoại/máy tính của 42 người)
        │  fetch (GET / POST)
        ▼
Netlify — site/index.html  (giao diện chọn hàng, tính tổng tiền)
        │  fetch (GET / POST, không set Content-Type để tránh CORS preflight)
        ▼
Google Apps Script Web App (apps-script/Code.gs)
        │  đọc/ghi trực tiếp
        ▼
Google Sheet — sheet "Tổng hợp"  (nguồn dữ liệu gốc — sheet "Biên bản" tự tính từ đây)
```

## Bước 1 — Triển khai Google Apps Script

1. Mở Google Sheet đăng ký → menu **Tiện ích mở rộng (Extensions) → Apps Script**.
2. Xoá nội dung mặc định trong `Code.gs`, dán toàn bộ nội dung file `apps-script/Code.gs` vào.
3. Kiểm tra hằng số `SHEET_NAME` ở đầu file đúng bằng tên tab chứa bảng đăng ký
   (mặc định `'Tổng hợp'`).
4. Bấm **Triển khai (Deploy) → Deployment mới (New deployment)**:
   - Chọn loại: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Bấm **Deploy**, cấp quyền truy cập Google Sheet khi được hỏi.
6. Copy **Web app URL** (dạng `https://script.google.com/macros/s/AKfycb.../exec`).
7. Có thể chạy thử hàm `_test()` trong Apps Script Editor (chọn hàm → Run) để xem
   log số thành viên/số mặt hàng đọc được có đúng không.

> Mỗi lần sửa code sau này, phải vào **Deploy → Manage deployments → Edit (bút chì)
> → chọn "New version" → Deploy** thì URL cũ mới nhận code mới.

## Bước 2 — Gắn URL vào trang web

Mở `site/index.html`, tìm dòng:

```js
const APPS_SCRIPT_URL = "PASTE_APPS_SCRIPT_WEB_APP_URL_HERE";
```

Thay bằng URL vừa copy ở Bước 1, ví dụ:

```js
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
```

## Bước 3 — Deploy lên Netlify

**Cách nhanh nhất (kéo-thả, không cần Git):**

1. Vào [app.netlify.com](https://app.netlify.com) → đăng nhập.
2. Vào mục **Sites** → kéo thả **thư mục `site`** (chứa `index.html`) vào ô
   "Drag and drop your site output folder here".
3. Netlify tự cấp một địa chỉ dạng `https://ten-ngau-nhien.netlify.app` — có thể đổi
   tên miền phụ trong **Site settings → Change site name**.

**Cách dùng Git (khuyên dùng nếu sau này còn sửa code nhiều lần):**

1. Đẩy toàn bộ thư mục `bdhv-longthanh` lên một repo GitHub.
2. Trong Netlify: **Add new site → Import an existing project** → chọn repo.
3. Cấu hình build:
   - Base directory: `site`
   - Build command: *(để trống — đây là site tĩnh, không cần build)*
   - Publish directory: `site`
4. Deploy. Từ giờ mỗi lần push code lên Git, Netlify tự deploy lại.

## Cấu trúc Google Sheet mà script yêu cầu

Script tự dò các mốc sau trong sheet "Tổng hợp" (không cần đúng cột/hàng cố định,
chỉ cần đúng **nhãn chữ**):

- Một hàng có ô ghi đúng chữ **"Họ và tên"**, các ô liền sau trên cùng hàng là tên
  42 thành viên.
- Hàng ngay bên dưới (hoặc hàng có nhãn bắt đầu bằng **"Mức chi bồi dưỡng"**) chứa
  mức bồi dưỡng của từng người, đúng cột với tên tương ứng.
- Một hàng tiêu đề bảng hàng hoá có đủ 3 ô: **"STT"**, **"Tên hàng hoá"**, **"Đơn giá"**.
- Từ hàng kế tiếp trở đi là danh sách mặt hàng. Muốn thêm **danh mục mới** (ví dụ
  "Bánh kẹo, thức uống khác", "Hàng thêm vào", "Mặt hàng Tết"), chỉ cần chèn một
  hàng có tên danh mục ở cột "Tên hàng hoá" nhưng **để trống cột STT** — script sẽ
  tự nhận đó là tiêu đề nhóm, các mặt hàng phía dưới thuộc nhóm đó, hoàn toàn không
  cần sửa code.

## Ghi chú

- **Bảo mật**: Web App đặt "Anyone" nghĩa là ai có đúng URL cũng gọi được API (đọc
  giá + tên, ghi lựa chọn). URL không được liệt kê công khai ở đâu ngoài trong code
  trang web, nhưng đây không phải bảo mật tuyệt đối. Nếu cần chặt hơn, có thể thêm
  một mã PIN dùng chung do Apps Script kiểm tra trước khi ghi — nói mình biết nếu
  anh muốn thêm phần này.
- **Ghi đè lựa chọn**: mỗi lần bấm "Lưu lựa chọn", toàn bộ cột của người đó trong
  sheet "Tổng hợp" được ghi đè theo lựa chọn mới nhất (mặt hàng bỏ chọn sẽ bị xoá
  số lượng cũ) — tránh trùng lặp khi một người đăng ký lại nhiều lần.
- **Giá hàng hoá**: script đọc giá trực tiếp từ cột "Đơn giá" trong sheet — nghĩa
  là mỗi lần anh cập nhật giá theo Co.op Online (phần mình đang làm dần theo từng
  đợt danh mục), trang web sẽ tự động hiển thị giá mới, không cần sửa gì thêm.
