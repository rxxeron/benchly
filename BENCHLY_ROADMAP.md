# Benchly — Master Status, Architecture & Future Improvements Roadmap
> **The Anonymous Real-Time Matchmaking Platform for East West University (EWU) Students**  
> *"No names. No profiles. Just campus talk."*  
> **Repository:** [https://github.com/rxxeron/benchly](https://github.com/rxxeron/benchly)  
> **Production Server:** Azure Linux VM (`20.198.226.66:3001`)  
> **Last Updated:** October 2026

---

## 1. What is Live, Tested & Shipped Today (v1.1)

### 🟢 1.1 Zero-Cost Cloud Infrastructure
* **Azure VM (`Standard_B1s`):** Running Ubuntu 24.04 LTS on the 750-hour free tier (\$0.00/month).
* **2GB Swapfile (`/swapfile`):** Active on the host, preventing out-of-memory crashes on the 1.5GB RAM VM.
* **Self-Hosted Redis Server:** Installed directly on the Azure VM, bound to `127.0.0.1:6379`, consuming just **~9 MB of RAM** with **<0.1ms loopback latency** and **unlimited commands/day** (avoiding Azure Redis costs of \$16–\$35/mo and Upstash 10k/day rate limits).
* **PM2 Process Manager:** Managing `benchly-server` (PID 0) and `benchly-worker` (PID 1) with auto-restart on boot.

### 🟢 1.2 Zero-PII EWU Student Intelligence
* **Student Email Parser:** Decodes `YYYY-S-DD-NNN@std.ewubd.edu` into department (`CSE`, `BBA`, `EEE`, `Pharmacy`, `Economics`, `Law`, `English`, `Civil`) and intake cohort (`2022`, `2023`, `2025`).
* **Strict Privacy Rule:** Individual student roll numbers (`NNN`) are **never** stored in public profiles or analytics.
* **Badges:** Shows anonymous campus badges (e.g., `Economics '25`, `CSE '23`).

### 🟢 1.3 Safety & 90-Day Investigation Window
* **90-Day Message Retention:** Raw chat messages are stored for 90 days strictly to investigate misconduct or harassment complaints, with an automated rolling cleanup function (`cleanup_old_ephemeral_messages()`).
* **Real-time PII Shielding:** Automatically redacts Bangladeshi phone numbers (`017...`, `018...`, `019...`), student emails, external links, and social platform mentions (FB, IG, Telegram, WhatsApp) with an in-chat safety indicator.

### 🟢 1.4 Real-Time Matchmaking & Campus Adda Sparks
* **Bidirectional Normalized Matchmaking:** Normalizes preferences (`anyone`, `any`, `male`, `female`, `guys`, `girls`) across Redis priority queues for sub-50ms matching.
* **Server-Side Dual Socket Join:** When a room is created, both creator and joiner sockets are joined to `match.roomId` instantly on the server.
* **EWU Adda Sparks (Icebreakers):** Curated database of 22+ local campus questions (Canteen food, Aftabnagar street food, brutal midterms, ground floor adda) delivered via a one-tap in-chat prompt card.
* **Mutual Handshake 🤝:** Allows students to mutually agree to break anonymity and exchange social handles with zero pressure.
* **Dynamic Timer:** 15-minute countdown clock that smoothly shifts from Green $\rightarrow$ Amber (< 2 min) $\rightarrow$ Pulsing Red (< 30s) with a mutual +15m extension voting system.

### 🟢 1.5 Midnight Campus Neon UI & Built-in Analytics Dashboard
* **Aesthetic:** Deep Obsidian (`#080A0F`), Slate Navy (`#121622`), Electric Emerald (`#10B981`), and Cyber Indigo (`#6366F1`).
* **Home Screen:** Live Campus Pulse ticker (`🟢 EWU Adda Live • Students chatting right now`), animated radar matchmaking rings, and profile chips.
* **Admin Analytics Dashboard (`admin_analytics_screen.dart`):** Built directly into the app (via top-right Insights icon or Settings), featuring:
  - Real-time online student counts and queue sizes.
  - Total matches, message counts, and safety shield blocks.
  - Department distribution progress bars.
  - 24-hour Adda peak hours chart (Dhaka Time).
  - VM host memory footprint telemetry.

---

## 2. Future Improvements Roadmap (To Build Next)

### 🚀 Phase 2: Campus Virality & Social Loops
- [ ] **BenchLipi (Anonymous Campus Micro-Feed):**
  - Public anonymous confession and shoutout board exclusive to EWU students.
  - Topic tags: `#CafeteriaAdda`, `#MidtermStress`, `#CrushAlert`, `#CourseReview`, `#LostAndFound`.
  - Heart reactions, upvotes, and threaded anonymous replies.
- [ ] **Personalized Letterbox Link (`benchly.app/@alias`):**
  - Allow students to generate a shareable web link to put on their Instagram/Facebook story for receiving anonymous letters from fellow EWU students.
- [ ] **Midterm & Finals Survival Mode:**
  - Specialized queue during exam weeks: "Study Buddy Cram Match" pairing students by department for 25-minute Pomodoro study sprints.
- [ ] **Midnight Adda Rush Hour (10:00 PM – 2:00 AM):**
  - Boosted hours with accelerated matching, neon glow particle effects, and night owl topics.

### 💎 Phase 3: The Campus Stones Economy & Gamification
- [ ] **Campus Stones 💎 Ledger:**
  - **Earn:** Daily login (+2 💎), 5-chat milestone (+5 💎), 7-day streak (+10 💎), rating a chat positive (+1 💎).
  - **Spend:** Mid-chat Department reveal hint (-2 💎), Priority Queue pass (-3 💎), Custom Anonymous Pseudonym Pass (-5 💎).
  - New `transactions` table in Supabase auditing all stone flows.
- [ ] **Avatar & Badge Shop:**
  - Pixel and vector avatar collectibles: *Backbencher*, *Cafeteria Regular*, *Campus Cat*, *Night Owl*, *Tea Stall Philosopher*.
  - Unlocked via stones balance and displayed on chat headers.

### 👥 Phase 4: Cafeteria Group Haunts & Voice Notes
- [ ] **Cafeteria Group Haunts:**
  - 5-person topic-based anonymous lounges (e.g., *CSE Midterm Vent*, *Aftabnagar Foodies*, *Club Gossip*).
  - 20-minute timed group chat rooms.
- [ ] **Safe Voice Clips:**
  - 10-second ephemeral audio snippets with an optional pitch-modulating voice filter to preserve anonymity.

### 🛡️ Phase 5: Production Hardening, Domain & PWA
- [ ] **Custom Domain & Cloudflare SSL:**
  - Point a custom domain (e.g. `benchly.app` or `benchly.xyz`) to Azure IP `20.198.226.66` via Cloudflare.
  - Free automatic SSL/TLS, DDoS protection, and WebSocket edge caching.
- [ ] **PWA (Progressive Web App) Enhancements:**
  - Web manifest and service worker caching for full-screen edge-to-edge experience on iOS Safari and Android Chrome with "Add to Home Screen" prompt.
- [ ] **Automated Daily Analytics Rollup Cron:**
  - Schedule a midnight cron worker to rollup `analytics_events` into `daily_metrics` and clean messages older than 90 days.

---

## 3. Server Management & Runbook Reference

### SSH Connection:
```bash
ssh rxxeron@20.198.226.66
```

### Pull & Deploy Updates:
```bash
cd ~/benchly
git pull origin main
cd backend
npm install && npm run build
pm2 restart all --update-env
```

### Service Health & Logs:
```bash
pm2 status                        # Check process status (server + worker)
pm2 logs benchly-server --lines 50 # View real-time WebSocket server logs
pm2 logs benchly-worker --lines 50 # View message stream persister logs
redis-cli ping                    # Test Redis health (should return PONG in <0.1ms)
free -h                           # Check RAM and swap space usage
```

### Local Testing Command:
```powershell
# Frontend connected to live Azure backend:
cd f:\Backbench\frontend
flutter run -d chrome --dart-define=SOCKET_URL=http://20.198.226.66:3001
```
