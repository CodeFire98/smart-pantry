# Lessons

- **Food apps need appetite appeal (2026-10-10).** v1 of the prototype was called "a little plain". Dish lists need imagery from the start. Use illustrations when photos can't load, and use the user's own photos as soon as they exist. Don't ship a text-only food UI.
- **Ask about equipment early.** The user's recipes assumed a blender, a microwave and a rice cooker, none of which they own. Model equipment per recipe tier rather than assuming a standard kitchen.
- **Spike real API responses before trusting docs (2026-10-10).** Swiggy's docs describe a `{success, data}` envelope, but live responses put the payload directly in `structuredContent`. `get_cart` also returns an error, not an empty cart, when the cart is empty. Addresses come in pages. Call each tool once with real credentials (`scripts/swiggy-shape.mjs`, redacted) before building UI on it.
- **Payment enums follow the live API, not the docs.** Swiggy's docs say `"Cash"/"COD"`, but `checkout` accepts only `Cash`, `SwiggyPay` and `UPI`. Before the first real order, call the mutating tool's validation path. The rejection was harmless only because it came before an order was created.
