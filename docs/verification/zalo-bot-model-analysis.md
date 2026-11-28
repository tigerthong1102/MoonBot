# Phân tích đoạn Zalo bằng model của bot

Tại **Cài đặt → Nhập và xuất → Rà soát đoạn chat Zalo**, nhập dữ liệu được phép rồi chọn **Phân tích dòng đã chọn bằng bot này**. Chọn nghiệp vụ, loại hội thoại và từng dòng trên trang cần gửi. Xem tên kết nối và model trước khi gửi. Chỉ các dòng được chọn, số dòng, nghiệp vụ và loại hội thoại đi vào prompt. Tên nguồn hiển thị trong kết quả do ứng dụng gắn cục bộ.

Chức năng dùng bot và model hiện tại trên desktop. AI Twin có thể tắt. Tối đa tám dòng và 8.000 ký tự cho một lượt. Các dòng giống hệt nhau dùng số dòng được chọn đầu tiên. Các trích dẫn trả về là suy luận phân loại của model; người dùng đối chiếu với văn bản. Từ chối toàn bộ kết quả khi một nhãn ngoài nghiệp vụ, dòng ngoài phạm vi, hoặc câu trích không có nguyên văn. Mỗi nghiệp vụ dùng nhãn riêng cho bất động sản, kế toán, quản lý, thương mại điện tử, logistics hoặc trợ lý cá nhân. Kết quả không tạo task, không gửi Zalo và không ghi vào lịch sử chat.

## Quyền và chi phí

GET kiểm tra capability, không nhận nội dung trích đoạn. POST yêu cầu đồng ý rõ ràng và mã một lần hết hạn sau năm phút. Server chỉ cho desktop owner trên máy được quản lý truy cập. Model dùng sourceWriter và sideJobs.sourceAnswer với budget và usage ledger của bot, không dùng model dự phòng. Kiểm tra quyền của task, engine, model và cùng instance khi trình bày lựa chọn, trước dispatch và trước khi trả kết quả. Driver có hook trước HTTP request kiểm lại quyền và ngân sách tại hook đó. Một lượt gửi có thời hạn 65 giây và chặn lượt thứ hai đang chạy. Không tự retry khi POST có kết quả không xác định.

Đặt STARTUPBOT_ZALO_MODEL_ANALYSIS=0 ở server để chặn cả GET và POST. Đoạn dùng riêng cho kiểm thử thủ công. Chưa đo chi phí nhà cung cấp trả phí, benchmark chất lượng từng model hoặc thời gian chờ trên mạng di động.

## Bằng chứng

- macOS arm64, Electron nội bộ, profile và data dir tạm, AI Twin tắt. Bot cấu hình OpenAI-compatible với URL loopback của Ollama. Nhập hai dòng tổng hợp, đánh dấu một dòng trong nhóm, chọn kế toán, qua bước xem model llama3.2:3b rồi gửi. GET/POST 200, đơn vị phân loại invoice trích nguyên văn dòng 1. Kết quả phụ thuộc model; đây là một lần thử với dịch vụ local thật.
- Test route xác minh quyền khi đang xếp hàng, thay model/instance kể cả cùng ID, thiếu capability, giới hạn chi tiêu, một lần dùng, từ chối dữ liệu không được dẫn nguồn, và lịch sử chat không thay đổi. Bài test giao diện xác minh preview chưa gửi nội dung, request sau khi duyệt chỉ gồm dòng đã chọn. Fixture của sáu nghiệp vụ kiểm nhãn và nguồn.
- Chạy lại với pnpm typecheck, pnpm lint, pnpm i18n:check và pnpm exec vitest run server/zalo-model-evidence.test.ts server/routes/zalo-model-analysis.test.ts src/components/ZaloModelAnalysis.dom.test.ts. Đối chiếu các test hiện có cho knowledge-answers, side-jobs và AI Twin khi đổi đường model.

Bản thử GO cho phân tích thủ công trên desktop đã kiểm chứng. Dịch vụ Zalo thật, nhà cung cấp cloud trả phí, cấu hình keychain và packaged UI Windows/Linux chưa được thử trong phép kiểm này. Rollback bằng kill switch server hoặc revert commit. Không có migration DB.
