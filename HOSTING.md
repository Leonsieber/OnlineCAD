# Hosting OnlineCAD for free

Everything below costs $0 and needs no credit card. You need three free accounts: **GitHub** (you
have it), **Cloudflare**, and **Supabase**. Allow about 30 minutes the first time.

| What | Where | Address (example) |
| --- | --- | --- |
| The CAD app | Cloudflare Pages, project `onlinecad` | `https://onlinecad.pages.dev` |
| The website (landing page) | Cloudflare Pages, project `onlinecad-site` | `https://onlinecad-site.pages.dev` |
| Sign-in and cloud saves | Supabase (free plan) | `https://xxxx.supabase.co` |
| Desktop installers | GitHub Releases | `github.com/Leonsieber/OnlineCAD/releases` |

## 1. Supabase: accounts and cloud saves

1. Go to https://supabase.com, sign in with GitHub, and create a **New project** (any name, a strong
   database password, the region closest to you). Wait about two minutes.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and press **Run**.
   This creates the `projects` table and the security rules (each user sees only their own projects,
   plus projects shared by link).
3. Open **Project settings → API** and copy two values: the **Project URL** and the **anon public**
   key. The anon key is meant to be public; the security rules protect the data.
4. Sign-in methods, under **Authentication → Sign In / Providers**:
   - **Email** is on by default (users get a one-time sign-in link).
   - **Google**: create an OAuth client at https://console.cloud.google.com/apis/credentials
     (type "Web application"), add the redirect URL Supabase shows you, then paste the client ID and
     secret into Supabase.
   - **GitHub**: create an OAuth app at https://github.com/settings/developers with the same
     redirect URL, then paste its client ID and secret into Supabase.
5. **Authentication → URL Configuration**: set **Site URL** to your app address
   (`https://onlinecad.pages.dev`) and add it under **Redirect URLs** too (add
   `http://localhost:5173` as well for local testing).

The free plan pauses a project after a week with no activity; opening the dashboard wakes it up.

## 2. Cloudflare Pages: the app

1. Go to https://dash.cloudflare.com, sign up, and open **Workers & Pages → Create → Pages →
   Connect to Git**. Pick the `OnlineCAD` repository.
2. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables: `NODE_VERSION` = `24`, `VITE_SUPABASE_URL` = your Project URL,
     `VITE_SUPABASE_ANON_KEY` = your anon key
3. **Save and deploy.** Every push to `main` now redeploys automatically, and pull requests get
   preview links.

Pages serves files up to 25 MB, and the OpenCascade WebAssembly is 22 MB, so it fits.

## 3. Cloudflare Pages: the website

Create a second Pages project from the same repository:

- Build command: (leave empty)
- Build output directory: `website`

Then edit the two links at the top of `website/index.html` (`APP_URL` and the GitHub repository) if
your addresses differ from the examples.

## 4. Desktop installers (GitHub Releases)

The workflow in `.github/workflows/release.yml` builds Windows, macOS, and Linux installers and
attaches them to a GitHub Release whenever you push a version tag:

```bash
git tag v0.2.0
git push origin v0.2.0
```

To include sign-in in the desktop apps, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under
**GitHub → repository Settings → Secrets and variables → Actions → Variables**.

The website's download buttons point to `releases/latest/download/OnlineCAD-Setup.exe` (and `.dmg`,
`.AppImage`), so they always serve the newest release.

**Unsigned installers:** Windows SmartScreen shows "Windows protected your PC" for unsigned apps
(click **More info → Run anyway**), and macOS asks you to open it from System Settings → Privacy &
Security. Removing these warnings needs a code-signing certificate (Windows, about $100–300 a year)
and an Apple Developer account ($99 a year). Neither is required to publish.

To build the Windows installer on your own PC instead: `npm run dist:desktop` (output in `release/`).

## 5. Your own domain (optional)

A domain costs about $10 a year (Cloudflare Registrar sells at cost). In each Pages project, open
**Custom domains** and add, for example, `app.yourdomain.com` and `yourdomain.com`. Then update the
Supabase Site URL and redirect URLs to the new addresses.

## 6. AI part generation

No server is needed: each user enters their own API key (Claude, OpenAI, OpenRouter) in the AI
settings, or runs a free local model with Ollama. Keys stay in that user's browser.
