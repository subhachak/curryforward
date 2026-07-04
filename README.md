# Curryforward

Agentic recipe generator — seeded from your real recipe collection, expandable via chat, with a nutrition fact sheet at every version.

## Architecture

```
Excel/Sheet seed → recipe-pipeline (normalization + human review gate)
    → Curryforward backend (FastAPI + SQLite)
        → Recipe Store (versioned: fork = new lineage, edit = new version)
        → Nutrition Engine (heuristic v0, per-version snapshot)
        → LLM Agent (chat customization + web-search-informed generation)
    → Frontend (single-file HTML/JS, no build step)
```

## Run it locally

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
# Edit .env: add ANTHROPIC_API_KEY (for chat/generate) and set ADMIN_TOKEN
# to any secret string of your choosing.

uvicorn app.main:app --reload
```

Then open **http://127.0.0.1:8000** in your browser. That's it — one command, one process, serves both API and frontend.

## Access model

This is single-shared-secret, not multi-user accounts — appropriate for
"I'm running this on my own laptop and might let family/friends try it,"
not a production auth system.

| Role | How | Can do |
|---|---|---|
| **Admin** (you) | Enter the `ADMIN_TOKEN` value in the app's token field | Fork recipes, persist chat customizations as new versions, approve/reject the review queue, persist newly generated recipes |
| **Guest** (anyone else) | No token, or wrong token | Browse all recipes, use chat to customize — but the result is a **session-only preview**: not saved, not forkable, gone on refresh |

Enforced server-side (`app/auth.py`), not just hidden in the UI — a guest hitting
the API directly gets a `403` on fork/review-decide, not just a missing button.

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
│   │   ├── main.py           # FastAPI entrypoint, mounts frontend + API
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
├── frontend/
│   └── index.html            # single-file, no build step
└── README.md
```
