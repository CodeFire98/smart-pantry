# Smart Pantry PRD

*Status: concept draft v0.1 · 2026-10-10 · Owner: Lakshith*

## 1. Problem

Every day I stand in front of the fridge and ask the same question: *what can I make right now?* The answer depends on three things I hold in my head badly:

1. **What I have.** I don't know if there's coriander left or whether the bread is about to go stale.
2. **What I could make from it.** I can't quickly match a dozen ingredients against the dishes I know.
3. **How much effort I'm up for.** On a tired Tuesday I want the 10-minute version, and on a Sunday I want the full one.

When nothing fits my mood, ordering the missing ingredients is a separate chore: I have to work out what's missing, open Instamart, search for each item and add it to the cart.

## 2. Product in one line

A phone-first pantry that knows what you have, suggests what to cook **at the right level of effort**, and turns "I want X" into an Instamart cart.

## 3. Goals and non-goals

**Goals (V1)**
- G1. Open the app and get a ranked list of dishes I can cook now, for the current meal, in under 5 seconds.
- G2. Show every dish as **tiers** (basic, classic, loaded) so I can trade effort for richness.
- G3. "I want ___" shows what I have, what's missing for each tier, and puts the missing items in a cart in one tap.
- G4. Keep the pantry accurate with minimal typing: Instamart order import, auto-deduction when I cook, and a quick weekly check.
- G5. Results are deterministic and explainable: the same pantry and context always produce the same suggestions, each with a "why".

**Non-goals (V1)**
- Gram-level inventory and nutrition tracking. I'll use coarse levels instead (see 6.2).
- Social features, multi-household sync and recipe sharing.
- Meal planning for the whole week (V2 candidate).
- Placing orders without my explicit confirmation, ever.

## 4. User and core jobs

The primary user is me: a single person or small household in an Indian metro who uses Instamart, cooks most days and knows ~20–40 dishes.

| # | Job | Trigger | Success looks like |
|---|-----|---------|--------------------|
| J1 | "What can I make?" | Hungry, no plan | Tap a suggestion and start cooking within 1 minute |
| J2 | "I want X" | Craving or a mood | See the missing items and have them in the cart in 2 taps |
| J3 | "Keep my pantry right" | Groceries arrive, I cook, things run out | Less than 2 minutes a week of manual upkeep |
| J4 | "Use it before it rots" | Perishables near expiry | Suggestions favour expiring items automatically |

## 5. Key flows

### F1. Open the app and get suggestions (the default screen)
1. The app infers the meal from the clock: breakfast 5–11, lunch 11–16, snack 16–19, dinner 19–5. I can override it with chips.
2. I set my **energy**: Low (≤15 min, minimal steps), Medium (≤30 min), or High (anything).
3. The app shows two groups:
   - **Cook now.** Dishes with at least one fully stocked tier that fits my energy, ranked by score. Each card shows the recommended tier, the time, and a one-line *why* (for example "uses bread, expires tomorrow").
   - **One item away.** Dishes where a better-fitting tier needs only 1–2 missing items, with a quick add-to-cart.
4. Tapping a dish opens its detail (F3).

### F2. "I want ___"
1. I type or say a dish ("rajma", "something spicy and quick", "eggs").
2. The app resolves the input to dishes by name, alias, mood tag or key ingredient.
3. For each match it shows the highest tier I can cook now and the missing items for each higher tier.
4. **Add missing to cart** puts those items on the shopping list (V1). With Swiggy connected (V1.5) it maps them to Instamart products and fills the cart.

### F3. Dish detail with tiers
- Tiers are cumulative. *Basic* lists the core ingredients, *Classic* adds aromatics and tempering, and *Loaded* adds extras and sides.
- Every ingredient shows ✓ have, ⚠ low, or ✗ missing, and lists accepted substitutes (shallot for onion, ghee for butter).
- Each tier shows its time, effort (1–3) and the steps it adds.
- **I cooked this** deducts the used ingredients (6.2) and logs the dish so it is down-ranked for a few days.

### F4. Pantry
- Items are grouped by Fridge, Pantry, Freezer, and Staples & spices.
- One tap cycles a level: Full → Half → Low → Out.
- Perishables show "expires in N days", estimated from the purchase date and a shelf-life table.
- **Import from Instamart** pulls recent orders and updates levels and purchase dates.
- **Weekly check** is a swipe-card review of only the items the app is unsure about.

### F5. Cart and checkout (V1.5, needs Swiggy access)
1. Missing ingredients map to Instamart SKUs (preferred brand and pack size remembered per ingredient).
2. The app shows the cart with prices and the bill (`get_cart`).
3. **A confirmation sheet is required** before `checkout`. Orders cannot be cancelled through the API.
4. After delivery, the order is auto-imported into the pantry (`get_orders` / `get_order_details`).

## 6. How it works

### 6.1 Is AI needed? Mostly no. The core is deterministic.

| Concern | Approach | Why |
|---|---|---|
| Matching pantry to dishes | **Deterministic engine** over a curated recipe DB | Fast, free, offline, explainable and testable. It can't hallucinate a dish with an ingredient I don't have. |
| Tiers and substitutions | **Data**, stored in each recipe | Tiers are a property of the dish, so they don't need to be generated at runtime |
| Ranking by meal, energy, expiry and mood | **Deterministic scoring function** (6.4) | Tunable weights, so the same input always gives the same output |
| Free text like "something spicy, low effort" | V1: keyword and tag parser. V2: optional **LLM → structured query** (JSON) | The LLM only converts words into filters, and the engine still decides |
| Adding new recipes | **Offline LLM authoring**: generate the tiered JSON, I review it once and it goes into the DB | AI is used at write time, never at read time |
| Pantry input from a receipt photo or voice | V2: LLM extraction into structured items | Makes data entry cheaper |

This design avoids an AI dependency on the critical path. Free-tier models (Gemini Flash, Groq-hosted Llama) are enough for the optional edges, and the app works fully if they're down.

### 6.2 Pantry model: confidence over precision
Exact quantities don't survive real life, so the model tracks levels and confidence instead.
- **Item kinds**
  - **Staple** (salt, oil, turmeric): assumed present until I mark it Out.
  - **Durable** (rice, dal, atta, pasta): has a level and decays only when cooked with.
  - **Perishable** (milk, coriander, paneer, bread): has a level and an expiry estimate, and auto-drops to "Unsure" after its shelf life.
- **Levels**: Full / Half / Low / Out. A recipe treats Low as available but flags it.
- **Deduction on cook**: each recipe ingredient has a usage weight (light, normal or heavy). Cooking steps the level down by that weight, so heavy use takes Full straight to Low.
- **Sources of truth, in priority order**: manual edit, then Instamart import, then cook deduction, then decay estimate.

### 6.3 Recipe model: tiers and ingredient slots
```jsonc
{
  "id": "poha",
  "name": "Kanda Poha",
  "aliases": ["poha", "aval"],
  "meals": ["breakfast", "snack"],
  "tags": ["light", "quick", "maharashtrian"],
  "tiers": [
    { "name": "Basic", "mins": 15, "effort": 1,
      "add": [
        { "slot": "poha" },
        { "slot": "onion", "subs": ["shallot"] },
        { "slot": "mustard_seeds" }, { "slot": "turmeric" }, { "slot": "oil", "subs": ["ghee"] }
      ],
      "steps": ["Rinse poha", "Temper mustard, sauté onion, add turmeric", "Fold in poha, steam 2 min"] },
    { "name": "Classic", "mins": 20, "effort": 2,
      "add": [{ "slot": "curry_leaves", "optional": true }, { "slot": "green_chilli" }, { "slot": "peanuts" }, { "slot": "lemon" }],
      "steps": ["Fry peanuts first", "Finish with lemon"] },
    { "name": "Loaded", "mins": 25, "effort": 2,
      "add": [{ "slot": "potato" }, { "slot": "peas" }, { "slot": "coriander" }, { "slot": "sev", "optional": true }] }
  ]
}
```
- Tiers are **cumulative**: Classic includes everything in Basic.
- An `optional` ingredient never blocks a tier. Its absence is shown but not counted as missing.
- `subs` lists acceptable substitutes, and a substitute counts as "have" with a note.
- The V1 recipe DB holds about 40 dishes I actually cook, written in this format.

### 6.4 Scoring (deterministic)
For each recipe, find the *best cookable tier* (the highest tier that is fully available) and the *target tier* (the highest tier whose effort and time fit my energy).

```
score =  30 × meal_match           (dish is tagged for the current meal)
       + 20 × energy_fit           (best cookable tier fits energy)
       + 10 × tier_depth           (how rich a version I can make, 0–1)
       + 15 × expiring_used        (uses an item expiring within 2 days)
       + 10 × mood_match           (matches the selected mood tags)
       −  8 × missing_for_target   (items missing for the target tier)
       − 20 × cooked_recently      (cooked in the last 2 days)
```
- **Cook now** includes dishes where the best cookable tier exists and fits my energy.
- **One item away** includes dishes where the target tier is missing 1–2 items.
- Every suggestion carries the terms that fired, and those terms are the "why" shown to the user.

### 6.5 Swiggy Instamart integration
These details were verified against Swiggy's Builders Club docs on 2026-10-10.
- **Access.** Builders Club is **invite-only**. Staging is self-serve, and production is whitelisted after a working staging integration and review. A demo video helps. Apply early, since this is the longest-lead item.
- **Transport.** MCP over JSON-RPC at `mcp.swiggy.com/im` (Instamart). Auth is OAuth 2.1 with PKCE and phone OTP login, and Dynamic Client Registration means no client ID is needed. Redirects must be HTTPS, with `http://localhost` allowed for development.
- **Tools we need (19 available):**

| Need | Tool |
|---|---|
| Choose delivery address | `get_addresses` |
| Map ingredient → product | `search_products` (address-scoped, returns variants) |
| Seed pantry from habits | `your_go_to_items` |
| Import what I bought | `get_orders`, `get_order_details` |
| Build cart | `update_cart` (replaces the whole cart), `get_cart`, `list_coupons`, `apply_coupon` |
| Pay and place the order | `get_payment_options`, `checkout`, or the UPI path `check_payment_status` → `confirm_order` |
| Track delivery | `track_order`, `get_delivery_status` |

- **Guardrails**
  - `checkout` always sits behind an in-app confirmation showing the items, total and address.
  - `update_cart` replaces the entire cart, so merge with the existing cart from `get_cart` before writing.
  - **Unknown to verify on staging:** whether `get_orders` / `get_order_details` return line items with quantities. Pantry import depends on it. The fallback is `your_go_to_items` plus a manual confirmation.
- **Without Swiggy access** the app still works: the cart becomes a shareable shopping list with Instamart search links.

### 6.6 Architecture (V1)
```
Phone (PWA, installable)
 ├─ UI: React + Vite, mobile-first
 ├─ Recipe engine: pure TS module (deterministic, unit-tested)
 ├─ Local store: IndexedDB (pantry, history), works offline
 └─ Sync ↔ Supabase (Postgres: pantry, recipes, cook_log; auth)
            └─ Edge function "swiggy-proxy"
                 ├─ holds OAuth tokens server-side (never in the browser)
                 └─ calls Instamart MCP tools
```
- **Why a PWA first:** one codebase, installable to the home screen, no app-store review, and quick iteration. Once usage proves the concept, wrap it with Capacitor or Expo for push notifications ("paneer expires tomorrow") and a native share sheet.
- **Why a server proxy:** the OAuth tokens can place real orders, so they must not live in browser storage.

## 7. Success metrics (personal-use V1)
- I open it for at least 5 of 7 dinners for 3 consecutive weeks.
- I cook the suggested dish at least 50% of the times I open the app.
- Pantry accuracy: when I spot-check, at least 85% of item levels are correct.
- "I want X" to cart takes 30 seconds or less.
- Food waste: fewer items thrown out per week, from a self-reported baseline.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Pantry drifts from reality | Suggestions become wrong and trust erodes | Levels instead of grams, cook deduction, order import, an "Unsure" state, a weekly 30-second check |
| Swiggy access delayed or denied | No auto cart or import | V1 doesn't depend on it, with a shopping-list fallback |
| `get_orders` lacks line items | Import is weaker | `your_go_to_items` plus a manual confirmation sheet |
| Recipe DB is too small or too generic | Boring suggestions | Start with my own 40 dishes and add more through LLM authoring with review |
| Accidental orders | Real money spent | Hard confirmation gate and no auto-checkout |

## 9. Decisions from v0.2 (2026-10-10)

The open questions are answered: veg and egg first, chicken occasionally, no allergies; cooking for one; a kadai and saucepan on induction, with no blender, microwave, pressure cooker or oven. The seed data now lives in `data/`, and the prototype reads those files directly.

- **Quantities for countable items, levels for the rest.** This replaces the levels-only model in 6.2.
  - Eggs, paneer, milk, rice and dals are tracked in pc, g or ml. Each recipe states the amount per serving (`"paneer:150"`), and *I cooked this* subtracts exactly that.
  - Staples (spices, sauces, oil) stay level-based and are never auto-deducted.
  - Items you weren't sure about are flagged **unsure** and confirmed with one tap. Recipes treat them as available, and the "why" line says it is assuming them.
- **Equipment is a filter.** A tier can declare `needs: ["blender"]`. Without that equipment the tier isn't suggested, and the dish shows "Needs a blender". Two recipes from the docx that relied on blending now have a no-blender path (mash with a ladle).
- **"My" journal.** Each cook is logged with the version, a 1–5 rating, a note and an optional photo. The latest photo becomes the dish's cover.
- **Learning from the journal, deterministically.** Ratings feed the scoring:
  - the dish's own average contributes (avg − 3) × 6;
  - tags you rate ≥ 4 on average (with at least 2 cooks) add +5.
- **Learning from the journal, with AI.** Claude reads the journal, the pantry, the equipment and the diet, then drafts new dishes in the same 3-tier JSON format. A draft joins the recipe DB only after you add it, and from then on it is ranked by the same rules. AI writes recipes but never ranks them.
- **Diet as scoring.** Chicken dishes get −10 unless the "chicken" mood is on.
- **Instamart is the only real price source.** Prices in `ingredients.json` are placeholders until `search_products` is connected. Packs bought through Instamart add their real quantity to the pantry on delivery.

## 10. Open questions (original)
1. Diet: veg, eggetarian or non-veg? Any allergies?
2. How many people am I cooking for usually? This affects pack sizes and deduction.
3. Which cuisines and which 40 dishes go into the seed DB?
4. Should appliances (air fryer, oven, pressure cooker) filter the tiers?
5. Is one weekly pantry check acceptable, or should it be done lazily (asked only when a suggestion depends on an uncertain item)?
