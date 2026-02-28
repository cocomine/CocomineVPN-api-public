# VPN Microservice

CocomineVPN 的核心微服務，負責處理所有 VPN 相關功能，包括伺服器狀態管理、用戶訂閱、使用追蹤和雲端服務整合。

### 通信方式

1. **Client → VPN Service**: 透過反向代理訪問 `/vpn/*` 端點
2. **VPN Service → Auth Service**: 透過 **gRPC** 獲取公鑰驗證 token
3. **VPN Service → Redis**: 儲存/讀取即時狀態和快取
4. **VPN Service → MySQL**: 儲存用戶使用記錄和配置

## 功能

- VPN 伺服器狀態查詢與管理
- 伺服器啟動/停止控制（支援 Azure、Google Cloud）
- 用戶訂閱管理（Sing-box 配置）
- VPN 使用追蹤與統計
- WebSocket 即時狀態推送
- Email 和 Discord 通知服務
- 伺服器到期時間延長

## 支援的雲端服務

- **Azure**: 透過 `@azure/arm-compute` 和 `@azure/identity` 管理 VM
- **Google Cloud**: 透過 `@google-cloud/compute` 管理 VM

## 目錄結構

```
services/vpn/
├── src/
│   ├── index.ts              # 入口點 (HTTP + WebSocket)
│   ├── auth_service.ts       # JWT 驗證服務
│   ├── redis_service.ts      # Redis 連接
│   ├── sql_service.ts        # MySQL 連接
│   ├── email_service.ts      # Email 服務
│   ├── grpc/
│   │   └── auth/
│   │       ├── auth.ts       # gRPC Generated 代碼
│   │       └── client.ts     # gRPC 客戶端
│   └── vpn/
│       ├── index.ts          # /vpn 路由入口
│       ├── VM_Data.ts        # VM 資料管理
│       ├── audVerify.ts      # AUD 驗證中間件
│       ├── Notify_service.ts # 通知服務
│       ├── (id)/
│       │   ├── index.ts        # /vpn/:id 路由
│       │   ├── profile/        # VPN 配置文件
│       │   └── troubleshoot/   # 故障排除
│       ├── sub/
│       │   └── index.ts        # /vpn/sub 訂閱服務
│       ├── track/
│       │   └── index.ts        # /vpn/track 使用追蹤
│       ├── v2/
│       │   └── ws/             # WebSocket 服務
│       ├── [Cloud_Service]/    # 雲端服務整合
│       │   ├── azure_service.ts
│       │   └── google_service.ts
│       ├── [Email_notify]/     # Email 模板
│       ├── [VM_Class]/         # VM 類別定義
│       └── [VM_startup_banner]/ # 啟動橫幅生成
├── config/                    # 配置檔案
│   ├── vm_data.json          # VM 資料配置
│   ├── singbox-cert.json     # Sing-box 證書配置
│   └── userCert.json         # 用戶證書配置
├── logs/                      # 日誌檔案
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example
```

## 開發

```bash
# 安裝依賴
cd services/vpn
yarn install

# 開發模式
yarn start

# 建置
yarn build

# 執行測試
yarn test

# 生成 gRPC 代碼
yarn proto:gen
```

## Docker

```bash
# 使用 docker-compose (從專案根目錄)
docker-compose up -d

# 只啟動 vpn service 和相關依賴
docker-compose up vpn redis auth -d
```

## API Endpoints

### HTTP 端點 (Port 8088)

| Method | Path                     | 說明               | 認證 |
|--------|--------------------------|------------------|----|
| GET    | `/ping`                  | Ping 測試          | 否  |
| GET    | `/vpn`                   | 獲取所有 VPN 伺服器狀態   | 是  |
| GET    | `/vpn/:id`               | 獲取單一伺服器狀態        | 是  |
| PUT    | `/vpn/:id`               | 啟動/停止伺服器         | 是  |
| PATCH  | `/vpn/:id`               | 延長伺服器到期時間        | 是  |
| GET    | `/vpn/:id/profile/:type` | 獲取 VPN 配置文件      | 是  |
| POST   | `/vpn/track`             | 提交 VPN 使用追蹤資料    | 是  |
| GET    | `/vpn/sub`               | 獲取 Sing-box 訂閱配置 | 是  |

### WebSocket 端點

| Path                | 說明                | 認證方式      |
|---------------------|-------------------|-----------|
| `/vpn/v2/ws`        | 即時狀態推送            | Ticket 驗證 |
| `/vpn/v2/ws/ticket` | 獲取 WebSocket 連接票據 | JWT 驗證    |

## 環境變數

| 變數                  | 說明                  | 預設值            |
|---------------------|---------------------|----------------|
| NODE_ENV            | 環境                  | production     |
| PORT                | HTTP 服務端口           | 3000           |
| HOST                | 監聽地址                | 0.0.0.0        |
| LOG_LEVEL           | 日誌等級                | info           |
| TZ                  | 時區                  | Asia/Hong_Kong |
| AUTH_GRPC_URL       | Auth 微服務 gRPC URL   | -              |
| SQL_DATABASE_URL    | MySQL 連接 URL        | -              |
| AZURE_CLIENT_ID     | Azure 客戶端 ID        | -              |
| AZURE_CLIENT_SECRET | Azure 客戶端密鑰         | -              |
| AZURE_TENANT_ID     | Azure 租戶 ID         | -              |
| SUBSCRIPTION_ID     | Azure 訂閱 ID         | -              |
| DISCORD_WEBHOOK_URL | Discord Webhook URL | -              |
| GMAIL_CLIENT_ID     | Gmail API 客戶端 ID    | -              |
| GMAIL_CLIENT_SECRET | Gmail API 客戶端密鑰     | -              |
| GMAIL_REFRESH_TOKEN | Gmail API 刷新 Token  | -              |

## 與 Auth Microservice 整合

VPN 微服務透過 gRPC 從 Auth 微服務獲取公鑰來本地驗證 JWT token：

```typescript
import {getPublicKeyGrpc} from './grpc/auth/client';

// 獲取公鑰用於 JWT 驗證
const publicKey = await getPublicKeyGrpc(keyId);
```

## 認證流程

1. 客戶端請求 `/vpn/*` 端點時需攜帶 JWT token
2. VPN 微服務透過 gRPC 從 Auth 微服務獲取公鑰
3. 使用公鑰在本地驗證 JWT token
4. 驗證通過後繼續處理請求

## WebSocket 連接流程

1. 客戶端先呼叫 `/vpn/v2/ws/ticket` 獲取連接票據（需 JWT 認證）
2. 使用票據連接 WebSocket `/vpn/v2/ws?ticket=xxx`
3. 連接成功後會收到即時的 VPN 伺服器狀態更新
