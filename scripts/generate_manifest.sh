#!/bin/bash
#
# Generate CDN manifest from DynamoDB and upload to S3
#
# Usage: ./scripts/generate_manifest.sh
#

TABLE_NAME="Image-k4ql33iwljcr3iurxplbwczgeq-NONE"
STORAGE_BUCKET="amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm"
MANIFEST_KEY="manifest/images.json"
TEMP_FILE=$(mktemp)

echo "Scanning DynamoDB table: $TABLE_NAME"

# Scan all items from DynamoDB and transform to manifest format
aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --projection-expression "id, filename, urlSmall, urlMedium, urlFull, description, mood, mainSubject, tags, mainColors, exif, clipNeighbors, avgRating, ratingCount" \
    | jq '{
        version: "2.0",
        generatedAt: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
        count: (.Items | length),
        images: [.Items[] | {
            id: .id.S,
            filename: .filename.S,
            urls: {
                small: .urlSmall.S,
                medium: .urlMedium.S,
                full: .urlFull.S
            },
            description: .description.S,
            mood: .mood.S,
            main_subject: .mainSubject.S,
            tags: (try (.tags.S | fromjson) catch {}),
            main_colors: (try (.mainColors.S | fromjson) catch {}),
            exif: (try (.exif.S | fromjson) catch {}),
            clipNeighbors: (try (.clipNeighbors.S | fromjson) catch []),
            avgRating: (try (.avgRating.N | tonumber) catch 0),
            ratingCount: (try (.ratingCount.N | tonumber) catch 0)
        }]
    }' > "$TEMP_FILE"

COUNT=$(jq '.count' "$TEMP_FILE")
echo "Generated manifest with $COUNT images"

# Upload to S3
echo "Uploading to s3://$STORAGE_BUCKET/$MANIFEST_KEY"
aws s3 cp "$TEMP_FILE" "s3://$STORAGE_BUCKET/$MANIFEST_KEY" \
    --content-type "application/json" \
    --cache-control "public, max-age=60"

# Cleanup
rm -f "$TEMP_FILE"

echo "Done! Manifest available at: https://cdn.picgraf.com/$MANIFEST_KEY"
