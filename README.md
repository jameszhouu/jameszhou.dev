# James Zhou's website

A small personal website with a Node.js contact-email backend. Requires Node.js 22 or newer; no dependencies need installing.

## Run and configure email

1. Copy `.env.example` to `.env` (if `.env` does not already exist).
2. Create a sending API key in [Resend](https://resend.com/api-keys) and set `RESEND_API_KEY` in `.env`.
3. Verify `jameszhou.dev` as a sending domain in Resend. Messages always send from `James Zhou <website@jameszhou.dev>` to `jameszhouu@u.northwestern.edu`.
4. Run `npm start` and open http://localhost:3000. Submit a message to check actual inbox delivery.

The `.env` file is ignored by Git and is never served to browsers. `RESEND_API_KEY` is the only required environment variable; use your host's secret environment settings in production. Origin checks automatically accept HTTPS requests from the request's own host (and HTTP for local development). Legacy `SITE_ORIGIN`, `CONTACT_FROM`, and `CONTACT_TO` settings are ignored. Deploy this as a Node service, not static-only hosting. Opening `index.html` directly or serving it with Python will not run the email endpoint.

## Behavior

The form POSTs to `/api/contact`. The backend sends a plain-text email through [Resend's API](https://resend.com/docs/api-reference/emails/send-email), using the fixed recipient `jameszhouu@u.northwestern.edu` and the visitor's address as Reply-To. The browser displays success only after the provider accepts the email; acceptance does not guarantee inbox delivery. Failed attempts preserve the form contents.

Server-side validation, a honeypot, request-size limits, origin checks, provider timeouts, and rate limits protect the endpoint. Limits are five attempts per connection IP and fifty total per fifteen minutes. Counters are in memory and reset on restart; use an edge rate limiter or shared store for a multi-instance deployment. Behind a proxy, requests share that proxy's IP limit because arbitrary forwarded headers are not trusted.

## Vercel

Vercel serves the built `public/` directory as static files, independently of the email function. `npm run build` copies only the HTML, CSS, and browser JavaScript. `/api/contact` uses `api/contact.mjs`, which exports a request handler without opening a port. `dev-server.mjs` is only for local use.

`vercel.json` selects the Other framework preset, the build command, and the output directory. Set `RESEND_API_KEY` in Vercel and verify `jameszhou.dev` in Resend. Custom domains and preview hosts work without an origin environment variable. Push all changes, including removal of old root `server.mjs` and `app.mjs` entrypoints. Deploy the new commit; redeploying an older commit does not include the fix.

## Tests

Run `npm test`. Integration tests use local HTTP requests and a mocked provider; they send no real emails. Live delivery requires configured credentials and a separate inbox check.
