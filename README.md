# Auto Chuỗi TikTok

Bản custom từ [KurniawanSatria/TikTok-Streak](https://github.com/KurniawanSatria/TikTok-Streak), chạy trên GitHub Actions. Máy tính và điện thoại của bạn không phải mở để bot chạy.

## Có gì trong bản này

- Chọn nhiều người bằng username TikTok, không gửi theo thứ tự cuộc chat.
- Xác minh tài khoản đăng nhập và username trong đầu cuộc chat trước khi gõ/gửi.
- Tin nhắn mặc định `🔥`, có thể đặt câu riêng cho từng người.
- Lịch mặc định khoảng **21:17 mỗi ngày theo giờ Việt Nam**.
- Lưu chống trùng trên nhánh `bot-state`, nên chạy lại workflow vẫn không gửi lại cùng ngày.
- Mặc định bot **tắt**. Có chế độ `dry-run` chỉ kiểm tra, không nhập hay gửi tin.
- Không xóa bản nháp có sẵn. Không công khai cookie hoặc danh sách người nhận trong code.

Bot gửi một tin theo lịch cho danh sách được chọn, không phải AI trả lời nội dung trò chuyện. Người kia vẫn cần tương tác để duy trì chuỗi. Sau khi thấy tin mới và ô soạn trống, bot mở lại trang hộp thư, xác minh lại tài khoản/người nhận và kiểm tra tin vẫn còn trong lịch sử rồi mới ghi `sent`. Đây là xác nhận qua giao diện lịch sử, không phải biên nhận từ máy chủ hoặc cam kết chuỗi chắc chắn tăng.

## Cấu hình một lần trên GitHub

Repo của bạn: **[manh02847/TikTok-Streak](https://github.com/manh02847/TikTok-Streak)**.

### 1. Thêm ba Secrets

Vào **Settings → Secrets and variables → Actions → Secrets → New repository secret**.

| Tên | Giá trị |
| --- | --- |
| `ACCOUNT_USERNAME` | Username tài khoản TikTok của bạn, không dùng tên hiển thị. |
| `COOKIES_JSON` | Danh sách cookie của phiên TikTok đã đăng nhập trên web, có `sessionid` hoặc `sessionid_ss` còn sống. Hỗ trợ mảng cookie hoặc `storageState` của Playwright. |
| `RECIPIENTS_JSON` | Danh sách username người cần giữ chuỗi, theo mẫu bên dưới. |

Mẫu danh sách đơn giản:

```json
["@ban_a", "@ban_b", "@ban_c"]
```

Mẫu có câu riêng và gợi ý tên trong danh sách chat để tìm nhanh hơn:

```json
[
  {"username":"@ban_a", "chatName":"Tên hiển thị A", "message":"🔥"},
  {"username":"@ban_b", "chatName":"Tên hiển thị B", "message":"giữ chuỗi nhé 🔥"}
]
```

`chatName` chỉ giúp tìm nhanh. Bot luôn kiểm tra lại username bằng link hồ sơ ở đầu cuộc chat. Những người này cần có cuộc trò chuyện 1–1 trong hộp thư TikTok Web; bản này chưa gửi cho nhóm.

Cookie cho phép truy cập phiên đăng nhập. Chỉ lưu vào Secret của repo bạn; không gửi trong chat, README, commit hoặc issue. Không cần đưa mật khẩu TikTok cho bot.

Để lấy cookie:

1. Cài [Cookie-Editor của Christophe Gagnier](https://cookie-editor.com/) cho trình duyệt. Trang chính thức có link Chrome, Edge, Firefox và Safari trên iPhone.
2. Đăng nhập **TikTok Web** đúng tài khoản, mở [hộp thư](https://www.tiktok.com/messages?lang=en) và kiểm tra bạn đọc được cuộc chat.
3. Mở Cookie-Editor ngay tại tab TikTok, cấp quyền cho trang này nếu được hỏi. Chọn **Export → JSON**, sao chép toàn bộ danh sách, không chỉ một giá trị `sessionid`. Không chọn Header String hoặc Netscape.
4. Vào Secrets của repo, sửa `COOKIES_JSON`, dán nguyên JSON rồi bấm **Update secret**. Không đặt trong dấu nháy ngoài hoặc khối Markdown.

Máy dùng để lấy cookie có thể đóng sau đó; bot vẫn chạy trên GitHub. Cookie hết hạn hoặc bị TikTok thu hồi thì cần xuất lại.

### 2. Chạy kiểm tra trước

Vào **Actions → TikTok Streak → Run workflow**, chọn `dry-run`.

Có thể chọn `check-config` trước để kiểm tra định dạng ba Secrets, số người nhận và cookie phiên có áp dụng đúng địa chỉ hộp thư không. Chế độ này không mở TikTok hoặc gửi tin và không in giá trị cookie/username. Kết quả thành công chỉ chứng minh cấu hình đúng; không xác nhận phiên còn được TikTok chấp nhận. Mỗi lượt chạy bot cũng kiểm tra cấu hình trước khi tải trình duyệt.

Bot kiểm tra tài khoản, người nhận và ô soạn trống. Không gõ tin nhắn, không bấm gửi, không sửa trạng thái chống trùng. Các dòng log dùng mã người nhận thay cho username; thứ tự tương ứng danh sách cấu hình.

Nếu nhận `ACCOUNT_NOT_VERIFIED`, cookie chưa đúng tài khoản hoặc TikTok đổi vị trí link Profile. Nếu nhận `RECIPIENT_NOT_FOUND` / `INBOX_NOT_FOUND`, hộp thư hoặc cấu trúc trang cần kiểm tra lại. Đừng bật gửi thật trước khi kiểm tra qua.

### 3. Bật lịch gửi

Vào **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Tên | Giá trị |
| --- | --- |
| `BOT_ENABLED` | `true` để bật; `false` để dừng. |
| `MESSAGE` | Không bắt buộc. Câu mặc định cho người không có `message` riêng, ví dụ `🔥`. |

Sau đó có thể chạy **Run workflow → send** để thử ngay. Các lần chạy trong cùng ngày vẫn dùng chung trạng thái chống trùng.

Không cần tạo thêm GitHub PAT. Workflow dùng `GITHUB_TOKEN` của chính repo để ghi trạng thái.

## Đổi giờ

Sửa dòng `cron` trong `.github/workflows/TikTok-Streak.yml`. Lịch cron dùng UTC, Việt Nam nhanh hơn 7 giờ:

| Giờ Việt Nam | Cron |
| --- | --- |
| 20:17 | `17 13 * * *` |
| 21:17 | `17 14 * * *` |
| 22:17 | `17 15 * * *` |

GitHub có thể chạy trễ hoặc bỏ lượt khi hệ thống quá tải; giờ này là lịch yêu cầu, không bảo đảm chính xác đến phút. Xem lịch sử Actions để biết lần chạy thực tế. Có thể thêm một lượt dự phòng trước nửa đêm; chống trùng sẽ bỏ qua người đã có lượt gửi.

## Khi bot gặp lỗi

| Kết quả | Cách xử lý |
| --- | --- |
| `DRAFT_NOT_EMPTY` | Cuộc chat có bản nháp. Tự xử lý bản nháp rồi chạy kiểm tra lại. |
| `AUTH_REQUIRED` / `BOT_BLOCKED` | Bot dừng nếu TikTok yêu cầu đăng nhập hoặc CAPTCHA. Cập nhật phiên đăng nhập hợp lệ khi cần. |
| Ghi trạng thái GitHub lỗi | Bot không bắt đầu gửi nếu chưa lưu được lượt gửi. |
| Chưa xác nhận được sau khi bấm gửi, tin biến mất sau khi mở lại hoặc bị mất phiên | Ghi `uncertain`, không tự gửi lại trong ngày. Kiểm tra cuộc chat và tự rep nếu cần. Chỉ mở lại lượt gửi khi bạn đã xác nhận không có tin. |
| Chưa tới bước bấm gửi mà lỗi | Lượt đó có thể thử lại ở lần chạy sau. |

Không xóa nhánh `bot-state` giữa ngày: đó là dữ liệu dùng để tránh gửi trùng. Nhánh chỉ lưu mã SHA-256 từ tài khoản/người nhận, ngày và trạng thái, không lưu nội dung tin hay username ở dạng rõ.

## Kiểm tra code

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

Các bài kiểm tra dùng trang mô phỏng nội bộ, không gửi tin thật: trùng tên hiển thị, đổi thứ tự chat, iframe, sai tài khoản, bản nháp, chat đổi khi đang gõ, tin hiện tạm nhưng không được lưu, mất phiên sau khi bấm gửi, workflow chạy lại và ngày Việt Nam qua nửa đêm.

Mã nguồn đã được kiểm tra trên trang mô phỏng. Cần chạy `dry-run` bằng phiên TikTok của bạn để xác nhận giao diện thực tế trước khi bật bot. Nếu TikTok đổi HTML, có thể chỉnh các selector trong `lib/tiktok.js` hoặc ghi đè bằng trường `selectors` trong `config.json`.

## Nguồn

Fork giữ lịch sử và giấy phép MIT của tác giả gốc. Bản custom dùng Playwright, bỏ chế độ gửi N chat đầu và dịch thông báo sang tiếng Việt. Selector đầu cuộc chat được đối chiếu với mã nguồn công khai của [Jon2G/TiktokStreakSaver](https://github.com/Jon2G/TiktokStreakSaver).
