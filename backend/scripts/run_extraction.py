import json
import sys
from pathlib import Path

# recipe-pipeline is a sibling project (see the zip's top level) —
# install it with: pip install -e ../../recipe-pipeline
# This path insert is a fallback for running without installing it first.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "recipe-pipeline" / "src"))

from recipepipeline.splitter import split_recipes
from recipepipeline.extractor import extract

with open("../seed_data/raw_sheet_full.txt") as f:
    raw = f.read()

chunks = split_recipes(raw)
recipes = [extract(c) for c in chunks]

def to_dict(r):
    return json.loads(r.model_dump_json())

with open("../seed_data/seed_recipes.json", "w") as f:
    json.dump([to_dict(r) for r in recipes], f, indent=2)

print(f"Seeded: {len(recipes)}")
for r in recipes:
    print(f"  seeded: {r.name}")
