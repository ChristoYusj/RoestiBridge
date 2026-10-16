#!/bin/sh
# `make run` entrypoint (inside Docker). Outputs go to /app/out (mounted to ./out).
set -e
cd /app
echo "== 0. Unit tests =="
python -m unittest discover -s tests
mkdir -p out
cp -r predictions_shipped/. out/
echo "== 1. Re-score the shipped Apertus-70B dev outputs (no API calls) =="
echo "-- 1 sample (temperature 0)"
python -m roestibridge evaluate --split dev --pred out/dev_70b_n1
echo "-- 3 samples (self-consistency, submitted setting), 40-document subset"
python -m roestibridge evaluate --split dev --pred out/dev_70b_n3
echo "-- 3 samples, FULL dev split (168 documents per language)"
python -m roestibridge evaluate --split dev --pred out/dev_70b_n3_full
echo "== 2. Model-free number baseline (same dev subset) =="
python -m roestibridge baseline --split dev --limit 40
echo "== 3. Rebuild the submitted test predictions from the shipped raw Apertus outputs =="
python -m roestibridge relabel --pred out/test_70b_n3
python -m roestibridge export --dev out/dev_70b_n3_full --test out/test_70b_n3 --out out/submission
echo "   -> out/submission/RoestiBridge_Apertus-70B_admin_{de,fr,it}.jsonl.jsonl (224 docs each, full-set order)"
cmp -s out/submission/RoestiBridge_Apertus-70B_admin_de.jsonl.jsonl predictions_shipped/submission/RoestiBridge_Apertus-70B_admin_de.jsonl.jsonl \
  && echo "   rebuilt submission == shipped submission (de)" || { echo "   MISMATCH vs shipped submission"; exit 1; }
if [ -n "$LLM_API_KEY" ]; then
  echo "== 4. Live run: ${LLM_NAME} on ${LIVE_LIMIT:-5} dev documents per language =="
  python -m roestibridge predict --split dev --limit "${LIVE_LIMIT:-5}" --workers 4 --out out/live_dev
  python -m roestibridge evaluate --split dev --pred out/live_dev
else
  echo "LLM_API_KEY not set: skipped the live Apertus run (steps 0-3 need no API)."
fi
