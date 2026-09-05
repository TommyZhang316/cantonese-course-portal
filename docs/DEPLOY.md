# GitHub 與 Supabase 部署

## 本課程正式部署狀態（2026年9月6日）

網站已發布：[公益粵語課堂](https://tommyzhang316.github.io/cantonese-course-portal/)。程式庫：[cantonese-course-portal](https://github.com/TommyZhang316/cantonese-course-portal)。首次完整發布通過[GitHub Actions驗證及部署](https://github.com/TommyZhang316/cantonese-course-portal/actions/runs/33985131739)。

Supabase已建立8課並匯入52份私人材料，26份定時、23份僅教職員、3份即時。正式網站回跳網址及密碼重設網址已保存，保留電郵驗證，密碼下限12字元。首次瀏覽器匯入用的程式碼寫入權限已從後續工作流程移除。

**尚待負責人完成：第一位管理員註冊及電郵驗證，以及正式SMTP設定與收信測試。** 這些完成前不應通知全班開始註冊。部署成功不代表全班的驗證電郵已可送達。最新測試證據與限制見[VERIFICATION.md](VERIFICATION.md)。

這份部署需要GitHub儲存庫寫入權限及一個由課程負責人管理的Supabase專案。電郵地址本身不是授權憑證。以下步驟不購買方案；如果服務要求升級或付款，先由負責人決定。

## 1 準備專案

1. 在GitHub建立專門儲存庫，只提交`portal/`的程式碼。免費GitHub Pages使用公開儲存庫；程式碼可公開，所有教材仍留在私人Storage。若已有支援私人Pages的方案，可使用私人儲存庫。
2. 在Supabase建立獨立專案，使用免費方案即可先行部署。記下Project URL及publishable/legacy anon key。這兩項可用於前端。
3. 按檔名順序執行`supabase/migrations/`內的SQL。可用Supabase CLI或SQL Dashboard。若Storage版本不支援operation-aware RLS，先更新服務；不要刪除限制來繞過失敗。
4. 確認`course-materials` bucket為private。不要開public或將原教材放GitHub、Pages的`public/`或`dist/`。

## 2 帳戶與電郵

1. Supabase Auth開啟Email/Password，開啟email confirmation，最少密碼長度12。
2. 設定Site URL為正式GitHub Pages網站網址，加入同一網址的redirect allowlist。本網站密碼重設使用相同路徑及`?recovery=1`。
3. **對外招收學生前，配置並測試正式SMTP。** Supabase預設寄信服務有收件人及速率限制，不能假定它能替全班寄驗證和重設信。採用現有SMTP或經負責人同意的方案；不自動購買郵件服務。
4. 第一位管理員先從網站申請並驗證電郵。專案擁有者在SQL Dashboard執行`supabase/bootstrap-admin.sql`，只在本地把placeholder換成已驗證的管理員電郵。不要將真实電郵、密碼或金鑰提交儲存庫。
5. 後續學生、老師、管理員都由現有管理員從後臺審批。新申請永遠是待審批學生；前端不能自選管理員權限。

## 3 匯入本套材料

```sh
python scripts/prepare-materials.py
node scripts/import-materials.mjs
```

第二行只預覽匯入數量，不寫入雲端。準備腳本使用Python的lxml及PyMuPDF；可使用原材料工作區的已配置Python，或在隔離環境安裝這兩個套件。

在被git忽略的`.local/ops.env`中，由專案擁有者本地設定`SUPABASE_URL`和`SUPABASE_SERVICE_ROLE_KEY`。**service-role/secret key只能用於本地匯入，不可放入任何VITE變數、前端或GitHub Pages。**

```sh
node --env-file=.local/ops.env scripts/import-materials.mjs --apply
```

匯入前核對每個檔案SHA256；先上傳新路徑再寫入資料列。不覆寫已存在資源ID或管理員後續修改過的發布安排。更換已匯入材料請從後臺替換檔案。首次匯入會把尚未編輯的八課占位資料換成已確認課表。

預設分類：學生筆記及移除備忘稿的學生PPT於課前7天09:00發布；教師用書、原PPT、角色卡母本、試卷及答案均僅教職員。完整教材壓縮包不匯入。

## 4 啟用 GitHub Pages

在儲存庫Settings → Secrets and variables → Actions → Variables加入：

- `VITE_SUPABASE_URL`：Project URL。
- `VITE_SUPABASE_ANON_KEY`：publishable或legacy anon key。名稱相容兩種格式。

Settings → Pages的Source選GitHub Actions。工作流程會先檢查型別、日期與key邊界、資料庫權限及公開產物，通過後只部署`dist/`。缺少連線值會阻止正式部署；不會將demo網站冒充正式網站。

預設网址為`https://<GitHub帳戶>.github.io/<儲存庫名稱>/`。若使用帳戶根網站或自有域名，將workflow中的`VITE_BASE_PATH`調整為`/`並同步Auth redirect設定。

## 5 上線驗收

- 從實際學生電郵完成註冊、驗證、管理員批准及重設密碼。
- 分別登入老師、學生、管理員，核對角色差異及已載入瀏覽器在停用／降權後的行為。
- 把一項測試資源排在幾分鐘後，驗證未到時不能用直接REST或Storage網址取走，時間到後可下載。
- 改成本地錯誤時間，確保伺服器仍拒絕未到時資源。
- 試用猜測附件路徑、public URL、signed URL及Storage list，均不能取得未授權內容。
- 核對真正上傳的教師原PPT與學生版分開，student版沒有教師備忘稿。
- 同時用兩個管理員修改同一項資源，第二次存檔應提示版本衝突。最後一位管理員不能停用或降權自己。
- 用手機和鍵盤完成登入、找材料和管理表單。

本機PGlite安全測試不替代真實Auth/Storage HTTP驗收或雙連線競態測試。網站發布、材料匯入、管理員啟用與寄信驗收是不同項目，應逐項確認後才對全班開放註冊。

官方參考：[GitHub Pages工作流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Supabase Storage權限](https://supabase.com/docs/guides/storage/security/access-control)、[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)。
