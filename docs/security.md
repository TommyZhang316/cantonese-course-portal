# 權限及資料保護

這個網站以 GitHub Pages 提供公開前端；登入、角色、教材清單及文件下載由 Supabase 伺服器驗證。公開 repository、Pages 的檔案及瀏覽器程式碼不可放入任何教材、試卷答案、賬戶名單、私人清單或 service-role key。只把 Supabase 專案網址及 publishable/anon key 交給前端。

## 權限矩陣

| 身份 | 自己的賬戶狀態 | 課表 | 可讀教材 | 管理設定 |
| --- | --- | --- | --- | --- |
| 未登入 | 無 | 無 | 無 | 無 |
| 待核准／停用 | 可見 | 無 | 無 | 無 |
| 已核准學生 | 可見 | 可見 | 即時公開或已到發佈時間、未封存的資料 | 無 |
| 已核准老師 | 可見 | 可見 | 所有未封存資料，包括教師資料及未到期學生資料 | 無 |
| 已核准管理員 | 所有賬戶 | 可見 | 全部資料，包括已封存資料 | 角色、核准／停用、課表、教材、發佈時間、封存及恢復 |

「永不向學生公開」由資料庫 RLS 執行。學生即使直接呼叫 API、猜中文件路徑、改瀏覽器時間、篡改頁面或繞過選單，也不能取得這類教材的標題、描述、下載路徑或文件。伺服器以每次 SQL 請求的時間判斷定時公開；預設發佈時間為上課香港日期往前七日的上午 09:00。未設定課堂日期時不能臆造發佈日期，教材維持教師可見，待管理員設定。

## 賬戶與權限

註冊只接收顯示名稱；即使註冊 metadata 中偽造 `role=admin` 或 `status=approved`，新賬戶仍然是待核准學生。必須完成電郵驗證才可獲核准。角色從資料庫即時讀取，不依賴可能尚未過期的 JWT 角色聲明；停用、撤銷老師權限後，下一次教材 API／下載請求便受新權限約束。

管理員更改採版本檢查，兩人同時修改相同資料時，舊版本會失敗並要求重新載入。資料庫用交易鎖序列化角色變更，並禁止移除最後一位已核准管理員。網站沒有永久刪除教材或賬戶的按鈕。賬戶、課表及教材變更留下只有管理員可看的稽核記錄。

首次管理員由已登入 Supabase 的專案擁有人在 SQL Dashboard 執行 [bootstrap-admin.sql](../supabase/bootstrap-admin.sql)；填入已驗證的本人電郵。此程式不是公開 RPC，已有管理員時拒絕再次執行。專案擁有人保有資料庫修復權限。

## 文件下載與版本

`course-materials` 是私人 bucket。瀏覽器以當前登入憑證下載 Blob，每次重新套用 RLS。Storage 政策只允許 authenticated download/info 及管理員一般上傳；不允许列出 bucket、產生 signed URL、signed upload URL、覆寫或刪除。這需要現行 Supabase Storage 的 `storage.allow_any_operation()`；遷移會在舊版本上拒絕套用，不能以開放 SELECT 政策替代。

文件替換先上傳到新隨機路徑，再原子更新資料。舊路徑即刻失去所有課程角色的下載資格；歷史路徑不能重新綁定。原檔仍在私人儲存內，專案擁有人可按備份／保存安排處理。上傳成功但資料儲存失敗時，孤立文件沒有教材記錄，任何課程賬戶都不能下載。管理員可重試儲存或由專案擁有人日後清理。

本機初次匯入使用受信任的 service-role 憑證。第二份 migration 明確將它在本課程資料表的權限收窄為 `resources` 的讀取／新增及 `lessons` 的讀取／更新；不能透過這些資料表覆寫教材、修改賬戶或稽核記錄。稽核及文件歷史由擁有人權限的 trigger 維護，匯入器沒有私人歷史表或稽核流水號權限。Supabase 平台的 Storage／Auth 管理權限沒有被這項設定限制，這把密鑰仍然屬於高權限憑證，只能保留在本機非版本管理的設定內。

匯入順序為先上傳私人文件、再新增教材記錄；已存在的教材 id 應略過，即使本機原檔後來更改也不可自動覆蓋。課表僅在 `version=1` 且日期仍為空白時初次填入。以後的教材更新及發佈安排由管理員在門戶處理；SQL Dashboard 的專案擁有人保有可信的維修權限。

瀏覽器已下載到本機的副本無法遠端收回；已開始的下載也不能保證在權限修改的同一瞬間中止。網站應在身份改變／登出時清理前端教材快取及臨時 Blob URL，並在下載前重新查核賬戶。HTML 遊戲應下載後本機開啟，不能在網站同源頁面插入執行使用者上傳的 HTML。

## 部署時的實際檢查

1. 使用本課程專用 Supabase 專案，執行 migration，保留 Auth 電郵驗證，設定正式 GitHub Pages 網址為 Site URL／容許回跳網址，並使用 12 字元以上密碼。
2. Data API 只 expose `public`（以及平台預設 `graphql_public`）；不要 expose `portal_private`。確認 Security Advisor 沒有本專案造成的無 RLS 表格、public bucket 或暴露 secret。
3. 資料只從本機受信任匯入流程／管理員介面上傳私人 bucket；GitHub Actions 只建置前端。不要把 SQL 管理密鑰交給 GitHub Pages。
4. 用獨立測試學生／老師／管理員驗證真實服務：公開網址匿名取檔失敗、學生猜中教師路徑仍失敗、未到期資料及 metadata 不可見、到期可見、停用後原 JWT 不能繼續下載、signed URL API 被拒絕。
5. 實機以兩位管理員同時將自己降級，確認至少保留一位管理員；最後管理員單獨降級應被拒絕。瀏覽器安全驗證完成前不可稱為正式驗收。

## 自動驗證的範圍

`tests/sql/run-security.mjs` 在真實 PostgreSQL 核心（PGlite）中套用完整 migration，再用受限制角色測試 RLS、RPC、偽造 metadata、時間邊界、學生資料隔離、存取撤銷、路徑版本、稽核及版本衝突。Auth／Storage schema 由最小測試 adapter 提供；它不代替 Supabase HTTP、SMTP、真實 JWT、Storage 路由或多連線競態測試。`tests/sql/README.md` 列出測試命令及正式環境驗收方法。

## 設計依據

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)：每張暴露資料表啟用 RLS，角色查詢使用受控 private helper。
- [Database Functions](https://supabase.com/docs/guides/database/functions)：definer 函式固定空 search_path、明確 schema、撤銷預設 EXECUTE；公开 RPC 為 invoker wrapper。
- [Private storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)：私人儲存的 authenticated download 經 RLS。
- [Storage operation helpers](https://supabase.com/docs/guides/storage/schema/helper-functions)：將 authenticated download 與 list／signed URL 的 SELECT 操作分開授權。
- [Auth user data](https://supabase.com/docs/guides/auth/managing-user-data)：由 Auth trigger 建立最少權限 profile。

查閱日期：2026-09-06。
