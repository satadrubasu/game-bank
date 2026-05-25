# Game Bank

A small Next.js + MongoDB app for running local tabletop banking games with admin-hosted rooms, per-game wallets, and approved player-to-player transfers.

## Local Development

1. Start MongoDB locally or through the compose stack.
2. Copy `.env.example` to `.env.local` if you want custom credentials.
3. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Default admin login:

```text
username: admin
password: admin123
```

## Podman Compose

Podman Desktop is enough on macOS. From this folder:

```bash
podman compose up --build
```

Then open [http://localhost:3000](http://localhost:3000).

## Current Scope

- Login, register, reset password.
- Admin game creation with max players and initial per-player points.
- Joinable game list for users.
- Freeze, unfreeze, and end game controls for admin.
- One active game per user.
- Per-game wallet balances.
- Send/request transfer flow with accept/decline notifications.
- Transaction history and ended-game report dashboard.
