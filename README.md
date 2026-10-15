# Auto Chuỗi TikTok

Bản custom từ [KurniawanSatria/TikTok-Streak](https://github.com/KurniawanSatria/TikTok-Streak), chạy trên GitHub Actions. Máy tính và điện thoại của bạn không phải mở để bot chạy.

## Có gì trong bản này

- Chọn nhiều người bằng username TikTok, không gửi theo thứ tự cuộc chat.
- Xác minh tài khoản đăng nhập và username trong đầu cuộc chat trước khi gõ/gửi.
- Các câu ngắn được luân phiên; mỗi người giữ vị trí câu riêng qua các lần chạy. Có thể đặt danh sách câu riêng cho từng người, tối đa 1000 câu mỗi danh sách.
- Mục tiêu gửi từ **08:17, 12:17 và 20:17 mỗi ngày theo giờ Việt Nam**; có lượt kiểm tra dự phòng mỗi giờ trong ba khung. Lượt bị GitHub kích trễ ra ngoài giờ được bỏ qua.
- Lưu chống trùng trên nhánh `bot-state`: mỗi người có một lượt cho từng khung sáng, trưa, tối; tối đa ba khung mỗi ngày.
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

Mẫu có danh sách câu riêng và gợi ý tên trong danh sách chat để tìm nhanh hơn:

```json
[
  {"username":"@ban_a", "chatName":"Tên hiển thị A", "messages":["Giữ chuỗi nha 🔥", "Điểm danh giữ chuỗi 😄", "Chấm chuỗi nè ✨"]},
  {"username":"@ban_b", "chatName":"Tên hiển thị B", "messages":["Ghé giữ chuỗi chút nè 😄", "Chuỗi vẫn tiếp tục nha 🔥"]}
]
```

`chatName` chỉ giúp tìm nhanh. Bot luôn kiểm tra lại username bằng link hồ sơ ở đầu cuộc chat. Những người này cần có cuộc trò chuyện 1–1 trong hộp thư TikTok Web; bản này chưa gửi cho nhóm.

Danh sách chat được đọc lại sau mỗi lần chọn vì TikTok có thể tải thêm hàng hoặc đổi thứ tự. Bot quét lại tối đa ba lượt trong giới hạn `navigationTimeoutMs`, chờ đầu chat và ô soạn sẵn sàng, rồi vẫn xác minh username trước khi gửi. Tên và vị trí hàng chỉ giúp tìm nhanh, không thay cho xác minh người nhận.

Danh sách username đơn giản dùng chung các câu trong `config.json`. Trường `messages` riêng ghi đè danh sách chung. Nếu dùng trường cũ `message`, người đó tiếp tục nhận một câu cố định; chỉ dùng một trong hai trường. Mỗi danh sách nhận 1–1000 câu, mỗi câu 1–500 ký tự trên một dòng, tự loại câu trùng.

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
| `MESSAGES_JSON` | Không bắt buộc. Mảng câu chung, ví dụ `["Giữ chuỗi nha 🔥", "Chấm chuỗi nè ✨"]`. Bỏ trống để dùng các câu trong `config.json`. |
| `MESSAGE` | Tương thích cấu hình cũ: một câu cố định. Muốn dùng câu luân phiên thì để trống hoặc dùng `MESSAGES_JSON`. |

Sau đó có thể chạy **Run workflow → send** để thử ngay. Lượt chạy tay tính vào khung giờ hiện tại và dùng chung chống trùng với lượt theo lịch. Chạy lại trong cùng khung vẫn bỏ qua người đã có lượt; sang khung tiếp theo được gửi câu tiếp theo.

Không cần tạo thêm GitHub PAT. Workflow dùng `GITHUB_TOKEN` của chính repo để ghi trạng thái.

## Đổi giờ

GitHub Actions có thể kích lịch trễ hoặc bỏ lượt. Bot kiểm tra giờ Việt Nam thực tế trước khi cài/mở trình duyệt và ngay trước khi bấm gửi. Ba khung tự động hiện tại:

| Khung | Khoảng được gửi theo giờ Việt Nam | Các giờ kiểm tra dự phòng |
| --- | --- | --- |
| Sáng | 08:17–11:59 | 08:17, 09:17, 10:17, 11:17 |
| Trưa | 12:17–17:59 | 12:17, 13:17, 14:17, 15:17, 16:17, 17:17 |
| Tối | 20:17–22:59 | 20:17, 21:17, 22:17 |

Workflow dùng cron UTC `17 1-10,13-15 * * *`. Có tối đa 13 lượt kiểm tra nhẹ mỗi ngày, nhưng mỗi người vẫn tối đa một lần thử gửi cho mỗi khung. Nếu cả danh sách đã có lượt, bot bỏ qua trước khi cài/mở trình duyệt hoặc đăng nhập TikTok. `sent`, `reserved` và `uncertain` đều chặn thử lại trong cùng khung; lỗi trước khi bấm gửi vẫn có thể thử ở lượt dự phòng. Không gửi bù khung cũ hoặc bù qua nửa đêm.

Muốn đổi lịch, sửa cả khoảng cho phép trong `lib/schedule.js` và cron tương ứng trong `.github/workflows/TikTok-Streak.yml`. Việt Nam nhanh hơn UTC 7 giờ. Tên lượt chạy phân biệt **Tự động · kiểm tra khung gửi** với **Chạy tay**. Dấu xanh của lượt kiểm tra có thể chỉ là bỏ qua vì đã gửi hoặc ngoài giờ; mở Summary để xem lý do.

Chạy tay `send` vẫn được thực hiện ngay khi bạn yêu cầu, tính vào khung sáng 00:00–11:59, trưa 12:00–17:59 hoặc tối 18:00–23:59 và dùng chung dữ liệu chống trùng. Dữ liệu lượt cũ được giữ nguyên; cập nhật lịch không tự mở lại lượt đã gửi. GitHub Actions không bảo đảm chạy chính xác đến phút, kể cả có lượt dự phòng.

## Khi bot gặp lỗi

| Kết quả | Cách xử lý |
| --- | --- |
| `DRAFT_NOT_EMPTY` | Cuộc chat có bản nháp. Tự xử lý bản nháp rồi chạy kiểm tra lại. |
| `RECIPIENT_NOT_FOUND` | Chưa tìm được người trước khi bấm gửi. Kiểm tra username và cuộc chat 1–1 trên TikTok Web; log kèm số hàng/lượt quét để chẩn đoán, không in nội dung chat. |
| `HISTORY_RECIPIENT_NOT_FOUND` | Đã bấm gửi nhưng không tìm lại được cuộc chat sau khi mở lại hộp thư. Giữ `uncertain`, không tự gửi lại trong cùng khung; kiểm tra tin thực tế trong TikTok. |
| `AUTH_REQUIRED` / `BOT_BLOCKED` | Bot dừng nếu TikTok yêu cầu đăng nhập hoặc CAPTCHA. Cập nhật phiên đăng nhập hợp lệ khi cần. |
| Ghi trạng thái GitHub lỗi | Bot không bắt đầu gửi nếu chưa lưu được lượt gửi. |
| Chưa xác nhận được sau khi bấm gửi, tin biến mất sau khi mở lại hoặc bị mất phiên | Ghi `uncertain`, không tự gửi lại trong cùng khung. Khung tiếp theo là một lượt riêng. Kiểm tra cuộc chat và tự rep nếu cần. |
| Chưa tới bước bấm gửi mà lỗi | Lượt đó có thể thử lại ở lần chạy sau. |

Không xóa nhánh `bot-state` giữa ngày: đó là dữ liệu dùng để tránh gửi trùng. Nhánh chỉ lưu mã SHA-256 từ tài khoản/người nhận, ngày, trạng thái từng khung và vị trí câu luân phiên, không lưu nội dung tin hay username ở dạng rõ.

Trạng thái cũ chỉ có ngày được tự chuyển sang định dạng mới và giữ lượt cũ ở khung sáng của ngày đó; khung trưa/tối vẫn được chạy. Khi cập nhật, tạo lượt bằng **Run workflow trên nhánh main** để dùng code mới. Câu đầu được phân bố theo mã người nhận, các lượt tiếp theo luân phiên và không lặp liền nhau nếu danh sách có nhiều hơn một câu.

## Kiểm tra code

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

Các bài kiểm tra dùng trang mô phỏng nội bộ, không gửi tin thật: trùng tên hiển thị, đổi thứ tự ngay khi chọn chat, danh sách tải thêm người, chat tải lâu hơn 2,5 giây, tìm lại chat sau gửi, iframe, sai tài khoản, bản nháp, chat đổi khi đang gõ, tin hiện tạm nhưng không được lưu, mất phiên sau khi bấm gửi, ba khung gửi độc lập, chuyển trạng thái cũ, câu luân phiên qua các lần chạy, lịch bị trễ đến 01:03, lượt dự phòng không mở trình duyệt khi đã có lượt và khung đóng trước khi bấm gửi.

Mã nguồn đã được kiểm tra trên trang mô phỏng. Cần chạy `dry-run` bằng phiên TikTok của bạn để xác nhận giao diện thực tế trước khi bật bot. Nếu TikTok đổi HTML, có thể chỉnh các selector trong `lib/tiktok.js` hoặc ghi đè bằng trường `selectors` trong `config.json`.

## Nguồn

Fork giữ lịch sử và giấy phép MIT của tác giả gốc. Bản custom dùng Playwright, bỏ chế độ gửi N chat đầu và dịch thông báo sang tiếng Việt. Selector đầu cuộc chat được đối chiếu với mã nguồn công khai của [Jon2G/TiktokStreakSaver](https://github.com/Jon2G/TiktokStreakSaver).
