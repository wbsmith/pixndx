#!/usr/bin/env python3
"""Analyze CLIP similarity distribution."""

import boto3
import json
import numpy as np

s3 = boto3.client('s3')
bucket = 'amplify-d2lj29cnhp0ir0-ma-pixndxgallerystoragebuck-7fehfupmhbjm'

# Load all embeddings
print('Loading embeddings...')
embeddings = []
ids = []
paginator = s3.get_paginator('list_objects_v2')
for page in paginator.paginate(Bucket=bucket, Prefix='embeddings/'):
    for obj in page.get('Contents', []):
        if obj['Key'].endswith('.json'):
            resp = s3.get_object(Bucket=bucket, Key=obj['Key'])
            data = json.loads(resp['Body'].read())
            embeddings.append(data['embedding'])
            ids.append(data['id'])

print(f'Loaded {len(embeddings)} embeddings')

# Compute similarity matrix
E = np.array(embeddings, dtype=np.float32)
norms = np.linalg.norm(E, axis=1, keepdims=True)
E_norm = E / (norms + 1e-8)
sim = E_norm @ E_norm.T
np.fill_diagonal(sim, 0)  # ignore self-similarity

# Get upper triangle (unique pairs)
upper = sim[np.triu_indices(len(sim), k=1)]

print(f'\nCLIP Similarity Statistics ({len(upper):,} pairs):')
print(f'  Min: {upper.min():.4f}')
print(f'  Max: {upper.max():.4f}')
print(f'  Mean: {upper.mean():.4f}')
print(f'  Std: {upper.std():.4f}')
print(f'  Median: {np.median(upper):.4f}')

# Distribution
print(f'\nDistribution:')
for thresh in [0.99, 0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3]:
    count = (upper >= thresh).sum()
    pct = count / len(upper) * 100
    print(f'  >= {thresh}: {count:,} pairs ({pct:.2f}%)')

# Find pairs with similarity >= 0.99 (potential duplicates)
high_sim_indices = np.where(sim >= 0.99)
print(f'\nPairs with similarity >= 0.99:')
seen = set()
for i, j in zip(high_sim_indices[0], high_sim_indices[1]):
    if i < j and (i,j) not in seen:
        seen.add((i,j))
        print(f'  {ids[i]} <-> {ids[j]}: {sim[i,j]:.4f}')
        if len(seen) >= 20:
            remaining = sum(1 for x,y in zip(high_sim_indices[0], high_sim_indices[1]) if x < y) - 20
            if remaining > 0:
                print(f'  ... and {remaining} more')
            break

if len(seen) == 0:
    print('  None found')
