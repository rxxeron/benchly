<p align="center">
  <img src="https://raw.githubusercontent.com/rxxeron/benchly/main/frontend/web/icons/Icon-512.png" alt="Benchly Logo" width="120" height="120" onerror="this.style.display='none'"/>
</p>

<h1 align="center">🪑 Benchly</h1>

<p align="center">
  <strong>The Anonymous, Privacy-First Campus Adda for East West University (EWU) Students</strong>
</p>

<p align="center">
  <a href="https://benchly.live"><img src="https://img.shields.io/badge/Web_App-benchly.live-10B981?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Live App" /></a>
  <a href="https://flutter.dev"><img src="https://img.shields.io/badge/Flutter-3.x-02569B?style=for-the-badge&logo=flutter&logoColor=white" alt="Flutter" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" /></a>
  <a href="https://socket.io"><img src="https://img.shields.io/badge/Socket.io-4.7-010101?style=for-the-badge&logo=socket.io&logoColor=white" alt="Socket.io" /></a>
  <a href="https://redis.io"><img src="https://img.shields.io/badge/Redis-In--Memory-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis" /></a>
  <a href="https://supabase.com"><img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" /></a>
</p>

---

## 📌 Overview

**Benchly** (`com.rxxeron/benchly`) is an ephemeral, time-boxed (15-minute) 1-on-1 matchmaking platform built specifically for East West University students in Aftabnagar, Dhaka.

It revives the traditional university "bench adda" experience in digital form while preserving strict privacy and student safety. Students connect anonymously with batchmates or cross-department peers, engage in candid conversations with campus icebreakers, and voluntarily reveal social handles only if both parties agree to a mutual handshake.

---

## ✨ Key Features & Architectural Highlights

### 1. 🛡️ Zero-PII Onboarding & Campus Verification
- **Official Domain Only:** Only verified `@std.ewu.edu.bd` institutional emails are permitted.
- **Roll Number Redaction:** Student IDs are irreversibly parsed into department and batch badges (e.g. `2021-1-60-001` becomes **`CSE '21`**). No student names or roll numbers are ever stored in profile tables or broadcasted across the wire.
- **PII Shield:** Automated regex shielding blocks phone numbers, social media links, and email addresses from being shared during an active adda.

### 2. ⏳ 15-Day Nickname Rotation with Audit Integrity
- **15-Day Lifespan:** To prevent identity clustering and stalking, aliases automatically expire and rotate every 15 days.
- **Student Choice:** Students can roll their own new alias or let the server auto-assign one from the EWU campus pseudonym generator.
- **Accountability Trail:** An immutable audit table (`public.alias_history`) preserves timestamped records of former aliases linked to student IDs, enabling university administrators to investigate abuse and harassment reports safely.

### 3. ⚡ High-Performance In-Memory Redis + Single-Row Archiving
- **Zero Live DB Thrashing:** Active chat messages are **never** written row-by-row to PostgreSQL. All real-time messaging stays 100% in-memory in Redis (`room_messages:${roomId}`).
- **Single-Row Persistence:** When an adda concludes (or reaches 30 minutes / 100 messages), the complete conversation transcript is archived as **one single row** (`public.room_conversations`) containing the JSONB messages payload.
- **Background Sweeper:** An asynchronous worker daemon periodically sweeps abandoned or stale rooms and flushes them directly to Supabase.

### 4. 🔗 Short URL Bench Invites (`benchly.live/b/:code`)
- **Direct Social Invites:** Students can generate an ephemeral 6-character short link (`https://benchly.live/b/:code`, 30-minute Redis TTL) and share it on WhatsApp, Messenger, or Instagram.
- **Instant Private Match:** When a friend clicks the short URL, they are deep-linked straight to the inviter's private bench for an initial 15-minute adda.
- **Referral Attribution & Rewards:** Tracks who brings how many students to Benchly (`public.referrals`). Inviters receive **+5 Stones** per friend brought.

### 5. 📊 Personal Student Engagement Analytics ("Adda Stats")
- Dedicated student-centric dashboard replacing complex administrative metrics:
  - **People Talked To:** Unique bench partners encountered.
  - **Total Adda Time:** Formatted minutes/hours spent actively conversing.
  - **Sent vs. Received Balance:** Visual conversation dynamic gauge ensuring balanced dialogues.
  - **Avg Messages per Chat:** Depth indicator for bench interactions.
  - **Friends Brought to Benchly:** Real-time referral count and Stones earned.
  - **Timeframe Filtering:** Switch seamlessly between **Daily (24h)**, **Weekly (7d)**, and **Monthly (30d)** insights.

### 6. 🤝 Mutual Social Handshake & Time Extenders
- **15-Minute Countdown:** Adds an organic, fast-paced urgency to chats.
- **Warning Alarm:** Audio/visual alert triggered at 5 minutes remaining (`chat_ending_soon`).
- **Mutual Handshake:** Both students must explicitly click and agree to reveal their identities before PII shields are lifted.
- **Matchmaking Timeout:** 35-second radar queue gracefully times out with peak campus adda hours guidance if no peers are currently online.

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Client ["Client Layer (Flutter Web & Mobile)"]
        UI[Home Screen & Radar Queue]
        InviteModal[Short Link Invite Sheet]
        ChatScreen[15-min Chat Room Screen]
        StatsScreen[Personal Adda Stats Screen]
    end

    subgraph Gateway ["Reverse Proxy & Gateway"]
        Caddy[Caddy v2 (HTTPS & WSS)]
        Express[Express Gateway (/b/:code & REST API)]
        SocketServer[Socket.io Real-Time Server]
    end

    subgraph Memory ["In-Memory State (Redis)"]
        Queue[Matchmaking FIFO Queues]
        Invites[bench_invite:code (30m TTL)]
        LiveMessages[room_messages:roomId]
        Cooldowns[cooldown:userId]
    end

    subgraph Persistence ["Persistent Storage (Supabase PostgreSQL)"]
        Users[(public.users)]
        Conversations[(public.room_conversations)]
        Sessions[(public.chat_sessions)]
        AliasHistory[(public.alias_history)]
        Referrals[(public.referrals)]
    end

    UI -->|WSS| SocketServer
    InviteModal -->|create_invite_bench| SocketServer
    ChatScreen -->|send_message| SocketServer
    StatsScreen -->|RPC: get_student_analytics| Persistence

    Caddy --> Express
    Caddy --> SocketServer

    SocketServer --> Queue
    SocketServer --> Invites
    SocketServer --> LiveMessages
    SocketServer --> Cooldowns

    SocketServer -->|Save Single Row on End| Conversations
    SocketServer -->|Session Metrics| Sessions
    SocketServer -->|RPC: record_referral_join| Referrals
    SocketServer -->|RPC: rotate_user_alias| AliasHistory
```

---

## 📁 Repository Structure

```
Backbench/
├── backend/
│   ├── src/
│   │   ├── server.ts         # Main Socket.io gateway, queue manager & short URL router
│   │   ├── worker.ts         # 30-minute background room sweeper & archiver
│   │   ├── supabase.ts       # Supabase service role client
│   │   ├── types.ts          # TypeScript interfaces & socket contracts
│   │   └── utils/            # Icebreaker pool & alias generator
│   ├── dist/                 # Compiled JavaScript
│   ├── package.json          # Node.js dependencies & scripts
│   └── tsconfig.json         # TypeScript compiler configuration
│
├── database/
│   ├── 01_schema.sql                     # Base tables: users, stones, feedback, blocks
│   ├── 02_analytics_and_engagement.sql   # Campus pulse metrics, streaks & retention
│   ├── 03_alias_and_student_analytics.sql# 15-day alias rotation & student adda stats RPC
│   └── 04_referrals_and_bench_invites.sql# Short URLs, referral attribution & rewards
│
└── frontend/
    ├── lib/
    │   ├── config/
    │   │   └── app_config.dart           # Production URLs, Supabase keys & constants
    │   ├── screens/
    │   │   ├── auth_screen.dart          # EWU student OTP authentication
    │   │   ├── main_navigation_screen.dart# Tab router (Benches, Adda Stats, Profile)
    │   │   ├── home_tab_screen.dart      # Radar matchmaking & short URL invite launcher
    │   │   ├── chat_room_screen.dart     # 15-min chat, PII filter, handshake & extender
    │   │   ├── student_analytics_screen.dart # Daily/Weekly/Monthly personal metrics
    │   │   └── settings_screen.dart      # Alias history sheet & account preferences
    │   ├── widgets/
    │   │   └── mobile_container.dart     # Responsive mobile layout boundary
    │   └── main.dart                     # App entry point & initialization
    └── pubspec.yaml                      # Flutter dependencies
```

---

## 🗄️ Database Migrations

Apply the migrations in numerical order on your Supabase PostgreSQL instance:

| Migration File | Description | Key Tables / Procedures |
| :--- | :--- | :--- |
| **`01_schema.sql`** | Core schema, user profiles, authentication triggers. | `public.users`, `public.reports` |
| **`02_analytics_and_engagement.sql`** | Campus pulse aggregates and daily check-ins. | `public.analytics_events` |
| **`03_alias_and_student_analytics.sql`** | Single-row chat archives, 15-day alias audit trail, personal student engagement stats. | `public.alias_history`, `public.room_conversations`, `public.chat_sessions`, `get_student_analytics()` |
| **`04_referrals_and_bench_invites.sql`** | Short code invites, referral attribution, stone rewards. | `public.referrals`, `record_referral_join()` |

---

## 🛠️ Getting Started (Local Development)

### Prerequisites
- [Node.js](https://nodejs.org/) v18.x or later
- [Flutter SDK](https://docs.flutter.dev/) v3.13.x or later
- [Redis](https://redis.io/) (local instance or [Upstash Redis](https://upstash.com/))
- [Supabase](https://supabase.com/) project with GoTrue Auth enabled

---

### 1. Backend Setup

```bash
# 1. Navigate to backend
cd backend

# 2. Install dependencies
npm install

# 3. Create .env file
cat <<EOF > .env
PORT=5000
REDIS_URL=redis://localhost:6379
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-supabase-jwt-secret
CLIENT_URL=http://localhost:3000
EOF

# 4. Start development server & worker
npm run dev:server
npm run dev:worker
```

---

### 2. Frontend Setup

```bash
# 1. Navigate to frontend
cd frontend

# 2. Install Flutter packages
flutter pub get

# 3. Run Flutter Web on port 3000
flutter run -d chrome --web-port=3000 --dart-define=SOCKET_URL=http://localhost:5000
```

---

## 🚀 Production Deployment

### Azure VM Architecture
- **Host:** Ubuntu Linux (`20.198.226.66`)
- **Process Manager:** PM2 managing `benchly-server` and `benchly-worker`
- **Reverse Proxy:** Caddy v2 providing automatic TLS certificates and WebSocket multiplexing

```bash
# Build backend
cd backend
npm run build
pm2 restart all

# Build Flutter Web client
cd frontend
flutter build web --release --dart-define=SOCKET_URL=https://api.benchly.live

# Copy web bundle to static webroot
sudo cp -r build/web/* /var/www/benchly/
```

### Caddyfile Configuration (`/etc/caddy/Caddyfile`)
```caddy
benchly.live {
    root * /var/www/benchly
    file_server
    try_files {path} /index.html

    # Short URL Bench Invite Redirects
    handle /b/* {
        reverse_proxy 127.0.0.1:5000
    }
}

api.benchly.live {
    reverse_proxy 127.0.0.1:5000 {
        header_up Host {upstream_hostport}
        header_up X-Real-IP {remote_host}
    }
}
```

---

## 🔒 Safety, Anonymity & Code of Conduct

1. **Zero Roll Numbers:** Benchly never displays or stores raw East West University roll numbers or real student names.
2. **Strict 15-Day Rotation:** Nicknames expire after 15 days to safeguard student privacy.
3. **Audit History for Harassment:** An internal, non-public audit trail (`public.alias_history`) is maintained strictly to respond to verified harassment complaints submitted to campus authorities.
4. **PII Shield:** Sharing phone numbers or personal social media handles is blocked unless both students willingly accept a mutual handshake.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE). Built with ❤️ for the students of **East West University**.
