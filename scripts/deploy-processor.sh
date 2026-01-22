#!/bin/bash
# Deploy the GPU processor script to S3
# Run this after making changes to process_images.py

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET="picgraf-models-213117946893"

echo "Uploading process_images.py to S3..."
aws s3 cp "$SCRIPT_DIR/process_images.py" "s3://$BUCKET/scripts/process_images.py"

echo ""
echo "Done! The script will be downloaded by the GPU instance on next boot."
echo ""
echo "To update a running instance immediately, run:"
echo "  ./scripts/restart-processor.sh"
