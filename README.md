# Smart Pantry

A phone-first pantry app. It keeps track of what's in your fridge and pantry, suggests what to cook for the current meal at the effort level you're up for, and turns "I want X" into an Instamart cart through Swiggy's Instamart MCP.

- **Every dish has three versions.** Each dish has Basic, Classic and Loaded versions, and each version adds ingredients on top of the one before. Your energy level decides which version is suggested.
- **The ranking is deterministic.** A fixed scoring rule ranks dishes from your pantry quantities, the meal, your energy, your mood and your own ratings. Every suggestion shows why it was picked.
- **The pantry tracks amounts.** Countable items are tracked as amounts (eggs, grams of paneer, ml of milk), and cooking a dish subtracts exactly what it used.
- **There's a cooking journal.** You can log photos, ratings and notes. Your photos become the dish covers, and your ratings tune what gets suggested.
- **AI is used only to write recipes.** It drafts new recipes in the same 3-version format (Phase 3). It never ranks dishes.
- **Swiggy Instamart MCP integration is planned for Phase 2.** It will use `search_products` to map ingredients to products, `update_cart` and `checkout` behind an explicit confirmation, and `get_orders` to restock the pantry from deliveries.

## Repo layout

| Path | What |
|---|---|
| [PRD.md](PRD.md) | Product requirements and design decisions |
| [PLAN.md](PLAN.md) | Phased build plan |
| [data/](data/) | Source-of-truth seed data: 20 tiered recipes, ingredient catalog with units and SKUs, starting pantry |
| [prototype/](prototype/) | Single-file clickable prototype |
| [app/](app/) | Phase 1 installable web app (Vite + React + TypeScript, IndexedDB, offline) |

## Run the app

```bash
cd app && npm install && npm run dev
```

Tests: `npm test`. Typecheck: `npm run typecheck`. Production build: `npm run build`.

## Deploy (Vercel)

Live at **https://lakshith-pantry.vercel.app**. Deploy manually with `npx vercel deploy --prod` from the repo root; the project is already linked.

1. Go to vercel.com and choose **Add New → Project**, then import `CodeFire98/smart-pantry`. Leave the root directory as the repo root; `vercel.json` already builds `app/` and serves `app/dist`.
2. Open the deployment URL on your phone and choose **Add to Home Screen**. The app works offline.
3. Data (pantry, journal and photos) is stored on the phone in IndexedDB. Use **My → Download backup** now and then.
