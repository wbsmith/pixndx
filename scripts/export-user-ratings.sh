#!/usr/bin/env bash
# Export user ratings from DynamoDB with Cognito email lookup
# Outputs: email, imageId, rating

set -e

TABLE_NAME="ImageRating-k4ql33iwljcr3iurxplbwczgeq-NONE"
USER_POOL_ID="us-east-1_isHEqLUeZ"

# Create temp file for email lookup
LOOKUP_FILE=$(mktemp)
trap "rm -f $LOOKUP_FILE" EXIT

# Build email lookup from Cognito
aws cognito-idp list-users \
  --user-pool-id "$USER_POOL_ID" \
  --query 'Users[*].[Username, Attributes[?Name==`email`].Value|[0]]' \
  --output text > "$LOOKUP_FILE"

# Function to lookup email by sub
lookup_email() {
  local sub="$1"
  local email=$(grep "^${sub}" "$LOOKUP_FILE" | cut -f2)
  echo "${email:-$sub}"
}

echo "email	imageId	rating"

# Paginated scan to get all ratings
LAST_KEY=""
while true; do
  if [ -z "$LAST_KEY" ]; then
    RESULT=$(aws dynamodb scan \
      --table-name "$TABLE_NAME" \
      --projection-expression "#owner, imageId, rating" \
      --expression-attribute-names '{"#owner": "owner"}' \
      --output json)
  else
    RESULT=$(aws dynamodb scan \
      --table-name "$TABLE_NAME" \
      --projection-expression "#owner, imageId, rating" \
      --expression-attribute-names '{"#owner": "owner"}' \
      --exclusive-start-key "$LAST_KEY" \
      --output json)
  fi

  # Output data rows with email lookup
  echo "$RESULT" | jq -r '.Items[] | [.owner.S, .imageId.S, .rating.N] | @tsv' | while IFS=$'\t' read -r owner imageId rating; do
    # Extract clean UUID from owner (format: uuid::uuid)
    sub="${owner%%::*}"
    email=$(lookup_email "$sub")
    printf '%s\t%s\t%s\n' "$email" "$imageId" "$rating"
  done

  # Check for more pages
  LAST_KEY=$(echo "$RESULT" | jq -r '.LastEvaluatedKey // empty')
  if [ -z "$LAST_KEY" ]; then
    break
  fi
done

echo ""
echo "--- Summary ---"
echo "Total ratings: $(aws dynamodb scan --table-name "$TABLE_NAME" --select COUNT --output json | jq -r '.Count')"
echo "Total registered users: $(aws cognito-idp list-users --user-pool-id "$USER_POOL_ID" --query 'Users | length(@)')"
