#!/bin/bash

# ==============================================================================
# IMAGE PROCESSING PIPELINE v4 (Fixed Paths + Batch Speed)
# ==============================================================================

# --- CONFIGURATION ---
INPUT_DIRS=(
    "/home/tyler/pictures/edits"
    "/home/tyler/pictures/X2D_Output"
)

# Output Base
OUTPUT_BASE="/home/tyler/pictures/gallery_processed"

MODEL="gemma3:27b"
SIZE_SMALL=300
SIZE_MEDIUM=1024

# Python Configuration
PYTHON_ENV="/home/tyler/ai-tools/venv/bin/python"
# IMPORTANT: Ensure this script contains the 'Batch' code provided earlier
VECTOR_SCRIPT="/home/tyler/ai-tools/batch_vectorize.py"

JSON_PROMPT='Analyze this image and return a valid JSON object ONLY. Do not include markdown formatting. The JSON must conform to this general schema:
{
"description": "A detailed and very descriptive visual description of the scene.",
"tags": {"topic_01" : ["subtopic_01a", "subtopic_01b"], "topic_02" : ["subtopic_02a", "subtopic_02b"]},
"mood": "The atmospheric mood",
"main_subject": "The primary focus",
"main_colors" : {"color_name_01": "hex_01", "color_name02": "hex_02"}
}
The tags should describe a conceptual hierarchy of the image.'

# ==============================================================================

set -e

# Check dependencies
for cmd in convert jq curl exiftool; do
    if ! command -v $cmd &> /dev/null; then
        echo "Error: '$cmd' is not installed."
        exit 1
    fi
done

echo ">>> Starting Pipeline on $(hostname) using $MODEL..."

# --- PHASE 1: GENERATE IMAGES & METADATA ---

for INPUT_ROOT in "${INPUT_DIRS[@]}"; do
    echo ">>> Scanning input root: $INPUT_ROOT"
    
    # Clean the input path to just the folder name (e.g., "edits" or "X2D_Output")
    ROOT_NAME=$(basename "$INPUT_ROOT")

    find "$INPUT_ROOT" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) | while read -r IMAGE_PATH; do
        
        FILENAME=$(basename "$IMAGE_PATH")
        NAME_ONLY="${FILENAME%.*}"
        
        # LOGIC FIX: Get path relative to the specific input root
        # If file is in /home/tyler/pictures/edits/2024/photo.jpg
        # This returns "2024/photo.jpg"
        RELATIVE_PATH="${IMAGE_PATH#$INPUT_ROOT/}"
        
        # Get just the subfolder structure (e.g., "2024")
        SUBDIR_STRUCTURE=$(dirname "$RELATIVE_PATH")
        
        # Construct Clean Output Path:
        # /output_base / root_folder_name / subfolders / image_name
        IMG_ROOT="$OUTPUT_BASE/$ROOT_NAME/$SUBDIR_STRUCTURE/$NAME_ONLY"
        
        # Create directories
        DIR_SMALL="$IMG_ROOT/small"
        DIR_MEDIUM="$IMG_ROOT/medium"
        DIR_FULL="$IMG_ROOT/full"
        DIR_META="$IMG_ROOT/metadata"

        mkdir -p "$DIR_SMALL" "$DIR_MEDIUM" "$DIR_FULL" "$DIR_META"

        echo " -> Processing: $FILENAME"

        # 1. IMAGES
        PATH_FULL="$DIR_FULL/$FILENAME"
        if [ ! -f "$PATH_FULL" ]; then cp "$IMAGE_PATH" "$PATH_FULL"; fi

        PATH_MEDIUM="$DIR_MEDIUM/${NAME_ONLY}.jpg"
        if [ ! -f "$PATH_MEDIUM" ]; then
            convert "$IMAGE_PATH" -resize "${SIZE_MEDIUM}x>" -quality 85 -strip "$PATH_MEDIUM"
            echo "    [Gen] Medium"
        fi

        PATH_SMALL="$DIR_SMALL/${NAME_ONLY}.jpg"
        if [ ! -f "$PATH_SMALL" ]; then
            convert "$IMAGE_PATH" -resize "${SIZE_SMALL}x>" -quality 85 -strip "$PATH_SMALL"
        fi

        # 2. EXIF & AI ANALYSIS (Vector step removed from loop)
        PATH_JSON="$DIR_META/${NAME_ONLY}.json"

        if [ -f "$PATH_JSON" ]; then
            echo "    [Skip] Metadata exists"
        else
            echo "    [AI] Analyzing with $MODEL..."
            
            # Extract EXIF
            EXIF_DATA=$(exiftool -json -n "$IMAGE_PATH" | jq '.[0]')

            # Prepare Payload
            TMP_B64=$(mktemp)
            base64 -w 0 "$PATH_MEDIUM" > "$TMP_B64"

            TMP_PAYLOAD=$(mktemp)
            jq -n \
                --arg model "$MODEL" \
                --arg prompt "$JSON_PROMPT" \
                --rawfile img "$TMP_B64" \
                '{model: $model, prompt: $prompt, stream: false, format: "json", images: [$img]}' > "$TMP_PAYLOAD"

            # Send to Ollama
            RESPONSE=$(curl -s -X POST http://localhost:11434/api/generate -d @"$TMP_PAYLOAD")
            
            rm "$TMP_B64" "$TMP_PAYLOAD"

            AI_BODY=$(echo "$RESPONSE" | jq -r '.response')

            if echo "$AI_BODY" | jq . > /dev/null 2>&1; then
                # Merge & Save
                jq -n --argjson ai "$AI_BODY" --argjson exif "$EXIF_DATA" \
                   '$ai + {exif: $exif}' > "$PATH_JSON"
                echo "    [Success] JSON Saved"
            else
                echo "    [Error] Invalid AI JSON. Logging raw response."
                echo "$RESPONSE" > "$DIR_META/ai_error.log"
            fi
        fi

    done
done

# --- PHASE 2: BATCH VECTORIZATION ---
echo "=========================================="
echo ">>> Phase 1 Complete. Starting Batch Vectorization..."
echo "=========================================="

# Calls the Python script ONCE at the end on the entire output directory
$PYTHON_ENV "$VECTOR_SCRIPT" "$OUTPUT_BASE"

echo "=========================================="
echo ">>> All Done."
echo "=========================================="

