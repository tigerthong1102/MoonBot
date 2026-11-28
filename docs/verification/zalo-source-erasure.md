# Zalo source erasure

## 30. Quản lý dữ liệu và quyền xóa

Thiết kế retention policy phù hợp.

Không mặc định lưu toàn bộ tin nhắn vô thời hạn.

Người dùng có thể lựa chọn thời gian lưu giữ nếu phù hợp với chính sách tổ chức.

Phải hỗ trợ:

- Xóa dữ liệu của tài khoản đã ngắt kết nối.
- Xóa dữ liệu một nhóm.
- Xóa dữ liệu một khoảng thời gian.
- Thu hồi quyền xử lý.
- Xóa cache.
- Xóa search index.
- Xóa embedding.
- Xử lý bản tóm tắt dẫn xuất.
- Kiểm tra AI Twin learning liên quan.
- Kiểm tra Second Brain references.
- Xử lý dữ liệu backup.

Khi tài liệu hoặc tin nhắn không còn được phép sử dụng, AI không được trả lời bằng bản sao cũ trong memory.

Không cho backup cũ khôi phục quyền đã bị thu hồi.

Phải giải thích rằng dữ liệu đã được gửi đến người nhận hoặc nhà cung cấp bên ngoài có thể không thu hồi được hoàn toàn bằng việc xóa trong StartupBot.

Đánh giá các nghĩa vụ bảo vệ dữ liệu cá nhân hiện hành tại Việt Nam và điều khoản nhà cung cấp AI.

Không mặc định quyền sở hữu tài khoản Zalo cho phép lưu trữ, phân tích hoặc chuyển toàn bộ dữ liệu của những người tham gia hội thoại.

## Implementation and evidence

| Data or action | Product behavior and qualification |
| --- | --- |
| Retention | The local desktop owner chooses 1–365 days when approving the Official private chat. Reads and ingress purge expired content. The opted-in desktop host sweeps its existing private inbox and pairing challenges immediately on startup and every five minutes while idle. Closing the server cancels the timer. When the whole app is stopped, cleanup resumes on the next enabled start. |
| Account and conversation | Removing the Official endpoint deletes its grant and cascades to its inbox rows. The private inbox exposes account and conversation revocation, including Personal group scope. The group case is an internal qualification fixture. |
| Interval | The paired desktop panel accepts local calendar dates. Preview binds the displayed grant revision, timestamp bounds and exact matching row IDs. Confirmation and committed aggregate readback use one SQLite write transaction. A later delivery in a deleted interval is rejected for the lifetime of those messages. |
| Cache, search, embeddings, summaries | The private inbox queried by this panel stores normalized event rows and grant metadata. It has no search index, embedding store, derived summary or cloud sync. The erasure preview transfers only counts and opaque digests. |
| AI Twin and Second Brain | This route has no write to either system. Separately granted imports, copied content and independently authored notes have their own source lifecycle. Removing an inbox grant does not prove deletion of independent exports or user-created records. |
| Backup | The private store sits outside the default workspace. Encrypted workspace export and archive ingestion also exclude the reserved qualification directory when workspace roots overlap. A pre-deletion archive fixture is staged and restored after interval erasure and revocation. The ordinary note returns, erased messages stay inaccessible and replay fails. StartupBot workspace archives are the tested boundary. |
| External transfer | The interface explains that recipients and external providers may retain copies they already received. Account ownership alone does not establish authorization from conversation participants. |

## Vietnam and external processing

Law 91/2025/QH15 and implementing Decree 356/2025/NĐ-CP took effect on 1 January 2026. For a real deployment, the organization should establish participant-specific authority and purpose, who receives data, retention, withdrawal and rights handling. For a remote model it should also assess the actual processor, jurisdiction and any applicable cross-border transfer obligations. The local grant and synthetic backup test evidence the software controls only. [Law 91/2025/QH15](https://vanban.chinhphu.vn/?docid=214590&pageid=27160) and [Decree 356/2025/NĐ-CP](https://vanban.chinhphu.vn/?classid=1&docid=216387&orggroupid=2&pageid=27160).

Provider retention varies with the service, model and agreement. A local Ollama model and a cloud model have different processing paths. Anthropic also publishes model-specific requirements. Check the provider instance and organization's agreement before a real transfer, including onward processing, retention and available deletion procedures. Local erasure cannot withdraw a copy already delivered. [Ollama local and cloud documentation](https://docs.ollama.com/faq) and [Anthropic model-specific retention](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide).
