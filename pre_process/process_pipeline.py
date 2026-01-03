import os
import sys
import shutil
import subprocess
import base64
import json
import logging
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from pathlib import Path

# Third-party imports
import requests
from PIL import Image, ImageOps

# IMPORTANT: Disable DecompressionBomb limit for 100MP Hasselblad images
Image.MAX_IMAGE_PIXELS = None 

# ==============================================================================
# CONFIGURATION
# ==============================================================================

INPUT_DIRS = [
    "/home/tyler/pictures/edits",
    "/home/tyler/pictures/X2D_Output",
    "/home/tyler/pictures/Output"
]

OUTPUT_BASE = "/home/tyler/pictures/gallery_processed"

# AI Configuration
OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "gemma3:27b"
GPU_CONCURRENCY = 2   # Safe limit for 27B model on RTX 5090
CPU_WORKERS = 20      # High parallelism for resizing images

# Image Settings
SIZE_SMALL = 300
SIZE_MEDIUM = 1024

# External Scripts
VECTOR_SCRIPT = "/home/tyler/ai-tools/batch_vectorize.py"

JSON_PROMPT = """Analyze this image and return a valid JSON object ONLY. Do not include markdown formatting. The JSON must conform to this general schema:
{
"description": "A detailed and very descriptive visual description of the scene.",
"tags": {"topic_01" : ["subtopic_01a", "subtopic_01b"], "topic_02" : ["subtopic_02a", "subtopic_02b"]},
"mood": "The atmospheric mood",
"main_subject": "The primary focus",
"main_colors" : {"color_name_01": "hex_01", "color_name02": "hex_02"}
}
The tags should describe a conceptual hierarchy of the image."""

# ==============================================================================
# UTILITIES
# ==============================================================================

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_exif(file_path):
    """Wraps the system exiftool to get robust metadata."""
    try:
        # -n for numeric output if needed, -json for easy parsing
        result = subprocess.run(
            ["exiftool", "-json", "-n", str(file_path)],
            capture_output=True, text=True, check=True
        )
        data = json.loads(result.stdout)
        return data[0] if data else {}
    except Exception as e:
        logging.error(f"Exiftool failed for {file_path}: {e}")
        return {}

def run_ollama(image_path, exif_data):
    """Sends image to Ollama."""
    try:
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode("utf-8")

        payload = {
            "model": MODEL,
            "prompt": JSON_PROMPT,
            "stream": False,
            "format": "json",
            "images": [img_b64]
        }
        
        # Increase  for large models
        response = requests.post(OLLAMA_URL, json=payload, timeout=300)
        response.raise_for_status()
        
        result = response.json()
        ai_data = json.loads(result['response'])
        
        # Merge AI data with EXIF
        return {**ai_data, "exif": exif_data}

    except Exception as e:
        logging.error(f"AI Analysis failed for {image_path}: {e}")
        return None

def get_unique_filename(directory, filename):
    """
    Checks if a file exists. If so, appends _1, _2, etc. until unique.
    Returns the full path including directory.
    """
    base, ext = os.path.splitext(filename)
    counter = 1
    new_filename = filename
    
    # We loop until we find a filename that DOES NOT exist
    while os.path.exists(os.path.join(directory, new_filename)):
        new_filename = f"{base}_{counter}{ext}"
        counter += 1
        
    return os.path.join(directory, new_filename)

def process_image_task(task_args):
    """
    Worker function.
    """
    (source_path, output_root, filename) = task_args
    
    try:
        # Define GLOBAL flat directory structure
        dir_small = os.path.join(output_root, "small")
        dir_medium = os.path.join(output_root, "medium")
        dir_full = os.path.join(output_root, "full")
        dir_meta = os.path.join(output_root, "metadata")
        
        # Create directories
        for d in [dir_small, dir_medium, dir_full, dir_meta]:
            os.makedirs(d, exist_ok=True)
            
        # --- RESUME VS COLLISION LOGIC ---
        
        # 1. Construct the "default" path (if no renaming happened)
        simple_full_path = os.path.join(dir_full, filename)
        final_full_path = None

        # 2. Check if this file likely already exists (Resume logic)
        # We check if the file exists AND has the same size as the source.
        if os.path.exists(simple_full_path):
            src_size = os.path.getsize(source_path)
            dst_size = os.path.getsize(simple_full_path)
            
            if src_size == dst_size:
                # It's the same file! We are resuming.
                final_full_path = simple_full_path
        
        # 3. If it wasn't a match, generate a unique name (Collision logic)
        if final_full_path is None:
            final_full_path = get_unique_filename(dir_full, filename)

        # Extract the final filename/base used
        final_filename = os.path.basename(final_full_path)
        name_only = os.path.splitext(final_filename)[0]

        # Construct remaining paths using that determined unique name
        path_full = final_full_path
        path_medium = os.path.join(dir_medium, f"{name_only}.jpg")
        path_small = os.path.join(dir_small, f"{name_only}.jpg")
        path_json = os.path.join(dir_meta, f"{name_only}.json")

        # --- PROCESS IMAGES ---
        
        # Copy Full (Only if it doesn't match/exist)
        if not os.path.exists(path_full):
            shutil.copy2(source_path, path_full)
        
        # We perform a quick check: If Small + Medium exist, we skip opening the image entirely
        if os.path.exists(path_medium) and os.path.exists(path_small):
            pass # Skip image processing
        else:
            with Image.open(source_path) as img:
                img = ImageOps.exif_transpose(img)
                
                # Save Medium
                if not os.path.exists(path_medium):
                    img_copy = img.copy()
                    img_copy.thumbnail((SIZE_MEDIUM, SIZE_MEDIUM), Image.LANCZOS)
                    if img_copy.mode in ("RGBA", "P"): img_copy = img_copy.convert("RGB")
                    img_copy.save(path_medium, quality=85)
                    
                # Save Small
                if not os.path.exists(path_small):
                    img_copy = img.copy()
                    img_copy.thumbnail((SIZE_SMALL, SIZE_SMALL), Image.LANCZOS)
                    if img_copy.mode in ("RGBA", "P"): img_copy = img_copy.convert("RGB")
                    img_copy.save(path_small, quality=85)

        # --- PROCESS AI ---
        if not os.path.exists(path_json):
            return ("DO_AI", source_path, path_medium, path_json)
        
        return ("DONE", final_filename, None, None)

    except Exception as e:
        return ("ERROR", filename, str(e), None)

def process_ai_task(source_path, medium_path, json_path):
    """Helper to run Exif + Ollama in the thread pool"""
    exif = get_exif(source_path)
    final_json = run_ollama(medium_path, exif)
    
    if final_json:
        with open(json_path, 'w') as f:
            json.dump(final_json, f, indent=2)
        return True
    return False

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

def main():
    print(f">>> Starting Python Pipeline with Model: {MODEL}")
    
    # 1. Scan and Build Task List
    tasks = []
    
    for input_root in INPUT_DIRS:
        print(f">>> Scanning: {input_root}")
        
        for root, dirs, files in os.walk(input_root):
            for file in files:
                if file.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                    source_path = os.path.join(root, file)
                    # Task args: Source, OutputBase, Filename
                    tasks.append((source_path, OUTPUT_BASE, file))

    print(f">>> Found {len(tasks)} images. Starting processing...")

    # 2. Phase 1: Heavy Lifting (Resizing)
    # We use ProcessPoolExecutor to utilize all CPU cores
    
    ai_queue = []
    
    # Using a list to hold futures
    with ProcessPoolExecutor(max_workers=CPU_WORKERS) as executor:
        future_to_file = {executor.submit(process_image_task, t): t[2] for t in tasks}
        
        for future in as_completed(future_to_file):
            filename = future_to_file[future]
            try:
                status, source, medium_path, json_path = future.result()
                
                if status == "ERROR":
                    print(f"[!] Error processing {filename}: {source}")
                elif status == "DO_AI":
                    ai_queue.append((source, medium_path, json_path))
                    print(f"[+] Resized: {filename} (Queued for AI)")
                else:
                    print(f"[-] Skipped: {filename} (Already done)")
                    
            except Exception as exc:
                print(f"[!] Exception for {filename}: {exc}")

    # 3. Phase 2: AI Analysis (Throttled)
    if ai_queue:
        print(f"\n>>> Starting AI Analysis for {len(ai_queue)} images...")
        print(f">>> AI Concurrency Limit: {GPU_CONCURRENCY}")
        
        with ThreadPoolExecutor(max_workers=GPU_CONCURRENCY) as ai_executor:
            future_to_ai = {}
            for source, medium_path, json_path in ai_queue:
                future = ai_executor.submit(process_ai_task, source, medium_path, json_path)
                future_to_ai[future] = os.path.basename(source)
            
            for future in as_completed(future_to_ai):
                fname = future_to_ai[future]
                try:
                    success = future.result()
                    if success:
                        print(f" [AI] Completed: {fname}")
                    else:
                        print(f" [AI] Failed: {fname}")
                except Exception as e:
                    print(f" [AI] specific error: {e}")

    # 4. Phase 3: Vectorize
    print("\n>>> Running Batch Vectorization...")
    if os.path.exists(VECTOR_SCRIPT):
        subprocess.run([sys.executable, VECTOR_SCRIPT, OUTPUT_BASE])
    else:
        print(f"Warning: Vector script not found at {VECTOR_SCRIPT}")
        
    print(">>> Done.")

if __name__ == "__main__":
    main()

