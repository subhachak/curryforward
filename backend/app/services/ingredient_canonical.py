from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..nutrition import _normalize_unit


def _as_float(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _same_unit(left: str | None, right: str | None) -> bool:
    return _normalize_unit(left) == _normalize_unit(right)


def _option_key(option: dict[str, Any]) -> tuple[float | None, str]:
    return (_as_float(option.get("amount")), _normalize_unit(option.get("unit")))


def _grams_from_weight_amount(amount: float | None, unit: str | None) -> float | None:
    if amount is None:
        return None
    normalized = _normalize_unit(unit)
    if normalized == "g":
        return amount
    if normalized == "kg":
        return amount * 1000
    if normalized == "oz":
        return amount * 28.3495
    if normalized == "lb":
        return amount * 453.592
    return None


def _canonical_grams_from_row(ingredient: dict[str, Any]) -> float | None:
    grams = _as_float(ingredient.get("gram_amount")) or _as_float(ingredient.get("gram_equivalent"))
    if grams is not None:
        return grams

    for option in ingredient.get("unit_options") or []:
        option_grams = _grams_from_weight_amount(_as_float(option.get("amount")), option.get("unit"))
        if option_grams is not None:
            return option_grams

    return _grams_from_weight_amount(_as_float(ingredient.get("amount")), ingredient.get("unit"))


def _display_option_from_original(ingredient: dict[str, Any], gram_amount: float | None) -> dict[str, Any] | None:
    amount = _as_float(ingredient.get("amount"))
    unit = str(ingredient.get("unit") or "").strip()
    if amount is None or not unit or _same_unit(unit, "g"):
        return None
    if gram_amount is not None and amount == gram_amount and _same_unit(unit, "g"):
        return None
    return {
        "amount": amount,
        "unit": unit,
        "label": f"{amount:g} {unit}".strip(),
    }


def normalize_ingredient_to_grams(ingredient: dict[str, Any]) -> dict[str, Any]:
    """Return an ingredient row with grams as the canonical amount/unit.

    Older rows may store the recipe-facing amount as "3 Cup" or "2 Qty" with
    an alternate gram option. New rows store "678 g" canonically, plus optional
    display metadata for human-friendly rendering.
    """
    row = deepcopy(ingredient)
    gram_amount = _canonical_grams_from_row(row)

    original_display_unit = str(row.get("display_unit") or "").strip()
    if not original_display_unit:
        original_display_unit = str(row.get("unit") or "").strip()
    if _same_unit(original_display_unit, "g"):
        original_display_unit = ""

    options: list[dict[str, Any]] = []
    original_option = _display_option_from_original(row, gram_amount)
    if original_option:
        options.append(original_option)
    for option in row.get("unit_options") or []:
        amount = _as_float(option.get("amount"))
        unit = str(option.get("unit") or "").strip()
        if amount is None or not unit or _same_unit(unit, "g"):
            continue
        normalized = {
            "amount": amount,
            "unit": unit,
            "label": option.get("label") or f"{amount:g} {unit}".strip(),
        }
        if _option_key(normalized) not in {_option_key(existing) for existing in options}:
            options.append(normalized)

    row["gram_amount"] = gram_amount
    row["gram_equivalent"] = gram_amount
    row["amount"] = gram_amount
    row["unit"] = "g"
    row["display_unit"] = original_display_unit or row.get("display_unit") or None
    row["unit_options"] = options
    return row


def normalize_components_to_grams(components: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    normalized = []
    for component in components or []:
        next_component = dict(component)
        next_component["component_name"] = str(next_component.get("component_name") or "").strip() or "main"
        next_component["ingredients"] = [
            normalize_ingredient_to_grams(ingredient)
            for ingredient in component.get("ingredients", [])
        ]
        normalized.append(next_component)
    return normalized
