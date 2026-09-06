# GitHub 與 Supabase 部署

## 本課程部署狀態（2026年9月6日）

正式入口：[公益粵語課堂](https://tommyzhang316.github.io/cantonese-course-portal/)。程式庫：[cantonese-course-portal](https://github.com/TommyZhang316/cantonese-course-portal)。原有網站已通過[首次完整發布](https://github.com/TommyZhang316/cantonese-course-portal/actions/runs/33985131739)。

Supabase已有8課及52份私人材料：26份定時、23份僅教職員、3份即時。首位管理員已完成電郵驗證並啟用。正式網站及密碼重設回跳網址已保存，首次瀏覽器匯入程式碼的寫入權限已從後續工作流程移除。

**本次批量學生帳戶新版已發布，正式測試學生的建立、改密碼及重設驗收仍待批准。** [新版部署工作流程](https://github.com/TommyZhang316/cantonese-course-portal/actions/runs/34005929110)已成功；第三份遷移及`manage-accounts`已套用，雲端公開註冊已關閉，函式已使用內部登入及即時角色驗證。

本機結果為27項單元測試、45項SQL情境、16項Edge Function測試及9次無障礙掃描。新版正式公開入口13項檢查通過、5次無障礙掃描零違規；匿名端點4項檢查通過。正式SMTP仍待專案負責人核對設定及完成收信測試，不能據此聲稱教職員重設郵件已可送達。學生帳戶建立及初始密碼重設不依賴SMTP。

最新正式環境證據及限制見[VERIFICATION.md](VERIFICATION.md)。新版前端、資料庫及帳戶函式須配套部署；只發布GitHub Pages不足以啟用批量帳戶功能。

## 1 準備專案與資料庫

1. 使用本課程專用GitHub儲存庫，只提交`portal/`程式碼。教材、名單、帳戶CSV及私人設定留在本機或私人Storage。
2. 在Supabase使用由課程負責人管理的獨立專案，記下Project URL及publishable／legacy anon key。這兩項可用於前端。
3. 按檔名順序執行以下SQL；可使用Supabase CLI或SQL Dashboard。已有前兩份遷移的網站只需套用第三份，不要重複執行已套用的DDL。
   - `202609060001_portal.sql`
   - `202609060002_trusted_import_grants.sql`
   - `202609060003_managed_accounts.sql`
4. 確認`course-materials` bucket為private；Data API不公開`portal_private`。
5. 第三份遷移需要`extensions`中的pgcrypto、Auth的有效session記錄，以及Storage的operation-aware RLS。遇到相容性錯誤應修正服務設定，保留存取限制。

第三份遷移加入拼音帳戶名稱、首次改密碼限制、學生密碼重設流程，以及以`auth.sessions`檢查登入是否仍有效。既有教職員電郵帳戶及課程材料保持。

## 2 設定Auth及首位管理員

1. 保留Email/Password登入及電郵驗證，新密碼下限12字元。
2. **在雲端Auth設定關閉允許新使用者自行註冊。** `supabase/config.toml`中的`[auth].enable_signup=false`及`[auth.email].enable_signup=false`也應保留，但本機檔案不會因前端部署而自動同步至雲端。
3. Site URL設為正式網站，redirect allowlist加入相同網站路徑及密碼重設用的`?recovery=1`。
4. 本課程首位管理員已啟用，毋須再次bootstrap。若複製網站到全新專案，由專案擁有者從受信任的Auth管理流程建立並確認負責人的電郵帳戶，再執行[bootstrap-admin.sql](../supabase/bootstrap-admin.sql)。placeholder只在本機替換為已驗證的本人電郵，不能提交真實帳戶資料。已有管理員時，bootstrap會拒絕再次執行。
5. 後續學生由管理員在Portal建立，無須學生電郵或驗證信。新帳戶直接是已啟用學生，並強制首次改密碼；不能在建立請求中指定老師或管理員角色。
6. 已有電郵教職員繼續使用原有登入。新增電郵教職員由專案負責人安排建立及驗證，再到Portal設定權限；使用拼音帳戶的教職員必須先完成首次改密碼，才能提升角色。

短姓名的初始密碼仍按帳戶名稱輸入，例如`LIWU`；12字元限制適用於使用者自行設定的新密碼。

教職員需要電郵重設時，另行核對SMTP寄件地址、登入名稱、連線資料及服務憑證，保存後以已授權的收件人測試。不要以介面的啟用開關代替實際收信驗收，也不要為了讓學生登入而開啟自行註冊。方案升級或付款由負責人決定。

## 3 部署帳戶管理Edge Function

部署`supabase/functions/manage-accounts/index.ts`為`manage-accounts`，並套用：

```toml
[functions.manage-accounts]
verify_jwt = false
```

這個設定將驗證交給函式內的流程。每個實際帳戶請求仍須通過`auth.getUser(token)`及目前管理員profile檢查；profile的RLS亦核對`auth.sessions`。匿名、學生、老師、停用或已撤銷登入的呼叫不能建立或重設帳戶。

函式從Supabase服務端環境取得專案網址、公開key及服務端管理key。管理key只留在Edge Function服務端及受信任的本機作業設定，不得放入任何VITE變數、公開儲存庫、前端或GitHub Pages。

函式只接受本網站origin的瀏覽器請求。若換成自有域名，需同步修改函式的`PORTAL_ORIGIN`、Auth回跳網址及前端部署路徑。

批量建立每次最多50位，逐項回傳`created`／`existing`／`error`。已有帳戶不會被覆寫，也不會把建立失敗轉為密碼重設。重設是獨立的管理員操作，只適用於拼音學生帳戶，並檢查版本及重設狀態。

## 4 匯入本套材料

```sh
python scripts/prepare-materials.py
node scripts/import-materials.mjs
```

第二行只預覽匯入數量，不寫入雲端。準備腳本使用Python的lxml及PyMuPDF。

在被git忽略的`.local/ops.env`中，由專案擁有者本地設定`SUPABASE_URL`及`SUPABASE_SERVICE_ROLE_KEY`，再執行：

```sh
node --env-file=.local/ops.env scripts/import-materials.mjs --apply
```

匯入前核對檔案SHA256；先上傳新路徑再寫入資料列。不覆寫已存在的資源或管理員後續修改過的發布安排。更換已匯入材料請從後臺替換檔案。

預設學生筆記及移除備忘稿的學生PPT於課前7天香港09:00發布；教師用書、原PPT、角色卡母本、試卷及答案僅教職員可見。完整教材壓縮包不匯入。本課程已有52份材料，本次帳戶更新不需重複匯入。

## 5 啟用GitHub Pages

在儲存庫Settings → Secrets and variables → Actions → Variables加入：

- `VITE_SUPABASE_URL`：Project URL。
- `VITE_SUPABASE_ANON_KEY`：publishable或legacy anon key。

Settings → Pages的Source選GitHub Actions。工作流程檢查型別、單元測試、SQL權限、帳戶函式及公開產物後，只部署`dist/`。缺少連線設定會阻止正式部署；demo資料不會包含在正式build中。

預設網址為`https://<GitHub帳戶>.github.io/<儲存庫名稱>/`。若使用帳戶根網站或自有域名，將workflow的`VITE_BASE_PATH`改為`/`，並同步前述Auth及函式設定。

## 6 新版上線驗收

1. 正式登入頁沒有申請入口，直接呼叫Auth註冊亦應被拒絕；既有電郵管理員可以登入。
2. 管理員以少量測試姓名建立帳戶，核對繁簡字、多音姓氏、同批重名、已有帳戶略過及手動修正。學生不需要收信。
3. 核對CSV只包含本批確認建立成功的帳戶；部分失敗後重試只處理未完成項目。
4. 使用短拼音帳戶及相同初始密碼登入；首次改密碼前，直接REST及Storage請求也不能取得課表或材料。完成新密碼設定後才可取得已發布材料。
5. 測試管理員重設學生密碼：舊密碼失效，重新登入仍需改密碼。直接清除首次改密碼標記、使用已撤銷session或提升尚未改密碼帳戶角色均應被拒絕。
6. 分別登入學生、老師、管理員，核對材料權限、封存及停用後的即時限制。猜測教師路徑、public URL、signed URL及Storage list不能取得未授權內容。
7. 核對定時材料在伺服器時間到期前不能取得，到期後可取得；修改瀏覽器時間不影響限制。
8. 兩位管理員修改同一項資料時，舊版本儲存應提示衝突；不能移除最後一位已啟用管理員。
9. 用手機與鍵盤完成登入、首次改密碼、材料下載及批量管理。教職員郵件另行完成實際收信測試。

本機PGlite及函式測試不替代真實Auth／Storage HTTP、SMTP或雙連線競態驗收。帳戶新版驗收完成後，可按管理員派發方式啟用全班，不需要恢復學生自行註冊。

官方參考：[GitHub Pages工作流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Supabase函式驗證](https://supabase.com/docs/guides/functions/auth)、[Supabase CLI設定](https://supabase.com/docs/guides/local-development/cli/config)、[Supabase Storage權限](https://supabase.com/docs/guides/storage/security/access-control)、[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)。
