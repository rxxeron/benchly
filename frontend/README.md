# 📱 Benchly — Flutter Client

The official cross-platform client application for **Benchly** (`com.rxxeron/benchly`), the anonymous campus adda platform for East West University students.

Built with Flutter 3.x, designed for responsive web (`benchly.live`) and mobile devices.

---

## 🎨 Client Highlights

- **Dark Campus Aesthetic:** Custom sleek dark palette (`#080A0F`, `#10141E`, `#10B981` Emerald, `#6366F1` Indigo) with glassmorphism touches and smooth animations.
- **Responsive Mobile Container:** Centers and bounds the chat experience to a native 480px mobile viewport on ultra-wide desktop monitors while filling mobile screens natively.
- **Radar Queue Animation:** Custom pulse animation with real-time countdown timer and graceful timeout handling.
- **Short URL Invite Integration:** 1-tap invite link generation (`https://benchly.live/b/:code`), system clipboard copy, and direct WhatsApp deep-link sharing (`wa.me/?text=...`).
- **Deep-Link Auto-Join:** Detects `?invite=CODE` parameters upon loading and triggers a direct bench join dialog.
- **Personal Adda Stats ("Student Analytics"):** 6 KPI engagement cards, sent-vs-received dynamic ratio bar, and referral attribution tracking with Daily (24h), Weekly (7d), and Monthly (30d) filters.
- **15-Day Nickname Rotation:** Automatic modal alert prompting students to roll a new anonymous alias or keep an auto-generated one upon expiry.
- **PII Shield & Mutual Handshake:** Real-time client-side shielding of phone numbers and social links until mutual handshake agreement.

---

## 📁 Structure

```
frontend/lib/
├── config/
│   └── app_config.dart           # Production endpoint URLs, Supabase keys & timeouts
├── screens/
│   ├── auth_screen.dart          # EWU student email OTP authentication
│   ├── main_navigation_screen.dart# Main bottom tab bar (Benches, Adda Stats, Profile)
│   ├── home_tab_screen.dart      # Radar matchmaking, preference filters & short invites
│   ├── chat_room_screen.dart     # 15-min chat, message bubbles, handshake & extender
│   ├── student_analytics_screen.dart # Personal student engagement metrics & referrals
│   └── settings_screen.dart      # Alias history bottom sheet, sound settings, sign out
├── widgets/
│   └── mobile_container.dart     # Responsive layout boundary
└── main.dart                     # Application bootstrap & auth gate
```

---

## 🚀 Running Locally

```bash
# 1. Install packages
flutter pub get

# 2. Analyze code (zero errors/warnings)
flutter analyze

# 3. Run on Chrome Web
flutter run -d chrome --web-port=3000 --dart-define=SOCKET_URL=http://localhost:5000

# 4. Build release bundle for production web
flutter build web --release --dart-define=SOCKET_URL=https://api.benchly.live
```
