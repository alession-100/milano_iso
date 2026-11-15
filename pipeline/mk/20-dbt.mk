# T-1.2: Comune di Milano DBT 2020 (ADR-0013). Registers itself in DATA_STEPS.
DATA_STEPS += data-dbt

.PHONY: data-dbt
data-dbt:
	uv run python -m milano_iso.dbt_fetch
	uv run python -m milano_iso.dbt_extract --extent pilot
