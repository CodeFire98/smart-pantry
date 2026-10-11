# Smart Pantry build plan

The plan builds outward from the deterministic core, so every phase leaves a usable app. See [PRD.md](PRD.md) for the reasoning behind each decision.

## Phase 0: Validate the concept ✅ done 2026-10-10
- [x] Prototype v2 built on the real seed data
- [x] Open questions answered (PRD §9)
- [x] 20 dishes written in the tiered format (`data/recipes.json`)
- [x] Swiggy Builders Club checked. **Build first, apply later.** Localhost needs no approval. The production form asks for a working demo video and a production HTTPS redirect URI, so we apply at the end of Phase 2.

## Phase 1: V1 PWA core, no Swiggy yet ✅ built 2026-10-10 (`app/`)
1. Scaffold Vite + React + TS PWA with installable manifest and offline cache.
2. `engine/` as a pure TS module: tier resolution, substitutes, optional ingredients, scoring and the "why" terms. **Unit-test with fixtures** (pantry + context → expected ranking).
3. Recipe DB as versioned JSON in the repo, validated by a schema at build time.
4. Pantry: IndexedDB store, levels, item kinds, a shelf-life table and expiry estimates.
5. Screens: Today (suggestions), Ask ("I want"), Dish detail (tiers), Pantry, Shopping list.
6. "I cooked this" deducts usage and updates the cook log, and the log down-ranks recent dishes.
7. Shopping list falls back to copy/share text plus Instamart search links.
- **Exit:** I use it daily for a week without wanting to fall back to my head.

## Phase 2: Swiggy integration ✅ live 2026-10-11 (Builders Club approved; ordering on in production)
1. Supabase: auth, tables `pantry_items`, `cook_log`, `ingredient_sku_map`. Sync IndexedDB in both directions.
2. Edge function `swiggy-proxy`: OAuth 2.1 PKCE, token storage server-side, and a typed wrapper per MCP tool.
3. **Staging spike first.** Confirm `get_orders` / `get_order_details` return line items, and document the response shape.
4. Ingredient → SKU mapping via `search_products`. Remember my pick per ingredient (brand and pack).
5. Cart: merge with `get_cart`, write with `update_cart`, show the bill, and use a **hard confirmation sheet** before `checkout`.
6. Pantry import from orders, plus `your_go_to_items` for first-run seeding.
7. Deploy the proxy on Vercel, record a demo video, and submit the Builders Club developer form. It's pre-filled: add the redirect URI (`https://<vercel-domain>/api/auth/swiggy/callback`) and the demo link, then accept the terms. Review takes about 2 weeks.
- **Exit:** "I want rajma" → confirm → order placed → arrives → pantry updated, with no manual typing.

## Phase 2.5: Sync + polish ✅ 2026-10-11
- Pantry, journal (with photos), recipes and list sync across devices via Upstash (newest edit wins per item/field)
- Editable journal entries (version, rating, note, photo later); pantry steps in real pack sizes; add your own pantry items

## Phase 3: Smart edges (next)
- Free-text → structured query with a free-tier LLM (Gemini Flash or Groq), outputting a JSON schema of `{dishes, tags, energy, meal}`. The engine still ranks.
- Recipe authoring script: dish name → tiered JSON draft, then my review, then commit.
- Receipt photo or voice → pantry items.
- Lazy pantry check: ask "still have coriander?" only when a top suggestion depends on it.

## Phase 4: Native shell (when needed)
- Wrap with Capacitor (reusing the PWA) for push notifications for expiry and delivery tracking, plus a home-screen widget for "tonight's top 3".

## Tech choices at a glance

| Layer | Choice | Reason |
|---|---|---|
| Client | React + Vite PWA | Fastest path to a phone app, one codebase |
| Logic | Pure TS engine | Deterministic, testable, works offline |
| Data | IndexedDB, then Supabase | Local-first, with sync added later |
| Commerce | Swiggy Instamart MCP via edge proxy | Tokens stay server-side |
| AI | None on the critical path. Free-tier LLM only for parsing and authoring | Cost, reliability and determinism |
