# Curryforward

Agentic recipe generator — seeded from your real recipe collection, expandable via chat, with a nutrition fact sheet at every version.

## Architecture

```
Excel/Sheet seed → recipe-pipeline (normalization + human review gate)
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

### Production / single-process

Build the frontend and let FastAPI serve it (no separate Node process needed):

```bash
cd frontend-next && npm install && npm run build   # writes frontend-next/out/
cd ../backend && uvicorn app.main:app
```

Open **http://127.0.0.1:8000** — FastAPI serves the exported static site at `/`
and the API at `/api`, same origin, so the session cookie and relative
`fetch("/api/...")` calls both just work.

## Access model

Still single-shared-secret (`ADMIN_TOKEN`), not multi-user accounts — appropriate
for "I'm running this on my own laptop and might let family/friends try it," not
a production auth system. What changed from v0: instead of pasting that secret
into a token field on every visit, there's a real **/login** page. It exchanges
the secret for a signed, httpOnly session cookie (`app/auth.py`), so the raw
secret never sits in `localStorage` or gets attached to every request.

| Role | How | Can do |
|---|---|---|
| **Admin** (you) | Log in at `/login` with the `ADMIN_TOKEN` value | Fork recipes, persist chat customizations as new versions, approve/reject the review queue, persist newly generated recipes |
| **Guest** (anyone else) | Not logged in | Browse all recipes, use chat to customize, generate new recipes — but the result is a **session-only preview**: not saved, not forkable, gone on refresh |

Enforced server-side (`app/auth.py`), not just hidden in the UI — a guest hitting
the API directly gets a `403` on fork/review-decide, not just a missing button.
The old `X-Admin-Token` header still works too (useful for scripts/tests), checked
alongside the session cookie.

## What's seeded

The `seed_data/` folder contains real output from the recipe-pipeline, run against
your actual recipe sheet:
- **8 recipes auto-committed** (clean extractions, high confidence)
- **9 recipes in the review queue** (prose-format sources, multi-component ambiguity,
  or undetected serving scale) — visible and actionable in the app's Review Queue panel

This split is real, not illustrative — it reflects genuine data quality in your sheet,
not a designed demo split.

## Known limitations (v0, by design)

| Limitation | Why | Path to v1 |
|---|---|---|
| Nutrition is approximate | Curated ~30-ingredient table + rough unit-to-gram conversion, not USDA-grade | Swap `nutrition.py`'s lookup for a USDA FoodData Central API call — same `compute_nutrition()` interface |
| Only 8 of ~40 real recipes seeded | This build used a representative subset of your sheet to keep the interactive session tractable | Re-run `scripts/run_extraction.py` against your full sheet text — same pipeline, no code changes needed |
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
│   │   ├── models.py         # RecipeVersion, ReviewQueueItem (SQLAlchemy)
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
│       ├── app/               # /, /login, /recipe routes
│       ├── components/        # NavBar, RecipeCard, ChatPanel, ui/ design system
│       ├── context/           # AuthContext, ToastContext
│       └── lib/                # api client, shared types
└── README.md
```
