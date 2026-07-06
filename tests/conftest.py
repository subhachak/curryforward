import pytest

pytest_plugins = []


def pytest_configure():
    # Research draft creation only checks that the selected provider key exists;
    # tests monkeypatch the actual LLM calls. Keep CI/local test runs independent
    # of a developer's real .env.
    import os

    os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
    os.environ.pop("USDA_FDC_API_KEY", None)
    os.environ.pop("USDA_API_KEY", None)


@pytest.fixture(autouse=True)
def _fake_dish_name_extraction(monkeypatch):
    """start_research() calls extract_dish_name() (a real LLM call) to derive
    a draft's short name from the admin's freeform starting prompt. Autouse
    so every test that creates a draft gets a fast, deterministic,
    network-free stand-in without needing to remember to mock it per-test."""
    import app.routers.research as research_router

    def fake_extract_dish_name(prompt: str, model: str) -> str:
        return prompt.strip()[:60] or "Untitled recipe"

    monkeypatch.setattr(research_router, "extract_dish_name", fake_extract_dish_name)
