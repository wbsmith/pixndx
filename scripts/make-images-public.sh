#!/bin/bash
# Make S3 images folder publicly accessible
# Run this ONCE after deploying to Amplify

BUCKET_NAME="amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm"

echo "🔓 Making images folder public in S3 bucket: $BUCKET_NAME"

# First, allow public bucket policies (needed for Amplify-created buckets)
echo "1. Disabling block public access for bucket policy..."
aws s3api put-public-access-block \
  --bucket "$BUCKET_NAME" \
  --public-access-block-configuration '{
    "BlockPublicAcls": true,
    "IgnorePublicAcls": true,
    "BlockPublicPolicy": false,
    "RestrictPublicBuckets": false
  }'

# Then add the bucket policy
echo "2. Adding public read policy for images/ prefix..."
aws s3api put-bucket-policy \
  --bucket "$BUCKET_NAME" \
  --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"PublicReadImages\",
      \"Effect\": \"Allow\",
      \"Principal\": \"*\",
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::$BUCKET_NAME/images/*\"
    }
  ]
}"

echo "✅ Done! Images should now be publicly accessible."
echo ""
echo "Test by opening this URL in your browser:"
echo "https://$BUCKET_NAME.s3.us-east-1.amazonaws.com/images/small/2020-09-05-0001%201.jpg"

