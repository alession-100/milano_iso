# T-1.6: data validation on the real processed pilot data (VERIFICATION section 3).
# Not part of DATA_STEPS and not part of `make test`.
.PHONY: validate check-determinism

VALIDATE_OUT := reports/artifacts/T-1.6

# Runs the tests marked `data` (deselected by default via pyproject.toml). The summary and
# landmarks_check.csv are written by the test session itself, also when tests fail.
validate: tiles
	mkdir -p $(VALIDATE_OUT)
	uv run pytest -m data tests/data -v --junitxml=$(VALIDATE_OUT)/junit.xml

# Re-runs every DATA_STEPS step twice into scratch directories (downloads are skipped; raw
# files are read as they are) and compares the canonical sha256 of every GeoPackage produced.
# The real interim/processed data and the committed artifacts are not touched.
check-determinism:
	uv run python tests/data/check_determinism.py $(DATA_STEPS)
