#!/bin/bash
#
# Migrate localImages.json to DynamoDB using AWS CLI
#
# Usage: ./scripts/migrate_to_dynamodb.sh
#

TABLE_NAME="Image-k4ql33iwljcr3iurxplbwczgeq-NONE"
JSON_FILE="public/localImages.json"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required. Install with: brew install jq"
    exit 1
fi

# Count total images
TOTAL=$(jq '.images | length' "$JSON_FILE")
echo "Found $TOTAL images to migrate"
echo "Target table: $TABLE_NAME"
echo ""

WRITTEN=0
ERRORS=0

# Process each image
jq -c '.images[]' "$JSON_FILE" | while read -r img; do
    ID=$(echo "$img" | jq -r '.id')

    # Build the item JSON for put-item
    ITEM=$(echo "$img" | jq --arg ts "$TIMESTAMP" '{
        id: { S: .id },
        filename: { S: (.filename // (.id + ".jpg")) },
        urlSmall: { S: (.urls.small // ("images/small/" + .id + ".jpg")) },
        urlMedium: { S: (.urls.medium // ("images/medium/" + .id + ".jpg")) },
        urlFull: { S: (.urls.full // ("images/full/" + .id + ".jpg")) },
        description: { S: (.description // "") },
        mood: { S: (.mood // "neutral") },
        mainSubject: { S: (.main_subject // "") },
        tags: { S: ((.tags // {}) | tostring) },
        mainColors: { S: ((.main_colors // {}) | tostring) },
        dominantColorHex: { S: ((.main_colors // {}) | to_entries | .[0].value // "#808080") },
        exif: { S: ((.exif // {}) | tostring) },
        clipNeighbors: { S: ((.clipNeighbors // []) | tostring) },
        avgRating: { N: ((.avgRating // 0) | tostring) },
        ratingCount: { N: ((.ratingCount // 0) | tostring) },
        createdAt: { S: $ts },
        updatedAt: { S: $ts },
        "__typename": { S: "Image" }
    }')

    # Write to DynamoDB
    if aws dynamodb put-item --table-name "$TABLE_NAME" --item "$ITEM" 2>/dev/null; then
        WRITTEN=$((WRITTEN + 1))
    else
        echo "  Error writing: $ID"
        ERRORS=$((ERRORS + 1))
    fi

    # Progress every 100 items
    COUNT=$((WRITTEN + ERRORS))
    if [ $((COUNT % 100)) -eq 0 ]; then
        echo "  Progress: $COUNT / $TOTAL"
    fi
done

echo ""
echo "Migration complete!"
echo "  Check DynamoDB for results"
