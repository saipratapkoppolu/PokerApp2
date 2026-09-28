# Splitwise worker ("Connect Splitwise")

Lets each admin log in with their own Splitwise account and add the game as an expense.
It holds the Splitwise **app secret** (which can't be in the website) and forwards only
three calls: `get_current_user`, `get_groups`, `create_expense`. Free Cloudflare plan is plenty.

## One-time setup

1. **Register the app on Splitwise** — https://secure.splitwise.com/apps → *Register your application*
   - Name: Poker Tracker · Homepage: https://poker-tracker-2ab9c.web.app
   - **Callback URL:** `https://poker-splitwise.<your-subdomain>.workers.dev/callback`
     (you get the exact address after the first deploy in step 3; come back and fill it in)
   - Note the **Consumer Key** (client ID) and **Consumer Secret**.
2. **Cloudflare account** — sign up free at https://dash.cloudflare.com.
3. **Deploy** (from this folder):
   ```bash
   cd splitwise-worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put SPLITWISE_CLIENT_ID
   npx wrangler secret put SPLITWISE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET
   ```
   For `SESSION_SECRET` paste any long random text (e.g. from `openssl rand -base64 32`).
   Changing it later logs everyone out of Splitwise in the app.
4. **Point the app at it** — in the app's `.env`:
   ```
   VITE_SPLITWISE_WORKER_URL=https://poker-splitwise.<your-subdomain>.workers.dev
   ```
   then `npm run build` and deploy hosting.

## Try it on your computer first

```bash
cd splitwise-worker
cp .dev.vars.example .dev.vars      # fill in the Splitwise key + secret
npx wrangler dev                    # worker on http://localhost:8787
```
Set the Splitwise app's **Callback URL** to `http://localhost:8787/callback`, and in the app's `.env`
`VITE_SPLITWISE_WORKER_URL=http://localhost:8787`, then `npm run dev` in the project folder and open
http://localhost:5173.

`wrangler.toml` → `ALLOWED_ORIGINS` lists the sites that may use the worker (live site, Firebase
preview links, `http://localhost:5173`). `GROUP_ID` optionally locks expenses to one Splitwise group.
