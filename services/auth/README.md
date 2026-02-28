# Auth Microservice

獨立的認證微服務，負責處理所有認證相關的功能。

### 通信方式

1. **主 API → Auth Service**: 透過 **gRPC** 獲取公鑰驗證 token
2. **Auth Service → Redis**: 儲存/讀取 JWT 公私鑰對
3. **Client → Auth Service**: 直接透過反向代理訪問 `/auth/*` 端點

## 功能

- Firebase App Check 驗證
- Cloudflare Access OIDC 認證
- JWT Token 產生與驗證
- 提供 gRPC 服務讓其他微服務驗證 token

## gRPC 服務

Auth service 在 `50051` 端口提供 gRPC 服務，定義在 `proto/auth.proto`：

```protobuf
// Request message for GetPublicKey
message GetPublicKeyRequest {
  // Optional key ID to get a specific public key
  optional string key_id = 1;
}

// Response message for GetPublicKey
message GetPublicKeyResponse {
  required string public_key = 2;
  required string key_id = 3;
}

service AuthService {
  // 獲取公鑰
  rpc GetPublicKey(GetPublicKeyRequest) returns (GetPublicKeyResponse);
}
```

### 使用方式

其他服務可以透過 gRPC 客戶端呼叫：

```typescript
import {getPublicKey, verifyToken} from './grpc/authClient';

// 獲取公鑰
const keyResult = await getPublicKey();
console.log(keyResult.publicKey);
```

## 目錄結構

```
services/auth/
├── src/
│   ├── index.ts           # 入口點 (HTTP + gRPC)
│   ├── auth_service.ts    # 認證服務邏輯
│   ├── redis_service.ts   # Redis 連接
│   ├── types.d.ts         # TypeScript 類型定義
│   ├── grpc/
│   │   ├── auth.ts        # grpc Generated 代碼
│   │   └── server.ts      # gRPC server 實作
│   ├── routes/
│   │   ├── index.ts        # /auth 路由
│   │   └── odic/
│   │       ├── index.ts        # /auth/odic 路由
│   │       ├── cocominevpn-*.json    # Firebase Credentials
│   │       └── exchange/
│   │           └── index.ts    # /auth/odic/exchange 路由
│   └── utils/
│       └── getKey.ts      # Key 管理工具
├── config/                # 配置檔案
├── keys/                  # RSA 密鑰對 (自動產生)
├── logs/                  # 日誌檔案
├── package.json
├── tsconfig.json
├── Dockerfile
└── .env.example

protos/                     # 共用 Proto 檔案
└── auth.proto
```

## 開發

```bash
# 安裝依賴
cd services/auth
yarn install

# 開發模式
yarn start

# 建置
yarn build
```

## Docker

```bash
# 使用 docker-compose (從專案根目錄)
docker-compose up -d

# 只啟動 auth service 和 redis
docker-compose up auth redis -d
```

## API Endpoints

### HTTP 端點 (Port 3001)

| Method | Path                  | 說明                                    |
|--------|-----------------------|---------------------------------------|
| GET    | `/ping`               | Ping 測試                               |
| GET    | `/auth`               | 驗證 token (需要 JWT)                     |
| GET    | `/auth/odic`          | 取得 OIDC 客戶端資訊 (需要 Firebase App Check) |
| GET    | `/auth/odic/exchange` | 交換 CF token 為 app JWT                 |

### gRPC 端點 (Port 50051)

| Method         | 說明   |
|----------------|------|
| `GetPublicKey` | 獲取公鑰 |

## 環境變數

| 變數                 | 說明                            | 預設值                    |
|--------------------|-------------------------------|------------------------|
| NODE_ENV           | 環境                            | production             |
| PORT               | HTTP 服務端口                     | 3001                   |
| GRPC_PORT          | gRPC 服務端口                     | 50051                  |
| HOST               | 監聽地址                          | 0.0.0.0                |
| LOG_LEVEL          | 日誌等級                          | info                   |
| REDIS_URL          | Redis 連接 URL                  | redis://localhost:6379 |
| ODIC_CLIENT_ID     | Cloudflare OIDC Client ID     | -                      |
| ODIC_CLIENT_SECRET | Cloudflare OIDC Client Secret | -                      |
| TZ                 | 時區                            | Asia/Hong_Kong         |

## 與主 API 整合

主 API 需要設定以下環境變數來使用 auth microservice:

```env
AUTH_GRPC_URL=auth:50051
```

主 API 會透過 gRPC 從 auth service 獲取公鑰來本地驗證 token。