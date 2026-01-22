#!/bin/bash
# Restart the processor on a running GPU instance
# This downloads the latest script from S3 and restarts the service

set -e

BUCKET="picgraf-models-213117946893"

# Find running GPU instance
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=*Gpu*" "Name=instance-state-name,Values=running" \
  --query "Reservations[*].Instances[*].InstanceId" --output text)

if [ -z "$INSTANCE_ID" ]; then
  echo "No running GPU instance found."
  exit 0
fi

echo "Found GPU instance: $INSTANCE_ID"
echo "Downloading latest script and restarting processor..."

# Send SSM command to update and restart
COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"cd /mnt/models/scripts\",
    \"aws s3 cp s3://$BUCKET/scripts/process_images.py . --region us-east-1\",
    \"systemctl restart picgraf-processor\",
    \"echo 'Processor restarted with latest script'\"
  ]" \
  --query "Command.CommandId" --output text)

echo "Waiting for command to complete..."
sleep 5

# Check result
aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query "{Status:Status,Output:StandardOutputContent}" --output json

echo ""
echo "Done!"
