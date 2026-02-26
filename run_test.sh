#!/bin/bash
# Nexora Stresstest Runner
# Usage: ./run_test.sh <RUN_ID> <ENDPOINT> <JSON_BODY>
# Example: ./run_test.sh S1 generate-dual '{"userInput":"...","mode":"generate"}'

RUN_ID=$1
ENDPOINT=$2
JSON_BODY=$3
RESULTS_DIR="/c/Temp/Nexora/stresstest_runs"
mkdir -p "$RESULTS_DIR"

echo "[$RUN_ID] Starting at $(date '+%H:%M:%S')..."
START_TIME=$(date +%s)

# Make the API call
HTTP_CODE=$(curl -s -w "%{http_code}" -o "$RESULTS_DIR/${RUN_ID}.json" \
  -X POST "http://localhost:5000/api/ai/${ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d "$JSON_BODY" \
  --max-time 1800 2>/dev/null)

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "[$RUN_ID] HTTP $HTTP_CODE in ${DURATION}s"

if [ "$HTTP_CODE" = "200" ]; then
  # Extract key metrics using grep (cross-platform)
  FILE="$RESULTS_DIR/${RUN_ID}.json"
  TOKENS=$(grep -o '"totalTokens":[0-9]*' "$FILE" | head -1 | cut -d: -f2)
  MODELS=$(grep -o '"modelsUsed":\[[^]]*\]' "$FILE" | head -1)
  echo "[$RUN_ID] Tokens: $TOKENS"
  echo "[$RUN_ID] $MODELS"

  # Save summary
  echo "${RUN_ID}|${HTTP_CODE}|${DURATION}s|${TOKENS}|${MODELS}" >> "$RESULTS_DIR/summary.txt"
else
  ERROR=$(head -c 500 "$RESULTS_DIR/${RUN_ID}.json")
  echo "[$RUN_ID] ERROR: $ERROR"
  echo "${RUN_ID}|${HTTP_CODE}|${DURATION}s|ERROR|${ERROR}" >> "$RESULTS_DIR/summary.txt"
fi

echo "[$RUN_ID] Done."
