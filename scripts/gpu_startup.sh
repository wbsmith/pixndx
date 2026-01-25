#!/bin/bash
# =============================================================================
# PicGraf GPU Instance Startup Script
#
# This script lives in the git repo and is called by the EC2 user data.
# The user data handles: EFS mount, git pull, Ollama start
# This script handles: Ollama warmup, environment setup, running processor
# =============================================================================

set -ex
exec > >(tee -a /var/log/gpu-startup.log) 2>&1

echo "=========================================="
echo "GPU Startup: $(date)"
echo "=========================================="

MOUNT_POINT="/mnt/models"
REPO_DIR="$MOUNT_POINT/repo"

# =============================================================================
# PHASE 1: Set up local filesystem (runs every boot)
# =============================================================================

echo "Setting up local filesystem..."

# Symlink for Ollama models to EFS (needs to run every boot)
ln -sf $MOUNT_POINT/ollama /usr/share/ollama/.ollama || true

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

# Warm up the model (first load can take 2-3 minutes as model loads to GPU)
echo "Warming up model (this may take a few minutes on first load)..."
curl -s http://localhost:11434/api/generate \
    -d '{"model": "gemma3:27b-it-qat", "prompt": "Hi", "stream": false}' \
    --max-time 300 || echo "Model warm-up complete"

# =============================================================================
# PHASE 3: Run the image processor
# =============================================================================

echo "Starting image processor..."
echo "Script: $REPO_DIR/scripts/process_images.py"

# Set environment variables
export STORAGE_BUCKET="${STORAGE_BUCKET:-amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm}"
export SQS_QUEUE_URL="${SQS_QUEUE_URL:-https://sqs.us-east-1.amazonaws.com/213117946893/picgraf-image-processing}"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export HF_HOME="$MOUNT_POINT/huggingface"
export OLLAMA_URL="http://localhost:11434"
export OLLAMA_MODEL="gemma3:27b-it-qat"
export EFS_MOUNT="$MOUNT_POINT"

# Discover AppSync endpoint and API key for manifest notifications
echo "Discovering AppSync configuration..."
APPSYNC_API_ID=$(aws appsync list-graphql-apis --query 'graphqlApis[0].apiId' --output text 2>/dev/null)
if [ -n "$APPSYNC_API_ID" ] && [ "$APPSYNC_API_ID" != "None" ]; then
    export APPSYNC_ENDPOINT=$(aws appsync list-graphql-apis --query 'graphqlApis[0].uris.GRAPHQL' --output text)
    export APPSYNC_API_KEY=$(aws appsync list-api-keys --api-id "$APPSYNC_API_ID" --query 'apiKeys[0].id' --output text 2>/dev/null)
    echo "  AppSync endpoint: $APPSYNC_ENDPOINT"
    echo "  AppSync API key: ${APPSYNC_API_KEY:0:10}..."
else
    echo "  Warning: Could not discover AppSync API"
fi

# Activate PyTorch virtualenv (pre-installed on Deep Learning AMI)
PYTORCH_VENV="/opt/pytorch"
if [ -f "$PYTORCH_VENV/bin/activate" ]; then
    echo "Activating PyTorch virtualenv..."
    source "$PYTORCH_VENV/bin/activate"
else
    echo "Warning: PyTorch virtualenv not found at $PYTORCH_VENV"
fi

# Dependencies are pre-installed in the AMI (pytorch venv at /opt/pytorch)

# Run the processor
cd "$REPO_DIR"
python scripts/process_images.py

echo "=========================================="
echo "GPU Startup Complete: $(date)"
echo "=========================================="
