#!/usr/bin/env python3
"""
PixNdx Gallery - Complete Preprocessing Pipeline

This script runs the full preprocessing pipeline:
1. Vectorization (CLIP embeddings)
2. Similarity computation (FAISS-accelerated)
3. Optional: Duplicate detection, clustering

Usage:
    python run_pipeline.py --gallery ./gallery_processed
    python run_pipeline.py --gallery ./gallery_processed --threshold 0.8 --max-edges 25
    python run_pipeline.py --gallery ./gallery_processed --skip-vectorize
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path


def run_command(cmd: list, desc: str) -> bool:
    """Run a command and return success status."""
    print(f"\n{'='*60}")
    print(f"🚀 {desc}")
    print(f"{'='*60}")
    print(f"   Command: {' '.join(cmd)}\n")
    
    try:
        result = subprocess.run(cmd, check=True)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Failed: {e}")
        return False
    except FileNotFoundError as e:
        print(f"\n❌ Command not found: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Run the complete PixNdx Gallery preprocessing pipeline',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Full pipeline
    python run_pipeline.py --gallery ./gallery_processed

    # With custom similarity settings
    python run_pipeline.py --gallery ./gallery_processed -t 0.8 -m 25

    # Skip vectorization (if already done)
    python run_pipeline.py --gallery ./gallery_processed --skip-vectorize

    # Include duplicate detection
    python run_pipeline.py --gallery ./gallery_processed --find-duplicates
        """
    )
    
    parser.add_argument('--gallery', '-g', required=True,
                        help='Path to gallery_processed directory')
    parser.add_argument('--output', '-o', default=None,
                        help='Output directory for edges.json (default: gallery/metadata/)')
    parser.add_argument('--threshold', '-t', type=float, default=0.7,
                        help='Similarity threshold (default: 0.7)')
    parser.add_argument('--max-edges', '-m', type=int, default=50,
                        help='Max edges per node (default: 50)')
    parser.add_argument('--k-neighbors', '-k', type=int, default=100,
                        help='FAISS neighbors to search (default: 100)')
    parser.add_argument('--device', '-d', default='auto',
                        choices=['auto', 'cuda', 'mps', 'cpu'],
                        help='Device for vectorization (default: auto)')
    parser.add_argument('--skip-vectorize', action='store_true',
                        help='Skip vectorization step')
    parser.add_argument('--find-duplicates', action='store_true',
                        help='Run duplicate detection')
    parser.add_argument('--cluster', action='store_true',
                        help='Run UMAP + HDBSCAN clustering')
    
    args = parser.parse_args()
    
    gallery_path = Path(args.gallery).resolve()
    script_dir = Path(__file__).parent
    
    if not gallery_path.exists():
        print(f"❌ Gallery not found: {gallery_path}")
        sys.exit(1)
    
    output_dir = Path(args.output) if args.output else gallery_path / "metadata"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"\n📸 PixNdx Gallery Preprocessing Pipeline")
    print(f"   Gallery: {gallery_path}")
    print(f"   Output:  {output_dir}")
    print(f"   Settings: threshold={args.threshold}, max_edges={args.max_edges}")
    
    steps_completed = 0
    steps_total = 1  # At minimum: similarity
    
    if not args.skip_vectorize:
        steps_total += 1
    if args.find_duplicates:
        steps_total += 1
    if args.cluster:
        steps_total += 1
    
    # Step 1: Vectorization
    if not args.skip_vectorize:
        vectorize_script = script_dir / "batch_vectorize.py"
        if not vectorize_script.exists():
            print(f"⚠️  Vectorization script not found: {vectorize_script}")
        else:
            success = run_command([
                sys.executable, str(vectorize_script),
                str(gallery_path),
                '--device', args.device
            ], "Step 1: CLIP Vectorization")
            
            if success:
                steps_completed += 1
            else:
                print("⚠️  Vectorization failed, continuing anyway...")
    
    # Step 2: Duplicate Detection (optional)
    if args.find_duplicates:
        dupe_script = script_dir / "find_duplicates.py"
        if not dupe_script.exists():
            print(f"⚠️  Duplicate detection script not found: {dupe_script}")
        else:
            dupe_output = output_dir / "duplicates.json"
            success = run_command([
                sys.executable, str(dupe_script),
                '--images', str(gallery_path / "medium"),
                '--output', str(dupe_output),
                '--threshold', '10'  # Hamming distance threshold
            ], "Step 2: Duplicate Detection")
            
            if success:
                steps_completed += 1
    
    # Step 3: Similarity Computation
    similarity_script = script_dir / "compute_similarity.py"
    edges_output = output_dir / "edges.json"
    
    if not similarity_script.exists():
        print(f"❌ Similarity script not found: {similarity_script}")
        sys.exit(1)
    
    success = run_command([
        sys.executable, str(similarity_script),
        '--gallery', str(gallery_path),
        '--output', str(edges_output),
        '--threshold', str(args.threshold),
        '--max-edges', str(args.max_edges),
        '--k-neighbors', str(args.k_neighbors),
        '--compact'
    ], f"Step {2 if args.skip_vectorize else 3}: Similarity Computation")
    
    if success:
        steps_completed += 1
    else:
        print("❌ Similarity computation failed!")
        sys.exit(1)
    
    # Step 4: Clustering (optional)
    if args.cluster:
        cluster_script = script_dir / "cluster_layout.py"
        if not cluster_script.exists():
            print(f"⚠️  Clustering script not found: {cluster_script}")
        else:
            cluster_output = output_dir / "clusters.json"
            success = run_command([
                sys.executable, str(cluster_script),
                '--gallery', str(gallery_path),
                '--output', str(cluster_output)
            ], f"Step {steps_total}: Clustering & Layout")
            
            if success:
                steps_completed += 1
    
    # Summary
    print(f"\n{'='*60}")
    print(f"✅ Pipeline Complete ({steps_completed}/{steps_total} steps succeeded)")
    print(f"{'='*60}")
    print(f"\n📂 Generated files:")
    
    if edges_output.exists():
        size_mb = edges_output.stat().st_size / (1024 * 1024)
        print(f"   {edges_output} ({size_mb:.2f}MB)")
    
    if args.find_duplicates and (output_dir / "duplicates.json").exists():
        print(f"   {output_dir / 'duplicates.json'}")
    
    if args.cluster and (output_dir / "clusters.json").exists():
        print(f"   {output_dir / 'clusters.json'}")
    
    print(f"\n💡 Next step: Generate frontend data with:")
    print(f"   npx tsx scripts/generate-local-data.ts \\")
    print(f"       --source {gallery_path} \\")
    print(f"       --edges {edges_output}")


if __name__ == "__main__":
    main()

