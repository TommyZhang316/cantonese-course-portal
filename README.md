# 公益粵語課堂 Portal

本網站提供學生、老師、管理員三種帳戶，管理課程材料、每課日期和定時發布。GitHub Pages承載前端；Supabase承載登入、資料庫、私人檔案及帳戶管理服務。網站不使用OpenAI網域。

正式入口：[公益粵語課堂](https://tommyzhang316.github.io/cantonese-course-portal/)。師生操作見[入口使用指南](docs/USAGE.md)，後臺使用見[管理指南](docs/ADMIN.md)。

2026年9月6日：「管理員批量建立學生帳戶」新版已發布，8課及52份私人材料保持，首位管理員已完成驗證及啟用。資料庫及帳戶服務已部署，正式公開入口檢查通過；正式測試學生的建立、改密碼及重設驗收仍待批准。教職員郵件服務仍待核對；學生帳戶流程不依賴寄信。進度與部署步驟見[DEPLOY.md](docs/DEPLOY.md)。

## 已實作

- 管理員貼上中文姓名或匯入CSV，每批最多50位，先核對繁簡姓名及可修改的全拼音大寫帳戶名稱。
- 同批重名加02、03；已有帳戶略過；失敗項目可單獨重試，不覆寫原有帳戶或密碼。
- 新學生帳戶直接啟用，無須電郵或自行申請。初始密碼與帳戶名稱相同；首次登入必須設定至少12字元的新密碼，才可取得材料。
- 管理員下載本批確認建立成功的帳戶CSV，逐一派發。可重設拼音學生帳戶的初始密碼；網站不自動寄送帳戶表。
- 拼音帳戶名稱及既有教職員電郵均可登入；電郵帳戶保留忘記／重設密碼流程。
- 已啟用學生只收到已開放資源的記錄及檔案；老師立即閱讀全部未封存資料；管理員管理檔案、權限、課程日期與操作記錄。
- 資源可設「僅教職員」「定時發布」「立即發布」，並可封存／恢復。預設每課前7天香港09:00發布。
- 私人Storage每次下載執行RLS，帳戶及有效登入狀態由伺服器檢查。每次檔案替換使用新路徑，版本衝突會提示重新核對。
- 亮／暗主題、手機版、鍵盤操作、表單標籤及載入／空白／錯誤狀態。

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
npm run test:security
npm run test:accounts
npm run build
npm run check:public
```

本次本機驗證包括27項單元測試、45項SQL情境、16項帳戶Edge Function測試及9次無障礙掃描。它們不替代正式Auth、Storage、帳戶建立及SMTP的實際驗收，詳細限制見[VERIFICATION.md](docs/VERIFICATION.md)。

## 部署及教材

新版需要依序套用三份migration、部署`manage-accounts` Edge Function、在雲端關閉自行註冊，再發布前端。僅更新GitHub Pages不會自動套用後端設定。步驟見[DEPLOY.md](docs/DEPLOY.md)，權限設計見[security.md](docs/security.md)。

教材準備及分類見[materials.md](docs/materials.md)。`private-materials/`、`.local/`及`.env*`不應提交GitHub；公開設定範本`.env.example`除外。請只把本`portal/`目錄作為網站儲存庫，不要把上層教材文件夾公開。

首頁插畫為本課程新生成的裝飾插畫，並非實際課堂照片。現有課程名稱與深綠識別保持。
