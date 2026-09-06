# 權限及資料保護

GitHub Pages提供公開前端；Supabase伺服器驗證登入、角色、教材清單及文件下載。公開儲存庫、Pages及瀏覽器程式碼不存放教材、試卷答案、帳戶名單、派發CSV或管理金鑰。前端只接收Supabase專案網址及publishable／anon key。

## 權限矩陣

| 身份 | 帳戶狀態 | 課表 | 可讀教材 | 管理設定 |
| --- | --- | --- | --- | --- |
| 未登入或登入已撤銷 | 無 | 無 | 無 | 無 |
| 舊有待核准／停用 | 自己的狀態 | 無 | 無 | 無 |
| 尚未改初始密碼的學生 | 自己的狀態 | 無 | 無 | 只可設定自己的新密碼 |
| 已啟用且完成首次改密碼的學生 | 自己的狀態 | 可見 | 即時公開或已到發布時間、未封存的資料 | 無 |
| 已啟用老師 | 自己的狀態 | 可見 | 所有未封存資料，包括教師資料及未到期學生資料 | 無 |
| 已啟用管理員 | 所有帳戶 | 可見 | 全部資料，包括已封存資料 | 學生帳戶、角色、啟用／停用、課表、教材、發布時間、封存及恢復 |

「永不向學生公開」及首次改密碼限制均由資料庫RLS執行。直接呼叫API、猜文件路徑、改瀏覽器時間或繞過選單，也不能取得未授權的教材記錄或檔案。定時發布以伺服器每次請求的時間判斷，預設為上課香港日期往前七日的上午09:00。

## 管理員建立帳戶

學生不自行申請。雲端Auth須關閉新使用者自行註冊；本機`supabase/config.toml`同時保留兩項`enable_signup=false`。保留電郵驗證及原有教職員電郵登入。

管理員在前端預覽姓名轉換結果，採普通話全拼音大寫、無空格、ü寫成V；姓名中的多音字由管理員核對。每批最多50位，同批重名加02、03，已有帳戶略過。預覽修正後交給`manage-accounts` Edge Function建立學生帳戶。

函式使用服務端Auth Admin API設定受信任的`app_metadata`。正式Auth先插入使用者、後寫入此metadata，因此不能只依賴INSERT trigger宣稱帳戶已完成。Auth回應後，Edge呼叫僅服務端可用的`service_finalize_managed_account`，核對精確登入別名、已確認身份、可信metadata及原建立管理員，再原子完成`student / approved / must_change_password=true`的profile。使用者可修改的`user_metadata`不能指定角色、啟用或免改密碼。[Auth建立順序](https://github.com/supabase/auth/blob/master/internal/api/admin.go)

finalizer只可補完未修改的初始待處理學生；既有角色、停用狀態、版本、改密碼狀態及Auth密碼均不會被重複建立覆寫。只有可信服務端可呼叫，瀏覽器的學生、老師及管理員均沒有此RPC執行權。未帶受信任管理資料的舊式建立流程仍只產生待核准學生。

Supabase Auth內部使用固定登入別名，並非學生電郵。建立時不寄送驗證信，學生亦無須提供信箱。學生在Portal只需輸入拼音帳戶名稱；帳戶名稱建立後固定，不可自行替換登入別名。

函式逐項回傳建立成功、已存在或失敗。遇到並行重名時，唯一值限制決定建立結果；函式不覆寫原帳戶，也不把失敗轉為密碼重設。前端只匯出本批確認建立成功的帳戶，CSV使用UTF-8 BOM並處理試算表公式字元。名單及結果只留在目前頁面狀態，不寫入localStorage；派發表由管理員下載後逐一交給學生，網站不自動寄信或外傳。

## 首次密碼及重設

依課程安排，學生看見及輸入的初始密碼與帳戶名稱相同。短姓名仍可使用；底層的公開轉換只用來相容Auth的密碼長度下限，沒有把可預測的初始密碼變成秘密或增強其強度。

使用初始密碼的帳戶必須先設定至少6字元、與帳戶名稱不同的新密碼。`complete_initial_password_change`不只依賴前端按鈕，還核對Auth實際密碼已離開初始值，才清除首次改密碼標記。管理員可在當事人首次登入前配置老師或管理員角色，但不會因此清除密碼標記。尚未完成時，任何角色的課表、教材記錄、Storage下載及管理功能均被拒絕；這類管理員也不計入必須保留的有效管理員人數。

管理員的重設功能只適用於拼音學生帳戶，先檢查管理權限及資料版本，鎖定重設狀態並恢復首次改密碼限制，再透過Auth Admin API修改密碼。完成後學生仍須改密碼；失敗亦不會自動解鎖教材。並行或過期重設由資料庫中的重設記錄協調。教職員及管理員不使用這個學生重設按鈕；電郵帳戶保留電郵重設流程。

## 登入與管理權限

`manage-accounts`部署設定為`verify_jwt=false`，函式內仍對每個實際帳戶請求執行`auth.getUser(token)`及目前profile檢查。資料庫RLS另外核對`auth.sessions`仍存在且未到期；只持有已撤銷登入的JWT，不能繼續讀取profile、教材或呼叫管理操作。批量建立每一行重新檢查管理員狀態。

角色從資料庫即時讀取，不依賴JWT中可能過時的角色聲明。停用或撤銷老師權限後，下一次教材請求受新權限約束。

管理員更改採版本檢查，兩人同時修改相同資料時，舊版本會失敗。資料庫用交易鎖協調角色變更，禁止移除最後一位已啟用管理員。網站沒有永久刪除教材或帳戶的按鈕；帳戶、課表及教材變更保留管理員可看的操作記錄。

首位管理員由專案擁有人從受信任流程核對電郵，並執行[bootstrap-admin.sql](../supabase/bootstrap-admin.sql)。這不是公開RPC，已有管理員時拒絕重跑。本課程首位管理員已完成驗證及啟用；公開程式不記錄其電郵或憑證。

## 文件下載與版本

`course-materials`為私人bucket。瀏覽器用當前登入憑證下載Blob，每次重新套用RLS。Storage政策只允許經授權的download／info及管理員一般上傳；不允許列出bucket、產生signed URL或signed upload URL、覆寫或刪除。這依賴`storage.allow_any_operation()`分辨操作，不能改為全面開放SELECT。

文件替換先上傳新隨機路徑，再更新資料記錄。舊路徑失去課程角色的下載資格，歷史路徑不能重新綁定。原檔仍在私人儲存內，專案擁有人可按備份安排處理。上傳成功但資料儲存失敗時，沒有教材記錄的孤立文件也不能由網站帳戶下載。

本機匯入使用受信任的服務端憑證。第二份migration將它在課程資料表的直接權限限制為`resources`讀取／新增及`lessons`讀取／更新；不能藉此直接改帳戶或操作記錄。第三、第四份migration分別另授予完成帳戶重設及完成可信帳戶建立的窄用途RPC。Supabase平台的Storage／Auth管理權限仍屬高權限，管理key只可留在受信任本機及Edge Function服務端，不能交給前端。

匯入先上傳私人文件、再新增教材記錄；已有教材ID略過。課表僅在初次占位狀態填入，以後的教材及發布安排由管理員在入口處理。

已下載的本機副本無法遠端收回；已開始的下載亦不能保證在權限修改的同一瞬間中止。網站在身份改變或登出時清理前端教材狀態，下載前再查核帳戶。HTML遊戲下載後本機開啟，不能將使用者上傳HTML插入Portal同源頁面執行。

## 部署及驗證範圍

新版須套用第三、第四份migration、部署配套帳戶Edge Function、核對雲端關閉自行註冊並發布前端。詳細順序及正式環境驗收項目見[DEPLOY.md](DEPLOY.md)。

本次本機驗證包括27項單元測試、49項SQL情境、18項帳戶函式測試及9次無障礙掃描。SQL測試使用PGlite的PostgreSQL核心及最小Auth／Storage adapter，並重現正式Auth的插入後metadata更新順序。2026年9月6日另已完成兩個合成學生的正式建立、首次改密碼、重名預覽、管理員重設、舊session撤銷及清理，共50項檢查通過。真實雙連線競態及SMTP重設郵件收信仍未驗證；詳見[VERIFICATION.md](VERIFICATION.md)。

## 設計依據

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)：資料表以RLS限制存取。
- [Database Functions](https://supabase.com/docs/guides/database/functions)：權限函式使用固定search_path及明確授權。
- [Private storage buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)：私人儲存的authenticated download經RLS。
- [Storage operation helpers](https://supabase.com/docs/guides/storage/schema/helper-functions)：分辨download、list及signed URL。
- [Auth user data](https://supabase.com/docs/guides/auth/managing-user-data)：透過Auth資料及trigger管理profile。
- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth)：函式自行驗證時，仍須核對呼叫者身份及權限。
- [pinyin-pro姓氏模式](https://pinyin-pro.cn/use/pinyin.html)、[繁體字典](https://pinyin-pro.cn/use/traditional.html)：產生可由管理員修正的姓名拼音。

查閱日期：2026-09-06。
