#!/bin/bash
# =============================================================================
# PicGraf GPU Instance Startup Script
#
# This script lives in the git repo and is called by the EC2 user data.
# It pulls the latest code and starts the image processor.
#
# The EC2 user data only needs to:
#   1. Mount EFS
#   2. Call: /mnt/models/repo/scripts/gpu_startup.sh
# =============================================================================

set -ex
exec > >(tee -a /var/log/gpu-startup.log) 2>&1

echo "=========================================="
echo "GPU Startup: $(date)"
echo "=========================================="

MOUNT_POINT="/mnt/models"
REPO_DIR="$MOUNT_POINT/repo"
DEPLOY_KEY="$MOUNT_POINT/config/deploy_key"

# =============================================================================
# PHASE 1: Pull latest code from git
# =============================================================================

echo "Pulling latest code from git..."
cd "$REPO_DIR"

# Configure git to use deploy key
export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=no"

# Pull latest (will fail gracefully if offline)
git fetch origin main 2>/dev/null || echo "Warning: Could not fetch from origin"
git reset --hard origin/main 2>/dev/null || echo "Warning: Could not reset to origin/main"

echo "Current commit: $(git log --oneline -1)"

# =============================================================================
# PHASE 2: Ensure Ollama is running with correct model
# =============================================================================

echo "Ensuring Ollama is running..."

# Configure Ollama environment
export OLLAMA_MODELS="$MOUNT_POINT/ollama"

# Start Ollama if not running
if ! pgrep -x ollama > /dev/null; then
    systemctl start ollama || ollama serve &
    sleep 5
fi

# Wait for Ollama to be ready
echo "Waiting for Ollama server..."
for i in {1..24}; do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "Ollama is ready!"
        break
    fi
    echo "Waiting for Ollama... attempt $i/24"
    sleep 5
done

# Ensure model is available (idempotent - skips if present)
echo "Ensuring gemma3:27b-it-qat model is available..."
ollama pull gemma3:27b-it-qat 2>/dev/null || echo "Model already available or pull failed"

# Warm up the model
echo "Warming up model..."
curl -s http://localhost:11434/api/generate \
    -d '{"model": "gemma3:27b-it-qat", "prompt": "Hi", "stream": false}' \
    --max-time 180 || echo "Model warm-up complete"

# =============================================================================
# PHASE 3: Run the image processor
# =============================================================================

echo "Starting image processor..."
echo "Script: $REPO_DIR/scripts/process_images.py"

# Set environment variables
export STORAGE_BUCKET="${STORAGE_BUCKET:-amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm}"
export SQS_QUEUE_URL="${SQS_QUEUE_URL:-https://sqs.us-east-1.amazonaws.com/213117946893/picgraf-image-processing}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export HF_HOME="$MOUNT_POINT/huggingface"
export OLLAMA_URL="http://localhost:11434"
export OLLAMA_MODEL="gemma3:27b-it-qat"
export EFS_MOUNT="$MOUNT_POINT"

# Run the processor
cd "$REPO_DIR"
python3 scripts/process_images.py

echo "=========================================="
echo "GPU Startup Complete: $(date)"
echo "=========================================="
