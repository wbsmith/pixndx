#!/bin/bash
#
# Upload processed gallery images to AWS S3
#
# Prerequisites:
#   - AWS CLI installed and configured: aws configure
#   - S3 bucket created by Amplify deployment
#
# Usage:
#   ./scripts/upload-to-s3.sh <bucket-name> [source-dir]
#
# Example:
#   ./scripts/upload-to-s3.sh amplify-pixndx-main-xxxxx-bucket /home/tyler/pictures/gallery_processed
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ -z "$1" ]; then
    echo -e "${RED}Error: Bucket name required${NC}"
    echo ""
    echo "Usage: $0 <bucket-name> [source-dir]"
    echo ""
    echo "To find your bucket name, run:"
    echo "  aws s3 ls | grep amplify"
    echo ""
    echo "Or check Amplify Console → Backend → Storage"
    exit 1
fi

BUCKET="$1"
SOURCE_DIR="${2:-/home/tyler/pictures/gallery_processed}"

echo "============================================"
echo -e "${GREEN}PixGraf S3 Upload Script${NC}"
echo "============================================"
echo "Bucket:     s3://$BUCKET"
echo "Source:     $SOURCE_DIR"
echo "============================================"
echo ""

# Verify source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo -e "${RED}Error: Source directory not found: $SOURCE_DIR${NC}"
    exit 1
fi

# Verify AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo -e "${RED}Error: AWS CLI not configured. Run: aws configure${NC}"
    exit 1
fi

# Verify bucket exists
if ! aws s3 ls "s3://$BUCKET" > /dev/null 2>&1; then
    echo -e "${RED}Error: Bucket not found: $BUCKET${NC}"
    echo "Make sure you've completed the Amplify deployment first."
    exit 1
fi

echo -e "${YELLOW}Starting upload...${NC}"
echo ""

# Upload small images
if [ -d "$SOURCE_DIR/small" ]; then
    echo "📷 Uploading small images..."
    aws s3 sync "$SOURCE_DIR/small" "s3://$BUCKET/images/small/" \
        --only-show-errors \
        --size-only
    SMALL_COUNT=$(aws s3 ls "s3://$BUCKET/images/small/" --recursive | wc -l)
    echo -e "   ${GREEN}✓ $SMALL_COUNT small images${NC}"
else
    echo -e "${YELLOW}⚠ No small/ directory found${NC}"
fi

# Upload medium images
if [ -d "$SOURCE_DIR/medium" ]; then
    echo "📷 Uploading medium images..."
    aws s3 sync "$SOURCE_DIR/medium" "s3://$BUCKET/images/medium/" \
        --only-show-errors \
        --size-only
    MEDIUM_COUNT=$(aws s3 ls "s3://$BUCKET/images/medium/" --recursive | wc -l)
    echo -e "   ${GREEN}✓ $MEDIUM_COUNT medium images${NC}"
else
    echo -e "${YELLOW}⚠ No medium/ directory found${NC}"
fi

# Upload full images
if [ -d "$SOURCE_DIR/full" ]; then
    echo "📷 Uploading full images..."
    aws s3 sync "$SOURCE_DIR/full" "s3://$BUCKET/images/full/" \
        --only-show-errors \
        --size-only
    FULL_COUNT=$(aws s3 ls "s3://$BUCKET/images/full/" --recursive | wc -l)
    echo -e "   ${GREEN}✓ $FULL_COUNT full images${NC}"
else
    echo -e "${YELLOW}⚠ No full/ directory found${NC}"
fi

# Upload metadata JSON files
if [ -d "$SOURCE_DIR/metadata" ]; then
    echo "📄 Uploading metadata..."
    aws s3 sync "$SOURCE_DIR/metadata" "s3://$BUCKET/metadata/" \
        --exclude "*.npy" \
        --only-show-errors \
        --size-only
    META_COUNT=$(aws s3 ls "s3://$BUCKET/metadata/" --recursive | grep -c "\.json$" || echo 0)
    echo -e "   ${GREEN}✓ $META_COUNT metadata files${NC}"
else
    echo -e "${YELLOW}⚠ No metadata/ directory found${NC}"
fi

# Optional: Upload embeddings (.npy files)
read -p "Upload embeddings (.npy files)? This is optional. [y/N]: " UPLOAD_NPY
if [[ "$UPLOAD_NPY" =~ ^[Yy]$ ]]; then
    echo "🧠 Uploading embeddings..."
    aws s3 sync "$SOURCE_DIR/metadata" "s3://$BUCKET/embeddings/" \
        --exclude "*" \
        --include "*.npy" \
        --only-show-errors \
        --size-only
    NPY_COUNT=$(aws s3 ls "s3://$BUCKET/embeddings/" --recursive | grep -c "\.npy$" || echo 0)
    echo -e "   ${GREEN}✓ $NPY_COUNT embedding files${NC}"
fi

echo ""
echo "============================================"
echo -e "${GREEN}✅ Upload complete!${NC}"
echo "============================================"
echo ""
echo "Next steps:"
echo "1. Verify in AWS Console: https://s3.console.aws.amazon.com/s3/buckets/$BUCKET"
echo "2. Test your app: Open your Amplify URL"
echo ""

