# Curryforward

Agentic recipe generator — seeded from your real recipe collection, expandable via chat, with a nutrition fact sheet at every version.

## Architecture

```
Starter recipe seed → Curryforward admin research workflow
    → Curryforward backend (FastAPI + SQLite)
        → Recipe Store (versioned: fork = new lineage, edit = new version)
        → Nutrition Engine (heuristic v0, per-version snapshot)
        → LLM Agent (chat customization + web-search-informed generation)
        → Auth (signed httpOnly session cookie via a real /login form)
    → Frontend (Next.js/TypeScript/Tailwind, App Router)
```

## Run it locally

Two processes in dev — the backend API and the Next.js dev server, which proxies
`/api/*` to the backend so the browser only ever talks to one origin (needed for
the session cookie to work without extra CORS config).

**Backend** (terminal 1):

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env: add ANTHROPIC_API_KEY (for chat/generate) and set ADMIN_TOKEN
# to any secret string of your choosing — that's also your /login password.

uvicorn app.main:app --reload
```

**Frontend** (terminal 2):

```bash
cd frontend-next
npm install
npm run dev
```

Then open **http://localhost:3000**.

## Configuration

Backend configuration lives in `backend/.env`:

| Variable | Required | Purpose |
|---|---:|---|
| `ADMIN_TOKEN` | yes | Shared admin password for `/login` and `X-Admin-Token` API access |
| `ADMIN_DISPLAY_NAME` | optional | Display name used to prefill admin-authored review/comment replies |
| `SESSION_SECRET` | recommended | Signing key for the httpOnly admin session cookie; falls back to `ADMIN_TOKEN` |
| `APP_ENV=production` | recommended in production | Enables secure cookies and HSTS when Railway's production env flag is absent |
| `RATE_LIMIT_*` | optional | Tunes login, feedback, upload, and LLM request limits |
| `ANTHROPIC_API_KEY` | for Anthropic chat/generation | Enables the default recipe chat/generate paths |
| `OPENAI_API_KEY` | recommended | Enables the GPT defaults for moderation, research, import, rewrite, and assistant tasks through LiteLLM |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | optional | Enables those models as alternate choices in Workspace → Models through LiteLLM |
| `DEFAULT_MODEL` | optional | Legacy fallback LiteLLM model string; task-specific defaults are managed in Workspace → Models |
| `OPENAI_WEB_SEARCH_MODEL` | optional | Overrides the OpenAI model used for native web search, defaults to `gpt-5-mini` |
| `CORS_ORIGINS` | optional | Comma-separated allowed frontend origins for cookie auth |
| `DATABASE_URL` | optional | SQLite database URL; use `sqlite:////data/curryforward.db` with a persistent Railway Volume |
| `UPLOADS_DIR` | optional | Uploaded-image directory; use `/data/uploads` with a persistent Railway Volume |
| `LOG_LEVEL` | optional | Python log level, defaults to `INFO` |

### Production / single-process

Build the frontend and let FastAPI serve it (no separate Node process needed):

```bash
cd frontend-next && npm install && npm run build   # writes frontend-next/out/
cd ../backend && uvicorn app.main:app
```

Open **http://127.0.0.1:8000** — FastAPI serves the exported static site at `/`
and the API at `/api`, same origin, so the session cookie and relative
`fetch("/api/...")` calls both just work.

### Railway deployment

This repo includes a `Dockerfile` and `railway.toml` for a single Railway
service. The Docker build compiles the Next static export, copies it into the
FastAPI runtime image, and runs `uvicorn`; no Node process is needed after the
image is built.

Railway deploys are persistent only where you attach persistent storage. Do not
store the SQLite database or uploaded images on the container filesystem. Add a
Railway Volume mounted at `/data`, then set:

```bash
DATABASE_URL=sqlite:////data/curryforward.db
UPLOADS_DIR=/data/uploads
```

Also set the app secrets in Railway variables:

```bash
ADMIN_TOKEN=...
SESSION_SECRET=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
OPENAI_WEB_SEARCH_MODEL=gpt-5-mini
DEFAULT_MODEL=openai/gpt-5-mini
```

Optional model-provider variables such as `GEMINI_API_KEY` and `GROQ_API_KEY`
can be added later for alternate model choices. The Railway health check uses
`/api/health`.

LLM task defaults can be changed from **Workspace → Models**. The app starts
with GPT-5 nano defaults for cheap classification/extraction/rewrite calls,
GPT-5 mini defaults for research/import/refinement, and Anthropic defaults for
the recipe generation paths that still depend on Anthropic's server-side web
search.

## Checks and migrations

Local checks mirror CI:

```bash
uv run --with-requirements backend/requirements.txt pytest
cd frontend-next && npm run lint && npm run build
```

Schema changes should go through Alembic from here forward. The app still keeps
the lightweight startup migration/backfill path for existing local databases,
but new schema work should add a migration under `backend/alembic/versions/`:

```bash
cd backend
alembic upgrade head
```

CI is defined in `.github/workflows/ci.yml` and runs backend tests plus frontend
lint/build on pushes to `main` and pull requests.

## Access model

Still single-shared-secret (`ADMIN_TOKEN`), not multi-user accounts. For this
single-admin app, production hardening adds secure cookies, security headers,
rate limiting, admin audit logs, and default-off guest LLM access. What changed
from v0: instead of pasting that secret
into a token field on every visit, there's a real **/login** page. It exchanges
the secret for a signed, httpOnly session cookie (`app/auth.py`), so the raw
secret never sits in `localStorage` or gets attached to every request.

| Role | How | Can do |
|---|---|---|
| **Admin** (you) | Click the small icon near the footer → `/login` with the `ADMIN_TOKEN` value → lands on `/admin` | Start/edit recipes from the dashboard, copy/delete drafts, persist chat customizations as new versions, draft and save new recipes conversationally, moderate public feedback |
| **Guest** (anyone else) | Not logged in | Browse/search recipes, ask read-only questions about the recipe currently open, and leave moderated feedback. Public users cannot trigger generation, drafting, research, or recipe-changing LLM calls. |

The rest of the app doesn't call out roles at all — `/recipes` and recipe pages render
as browsing surfaces. Dashboard-only controls stay on `/admin` rather than being
shown elsewhere with a "guest mode" label.

Enforced server-side (`app/auth.py`), not just hidden in the UI — a guest hitting
the API directly gets a `403` on admin-only actions, not just a missing button.
The old `X-Admin-Token` header still works too (useful for scripts/tests), checked
alongside the session cookie.

Admin actions are written to `admin_audit_logs`, and model calls are written to
`llm_usage_logs` when the app can observe them. Workspace → Analytics shows recent
activity and model usage summaries.

## Research, provenance, and uploads

Auto-research now leaves an audit trail in `research_jobs`: approved queries,
search results, progress, status, model, and errors. The current recipe row
still carries live polling fields for the UI, while `GET
/api/recipes/research/{recipe_id}/jobs` exposes historical runs for admin
debugging and future source/provenance UI.

Image uploads are local files under `backend/uploads/`, capped at 8 MB, admin
only, and validated by both declared content type and file signature before
being served from `/uploads/...`.

## What's seeded

The `seed_data/` folder contains real output from the recipe-pipeline, run against
your actual recipe sheet:
- **8 starter recipes** are loaded into the local database the first time the app
  starts.

New recipes should enter through the admin Workspace research flow.

## Known limitations (v0, by design)

| Limitation | Why | Path to v1 |
|---|---|---|
| Nutrition is approximate | Curated ~30-ingredient table + rough unit-to-gram conversion, not USDA-grade | Swap `nutrition.py`'s lookup for a USDA FoodData Central API call — same `compute_nutrition()` interface |
| Only 8 of ~40 real recipes seeded | This build used a representative subset of your sheet to keep the interactive session tractable | Add recipes through Workspace research or regenerate `seed_recipes.json` from your full sheet |
| No LLM-based extraction yet | v0 uses the heuristic extractor built earlier | Recipe-pipeline's extractor is designed to swap in an LLM call behind the same `extract()` interface |
| Chat customization requires your own Anthropic API key | Local-first design — no hosted dependency | N/A — this is the intended design, not a gap |

## Two real bugs found and fixed while building this

1. **Reference-content boundary bug**: "Cake Pan Conversion Chart" (no `Yelds/Serves/Yield`
   marker) was silently merging into the preceding recipe and corrupting the next
   recipe's name. Fixed by giving reference blocks their own boundary-detection rule.
2. **Unit corruption bug**: row-slicing fell back to a fixed 120-character window
   (this source data has no newlines to split on), which bled into the next
   ingredient row and corrupted units (e.g. `"g"` → `"g 2"`). Fixed by using the
   next detected row's start position as the boundary instead.

Both are locked in as regression tests in `recipe-pipeline/tests/test_pipeline.py`.

## Project structure

```
curryforward/
├── backend/
│   ├── app/
│   │   ├── main.py           # FastAPI entrypoint, mounts frontend export + API
│   │   ├── auth.py           # role model + /api/auth/login, /api/auth/logout
│   │   ├── models.py         # SQLAlchemy models
│   │   ├── db.py             # SQLite engine/session
│   │   ├── nutrition.py      # heuristic nutrition engine (v0)
│   │   ├── llm_agent.py      # chat customization + gap-fill generation
│   │   ├── seed_loader.py    # loads pipeline output into the DB
│   │   └── routers/recipes.py
│   ├── seed_data/            # real recipe-pipeline output
│   ├── scripts/run_extraction.py
│   ├── requirements.txt
│   └── .env.example
├── frontend-next/             # Next.js (TypeScript, Tailwind, App Router)
│   └── src/
│       ├── app/               # / (marketing), /recipes, /recipe, /recipe/research, /admin, /login
│       ├── components/        # NavBar, RecipeCard, NutritionCard, assistant/, ui/ design system
│       ├── context/           # AuthContext, ToastContext, RecipesContext, AssistantContext
│       └── lib/                # api client, shared types, assistant NL heuristics
└── README.md
```

## Frontend tour

- **`/`** — marketing/intro page: what Curryforward is, what's new, no recipe
  grid (that's `/recipes`).
- **`/recipes`** — browse all recipes, filter by category/cuisine tag, search.
  Identical for every visitor — no admin-only controls live here anymore.
- **`/recipe?id=`** — a single recipe: ingredients, steps, and a Nutrition
  Facts panel styled like a real product label (calories, per-serving macros,
  rough %DV, ingredient list), sticky in the right column on desktop. No edit
  controls live here, even for admins.
- **`/admin`** — the one place admin-only tools live: recipe research,
  dashboard edit entry points, feedback moderation, recipe management, Trash, and
  **Log out**. Editing a published recipe creates/reuses a linked draft copy;
  publishing that draft lets the admin either replace the original recipe or
  keep both versions as separate recipes.
  Guests hitting it directly get a neutral "log in to access this" prompt.
- **The search bar *is* the assistant** (`components/assistant/AssistantSearchBar.tsx`,
  lives in the nav) — public guests get client-side recipe search off recipe
  pages, and read-only recipe-context Q&A on recipe pages. Guest chat sees only
  the current recipe document and must refuse unrelated topics. Admins can also
  type customization requests or full recipe drafts into the same box; admin
  recipe-page chat persists changes as a new version. There's no backend
  intent-classifier; routing between search/customize/create is light keyword
  heuristics in `lib/assistantHeuristics.ts`.
- **Conversational recipe drafting** (admin only): paste a messy recipe you
  found somewhere, or just name a dish, into the search bar. It's sent to
  `POST /api/recipes/draft`, which structures/invents a recipe (web search
  for grounding when you just gave a dish name) — nothing is saved yet. Keep
  refining in the same conversation ("make it vegan", "double the servings")
  and click **Save recipe** in the chat once you're happy; that calls the
  regular `POST /api/recipes` create endpoint.
- **Every AI conversation carries full history** — both the per-recipe
  customize chat and the recipe-drafting chat send prior turns
  (`ChatHistoryTurn[]`) with each request, so "actually make that lime zest
  instead" correctly resolves against what you asked for two messages ago,
  not just the latest message in isolation.
- **Admin access is deliberately subtle**: a small icon near the footer
  (`components/AuthFooterControl.tsx`), not a nav badge — click it to reach
  `/login` (guest) or `/admin` (already logged in). No page anywhere else
  calls out "guest"/"admin" by name; controls just don't render for guests.
