# 公益粵語課堂 Portal

本網站提供學生、老師、管理員三種帳戶，管理課程材料、每課日期和定時發布。GitHub Pages承載前端；Supabase承載登入、資料庫及私人檔案。網站不使用OpenAI的網域。

正式入口：[公益粵語課堂](https://tommyzhang316.github.io/cantonese-course-portal/)。師生操作見[入口使用指南](docs/USAGE.md)。首次對外啟用前，管理員須確認驗證郵件可送達及帳戶審批正常，見[部署驗收](docs/DEPLOY.md)。

## 已實作

- 電郵與密碼登入、申請帳戶、電郵驗證、忘記／重設密碼。
- 學生預設等待批准。已批准学生只會收到已開放資源的記錄及檔案。
- 已批准老師立即閱讀全部未封存資料；管理員管理檔案、權限、課程日期與操作記錄。
- 資源可設「僅教職員」「定時發布」「立即發布」，並可封存／恢復。預設每課前7天香港09:00發布。
- 私人Storage每次下載執行RLS。沒有公開附件URL，不可建立免登入分享連結。
- 每次檔案替換使用新路徑，管理變更保留記錄；版本衝突不會悄悄覆寫另一人的修改。
- 亮／暗主題、手機版、鍵盤操作、表單標籤及完整載入／空白／錯誤狀態。

## 本機執行

使用Node.js 24。正式模式需要Supabase連線：

```sh
npm ci
# 將 .env.example 複製為 .env.local，填入公開URL及publishable/anon key
npm run dev
```

本機功能預覽不使用真實帳戶或材料：

```sh
npm run dev:demo
# 打開 http://127.0.0.1:5173/?demo=1
```

示範時間固定為香港2026年10月2日19:00；角色切換只存在demo模式。正式build會移除示範帳戶及資料，不能用網址參數開啟。

```sh
npm run typecheck
npm test
node tests/sql/run-security.mjs
npm run build
node scripts/assert-public-build.mjs
```

## 部署及教材

部署步驟見 [DEPLOY.md](docs/DEPLOY.md)，後臺使用見 [ADMIN.md](docs/ADMIN.md)，權限設計及測試邊界見 [security.md](docs/security.md)。

教材準備及分類見 [materials.md](docs/materials.md)。`private-materials/`、`.local/`及`.env*`均不應提交GitHub。請只把本`portal/`目錄作為網站儲存庫；不要把上層整個教材文件夾公開。

首頁插畫為本課程新生成的裝飾插畫，並非實際課堂照片。現有課程名稱與深綠識別保持。
