#!/bin/bash
# =============================================================================
# PicGraf GPU Monitoring Script
#
# Usage: ./monitor_gpu.sh [command]
#
# Commands:
#   status    - Show current GPU instance and queue status (default)
#   events    - Tail EventBridge events in real-time
#   logs      - Tail CloudWatch logs from GPU instance
#   ssh       - SSH into the running GPU instance
# =============================================================================

REGION="us-east-1"
LOG_GROUP="/picgraf/gpu-processor"
SQS_URL="https://sqs.us-east-1.amazonaws.com/213117946893/picgraf-image-processing"
ASG_NAME="picgraf-gpu-processors"

case "${1:-status}" in
  status)
    echo "=========================================="
    echo "PicGraf GPU Status - $(date)"
    echo "=========================================="
    echo ""

    echo "=== SQS Queue ==="
    aws sqs get-queue-attributes \
      --queue-url "$SQS_URL" \
      --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
      --query 'Attributes' --output table
    echo ""

    echo "=== Auto Scaling Group ==="
    aws autoscaling describe-auto-scaling-groups \
      --auto-scaling-group-names "$ASG_NAME" \
      --query 'AutoScalingGroups[0].[DesiredCapacity,MinSize,MaxSize]' \
      --output text | awk '{print "Desired:", $1, "Min:", $2, "Max:", $3}'
    echo ""

    echo "=== GPU Instances ==="
    aws ec2 describe-instances \
      --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" \
                "Name=instance-state-name,Values=pending,running,stopping" \
      --query 'Reservations[*].Instances[*].[InstanceId,State.Name,LaunchTime,PublicIpAddress]' \
      --output table
    echo ""

    echo "=== Recent Events (last 5) ==="
    aws logs filter-log-events \
      --log-group-name "$LOG_GROUP" \
      --limit 5 \
      --query 'events[*].message' \
      --output text 2>/dev/null | head -20 || echo "No events yet"
    ;;

  events)
    echo "Tailing GPU processor events (Ctrl+C to stop)..."
    echo ""
    aws logs tail "$LOG_GROUP" --follow --format short
    ;;

  logs)
    # Get the running instance ID
    INSTANCE_ID=$(aws ec2 describe-instances \
      --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" \
                "Name=instance-state-name,Values=running" \
      --query 'Reservations[0].Instances[0].InstanceId' \
      --output text)

    if [ "$INSTANCE_ID" == "None" ] || [ -z "$INSTANCE_ID" ]; then
      echo "No running GPU instance found"
      exit 1
    fi

    echo "Tailing logs from instance $INSTANCE_ID..."
    # Try SSM first, fall back to direct SSH
    aws ssm start-session --target "$INSTANCE_ID" --document-name AWS-StartInteractiveCommand \
      --parameters command="tail -f /var/log/user-data.log /var/log/gpu-startup.log" 2>/dev/null || \
    echo "SSM not available. Try: ssh -i ~/.ssh/pixndx-admin.pem ubuntu@<public-ip>"
    ;;

  ssh)
    INSTANCE_IP=$(aws ec2 describe-instances \
      --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" \
                "Name=instance-state-name,Values=running" \
      --query 'Reservations[0].Instances[0].PublicIpAddress' \
      --output text)

    if [ "$INSTANCE_IP" == "None" ] || [ -z "$INSTANCE_IP" ]; then
      echo "No running GPU instance found"
      exit 1
    fi

    echo "Connecting to GPU instance at $INSTANCE_IP..."
    ssh -i ~/.ssh/pixndx-admin.pem ubuntu@$INSTANCE_IP
    ;;

  *)
    echo "Usage: $0 [status|events|logs|ssh]"
    exit 1
    ;;
esac
