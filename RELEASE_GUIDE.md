# Benchly v2.1 — Production Launch & Deployment Guide

## 1. Domain & Service Map

| Subdomain | Project Folder | Build Output | Purpose |
| :--- | :--- | :--- | :--- |
| **`https://benchly.live`** | `benchly/landing-web` | `landing-web/dist/` | Sunlit marketing landing page (live topic + campaigns $\rightarrow$ redirects to `app.benchly.live`) |
| **`https://app.benchly.live`** | `benchly/frontend` | `frontend/build/web/` | Flutter Web App (and Android APK/AAB) |
| **`https://admin.benchly.live`** | `benchly/admin-web` | `admin-web/dist/` | Super Admin Console (`rhrakibulhasan279@gmail.com`) — Huffman trees, telemetry, topics, campaigns, moderation |
| **`https://api.benchly.live`** | `benchly/backend` | `backend/dist/` | Node.js + Socket.IO + Redis + Gemma 4 12B AI fallback (`labpc1/25/26/31.benchly.live`) |

---

## 2. Supabase Production Checklist (`pibrfwfazbuifanezovw`)
- **Migrations `01`–`11`:** Already applied & verified (`08` Admin Role, `09` Dynamic Topics & Campaigns, `10` First-20-Free EWU Avatars, `11` RPC Trigger Bypass).
- **Supabase Auth → URL Configuration:**
  - **Site URL:** `https://app.benchly.live`
  - **Redirect URLs:** Add all of:
    - `https://app.benchly.live`
    - `https://app.benchly.live/**`
    - `https://admin.benchly.live`
    - `https://admin.benchly.live/**`

---

## 3. Production Backend Environment (`backend/.env` on VM / Docker)
Ensure these production variables are set before running `docker compose up -d --build`:
```env
NODE_ENV=production
PORT=3001
SUPABASE_URL=https://pibrfwfazbuifanezovw.supabase.co
SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
ARCHIVE_MASTER_KEY=<generate-a-strong-32+-char-random-secret>
ADMIN_SECRET=<generate-a-strong-admin-api-secret>
AI_BENCH_MODEL=gemma4:12b
AI_FALLBACK_SECONDS=25
OLLAMA_HOSTS=https://labpc1.benchly.live,https://labpc25.benchly.live,https://labpc26.benchly.live,https://labpc31.benchly.live
```

Start backend + worker + Redis on your VM:
```bash
docker compose up -d --build
```

---

## 4. Static Web Deployments (Cloudflare Pages)
Deploy the three compiled static folders (all built with production URLs baked in):
1. **`benchly.live`** $\rightarrow$ upload / connect `landing-web/dist/`
2. **`app.benchly.live`** $\rightarrow$ upload / connect `frontend/build/web/`
3. **`admin.benchly.live`** $\rightarrow$ upload / connect `admin-web/dist/`

---

## 5. Android Release APK / Play Store AAB (`com.rxxeron.benchly`)
- **Release SHA-1:** `2F:FA:C2:97:1F:4F:39:71:C4:87:FB:50:81:F2:32:83:C7:3E:1C:C9`
- **Release SHA-256:** `B9:A7:B2:6B:F4:5F:0D:24:97:58:17:6B:88:B4:FC:14:10:63:F0:E4:DE:B5:F1:43:25:35:9A:98:E8:BF:DD:76`

```powershell
cd frontend
flutter build apk --release --dart-define-from-file=.env --dart-define=SOCKET_URL=https://api.benchly.live
flutter build appbundle --release --dart-define-from-file=.env --dart-define=SOCKET_URL=https://api.benchly.live
```
