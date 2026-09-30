# EWU Backbench - Architecture & System Design

## Overview
Anonymous, time-boxed matchmaking chat for East West University students. 
"No names. No profiles. Just talk."

## Tech Stack
* **Frontend/Mobile**: Flutter (Android App, Web App, iOS PWA)
* **Backend**: Node.js (TypeScript) + Socket.IO (WebSockets)
* **In-Memory/Queue**: Valkey (Redis alternative)
* **Database & Auth**: Supabase (PostgreSQL)

## Matchmaking & Chat Flow
1. **Auth**: User authenticates via `@ewubd.edu` email using Supabase Magic Link.
2. **Registration**: User selects Gender. Backend generates a persistent anonymous alias (e.g., "Silent Panther").
3. **Queue**: User selects 1v1 or 5-person group and enters a Valkey (Redis) Matchmaking Queue.
4. **Chat Session**: 
   * Valkey matches users and assigns a temporary Socket.IO room.
   * A 5-minute countdown starts.
   * If both users agree to extend at the 1-minute mark, 5 minutes are added.
5. **End & Cooldown**: Chat closes. Users receive a 30-minute cooldown (managed via Valkey TTL) before they can queue again.

## Android Exclusive Features
* **Gamification**: Daily Streaks (7-day, 30-day) and Rewards logic will be rendered exclusively on the Android client build. Web/iOS will remain strictly chat-only.
