# Envelope Encryption Implementation Plan

## Overview

This document provides a detailed implementation plan for adding envelope encryption to PixNdx. The implementation is designed to be incremental, with each phase independently deployable and reversible.

**Timeline Estimate:** 8-12 weeks
**Risk Level:** High (data migration, crypto implementation)
**Rollback Strategy:** Each phase can be independently rolled back

---

## Table of Contents

1. [Architecture Components](#architecture-components)
2. [Implementation Phases](#implementation-phases)
3. [Phase 1: Infrastructure Setup](#phase-1-infrastructure-setup)
4. [Phase 2: User Key Management](#phase-2-user-key-management)
5. [Phase 3: Encryption Pipeline](#phase-3-encryption-pipeline)
6. [Phase 4: Decryption & Viewing](#phase-4-decryption--viewing)
7. [Phase 5: Sharing Implementation](#phase-5-sharing-implementation)
8. [Phase 6: Migration](#phase-6-migration)
9. [Data State Transitions](#data-state-transitions)
10. [User State Transitions](#user-state-transitions)
11. [Rollback Procedures](#rollback-procedures)
12. [Testing Strategy](#testing-strategy)

---

## Architecture Components

### New AWS Resources Required

| Resource | Purpose | Estimated Cost |
|----------|---------|----------------|
| **Aurora PostgreSQL Serverless v2** | User keys, image metadata, access grants | $50-150/mo |
| **KMS CMK** | Encrypt user private keys | $1/mo + API calls |
| **Lambda (decrypt-image)** | Fetch and prepare encrypted blobs | ~$5/mo |
| **Lambda (encrypt-image)** | Encrypt after GPU processing | ~$5/mo |
| **Lambda (manage-access)** | Handle sharing/revocation | ~$2/mo |

### Modified Components

| Component | Changes |
|-----------|---------|
| **GPU processor** | Add encryption step after AI processing |
| **Frontend** | Add client-side decryption (WebCrypto API) |
| **CloudFront** | Remove caching, serve encrypted blobs |
| **DynamoDB** | Migrate to Aurora (or keep for non-sensitive data) |

---

## Implementation Phases

```
┌─────────────────────────────────────────────────────────────────┐
│  IMPLEMENTATION TIMELINE                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Week 1-2:  Phase 1 - Infrastructure Setup                     │
│             ├── Aurora PostgreSQL cluster                       │
│             ├── KMS CMK                                         │
│             └── IAM roles and policies                          │
│                                                                 │
│  Week 3-4:  Phase 2 - User Key Management                      │
│             ├── Key generation on signup                        │
│             ├── Key storage in Aurora                           │
│             └── Key retrieval API                               │
│                                                                 │
│  Week 5-6:  Phase 3 - Encryption Pipeline                      │
│             ├── GPU processor encryption step                   │
│             ├── Encrypted blob storage                          │
│             └── Wrapped DEK storage                             │
│                                                                 │
│  Week 7-8:  Phase 4 - Decryption & Viewing                     │
│             ├── Frontend WebCrypto integration                  │
│             ├── Encrypted blob fetching                         │
│             └── Client-side decryption                          │
│                                                                 │
│  Week 9-10: Phase 5 - Sharing Implementation                   │
│             ├── Share UI                                        │
│             ├── DEK re-wrapping                                 │
│             └── Access management                               │
│                                                                 │
│  Week 11-12: Phase 6 - Migration                               │
│              ├── Existing image encryption                      │
│              ├── Data validation                                │
│              └── Cutover                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Infrastructure Setup

### Objectives
- Provision Aurora PostgreSQL cluster
- Create KMS CMK for key encryption
- Set up IAM roles and VPC connectivity

### Tasks

#### 1.1 Aurora PostgreSQL Cluster

```typescript
// amplify/backend.ts additions

import * as rds from 'aws-cdk-lib/aws-rds';

// Aurora Serverless v2 cluster
const auroraCluster = new rds.DatabaseCluster(stack, 'PixndxAurora', {
  engine: rds.DatabaseClusterEngine.auroraPostgres({
    version: rds.AuroraPostgresEngineVersion.VER_15_4,
  }),
  serverlessV2MinCapacity: 0.5,  // Minimum ACUs (scales to 0 when idle)
  serverlessV2MaxCapacity: 4,    // Maximum ACUs
  writer: rds.ClusterInstance.serverlessV2('writer'),
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
  securityGroups: [auroraSecurityGroup],
  defaultDatabaseName: 'pixndx',
  credentials: rds.Credentials.fromGeneratedSecret('pixndx_admin', {
    secretName: 'pixndx/aurora-credentials',
  }),
  storageEncrypted: true,
  deletionProtection: true,
  backup: {
    retention: cdk.Duration.days(7),
  },
});

// Enable pgvector extension (for CLIP embeddings)
// Run after cluster creation:
// CREATE EXTENSION IF NOT EXISTS vector;
```

**Cost Control:**
- Serverless v2 scales to 0.5 ACU when idle (~$43/month minimum)
- Set max capacity based on expected load
- Consider Aurora I/O Optimized for read-heavy workloads

#### 1.2 KMS Customer Master Key

```typescript
// amplify/backend.ts additions

import * as kms from 'aws-cdk-lib/aws-kms';

const userKeysCmk = new kms.Key(stack, 'UserKeysCMK', {
  alias: 'pixndx/user-keys',
  description: 'CMK for encrypting user private keys',
  enableKeyRotation: true,  // Automatic annual rotation
  removalPolicy: cdk.RemovalPolicy.RETAIN,  // Never delete!
  policy: new iam.PolicyDocument({
    statements: [
      // Allow account root full access
      new iam.PolicyStatement({
        principals: [new iam.AccountRootPrincipal()],
        actions: ['kms:*'],
        resources: ['*'],
      }),
      // Allow specific Lambdas to encrypt/decrypt
      new iam.PolicyStatement({
        principals: [
          encryptImageLambda.role!,
          decryptImageLambda.role!,
          userKeyManagementLambda.role!,
        ],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:GenerateDataKey',
        ],
        resources: ['*'],
      }),
    ],
  }),
});
```

#### 1.3 Security Groups

```typescript
// Aurora security group
const auroraSecurityGroup = new ec2.SecurityGroup(stack, 'AuroraSecurityGroup', {
  vpc,
  description: 'Security group for Aurora PostgreSQL',
  allowAllOutbound: false,
});

// Allow inbound from Lambda
auroraSecurityGroup.addIngressRule(
  lambdaSecurityGroup,
  ec2.Port.tcp(5432),
  'Allow PostgreSQL from Lambda'
);

// Allow inbound from GPU instances
auroraSecurityGroup.addIngressRule(
  gpuSecurityGroup,
  ec2.Port.tcp(5432),
  'Allow PostgreSQL from GPU'
);
```

### Data State After Phase 1

| Component | State |
|-----------|-------|
| Aurora cluster | Running, empty database |
| KMS CMK | Created, no keys encrypted yet |
| Existing images | Unchanged (still SSE-S3) |
| Existing users | Unchanged (Cognito only) |

### Validation Checklist

- [ ] Aurora cluster accessible from Lambda
- [ ] Aurora cluster accessible from GPU VPC
- [ ] KMS CMK created with correct policy
- [ ] Database schema deployed (tables created)
- [ ] pgvector extension enabled

### Rollback Procedure

```bash
# Phase 1 rollback: Delete Aurora cluster
# WARNING: Data loss if any data was written

# 1. Remove CDK resources
cdk destroy --exclusively PixndxAuroraStack

# 2. Or via AWS CLI (if CDK fails)
aws rds delete-db-cluster \
  --db-cluster-identifier pixndx-aurora \
  --skip-final-snapshot

# KMS key: Just disable, don't delete (in case needed later)
aws kms disable-key --key-id alias/pixndx/user-keys
```

---

## Phase 2: User Key Management

### Objectives
- Generate RSA key pairs for users on signup
- Store public keys plaintext, private keys encrypted by KMS
- Provide API for key retrieval

### Tasks

#### 2.1 Cognito Post-Confirmation Trigger

```typescript
// amplify/functions/userKeyGeneration/handler.ts

import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';
import { Pool } from 'pg';
import * as crypto from 'crypto';

const kms = new KMSClient({});
const KMS_KEY_ID = process.env.USER_KEYS_CMK_ARN!;

// Database connection pool
const pool = new Pool({
  host: process.env.AURORA_HOST,
  database: 'pixndx',
  user: process.env.AURORA_USER,
  password: process.env.AURORA_PASSWORD,
  ssl: { rejectUnauthorized: true },
});

export const handler = async (event: any) => {
  const { sub, email } = event.request.userAttributes;

  // 1. Generate RSA-2048 key pair
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // 2. Encrypt private key with KMS
  const encryptResult = await kms.send(new EncryptCommand({
    KeyId: KMS_KEY_ID,
    Plaintext: Buffer.from(privateKey),
    EncryptionContext: {
      userId: sub,
      purpose: 'user-private-key',
    },
  }));

  // 3. Store in Aurora
  await pool.query(`
    INSERT INTO users (cognito_sub, email, public_key, private_key_encrypted, private_key_kms_key_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (cognito_sub) DO NOTHING
  `, [
    sub,
    email,
    publicKey,
    encryptResult.CiphertextBlob,
    KMS_KEY_ID,
  ]);

  // Return event for Cognito (required)
  return event;
};
```

#### 2.2 Key Retrieval Lambda

```typescript
// amplify/functions/getUserKeys/handler.ts

import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import { Pool } from 'pg';

export const handler = async (event: any) => {
  const cognitoSub = event.identity.sub;  // From Cognito authorizer

  // 1. Get user's encrypted private key from Aurora
  const result = await pool.query(`
    SELECT public_key, private_key_encrypted, private_key_kms_key_id
    FROM users
    WHERE cognito_sub = $1
  `, [cognitoSub]);

  if (result.rows.length === 0) {
    throw new Error('User not found');
  }

  const { public_key, private_key_encrypted, private_key_kms_key_id } = result.rows[0];

  // 2. Decrypt private key with KMS
  const decryptResult = await kms.send(new DecryptCommand({
    CiphertextBlob: private_key_encrypted,
    KeyId: private_key_kms_key_id,
    EncryptionContext: {
      userId: cognitoSub,
      purpose: 'user-private-key',
    },
  }));

  // 3. Return keys (private key transmitted over TLS, short-lived in memory)
  return {
    publicKey: public_key,
    privateKey: Buffer.from(decryptResult.Plaintext!).toString('utf-8'),
  };
};
```

#### 2.3 Frontend Key Caching

```typescript
// src/lib/encryption/keyManager.ts

import { generateClient } from 'aws-amplify/data';

class KeyManager {
  private privateKey: CryptoKey | null = null;
  private publicKey: CryptoKey | null = null;
  private keyExpiry: number = 0;

  async getKeys(): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> {
    // Return cached keys if still valid (cache for 5 minutes)
    if (this.privateKey && this.publicKey && Date.now() < this.keyExpiry) {
      return { privateKey: this.privateKey, publicKey: this.publicKey };
    }

    // Fetch from server
    const client = generateClient();
    const response = await client.queries.getUserKeys();

    // Import into WebCrypto (non-extractable for security)
    this.privateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToArrayBuffer(response.privateKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,  // NOT extractable
      ['decrypt', 'unwrapKey']
    );

    this.publicKey = await crypto.subtle.importKey(
      'spki',
      pemToArrayBuffer(response.publicKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,  // Extractable (needed for sharing)
      ['encrypt', 'wrapKey']
    );

    this.keyExpiry = Date.now() + 5 * 60 * 1000;  // 5 minute cache

    return { privateKey: this.privateKey, publicKey: this.publicKey };
  }

  clearKeys(): void {
    this.privateKey = null;
    this.publicKey = null;
    this.keyExpiry = 0;
  }
}

export const keyManager = new KeyManager();
```

### Data State After Phase 2

| Component | State |
|-----------|-------|
| Aurora users table | Populated for new signups |
| Existing users | No keys yet (need migration or on-demand generation) |
| KMS | Encrypting private keys |
| Images | Still unchanged |

### User State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│  USER STATES - PHASE 2                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  New User Signup:                                               │
│  ────────────────                                               │
│                                                                 │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│  │ Cognito  │────>│ Lambda   │────>│ Aurora   │               │
│  │ confirms │     │ generates│     │ stores   │               │
│  │ email    │     │ key pair │     │ keys     │               │
│  └──────────┘     └──────────┘     └──────────┘               │
│                                                                 │
│  User state: KEYS_GENERATED                                     │
│                                                                 │
│  Existing User (login):                                         │
│  ──────────────────────                                         │
│                                                                 │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│  │ User     │────>│ Check    │────>│ Generate │               │
│  │ logs in  │     │ Aurora   │     │ if no    │               │
│  │          │     │ for keys │     │ keys     │               │
│  └──────────┘     └──────────┘     └──────────┘               │
│                                                                 │
│  User state: KEYS_GENERATED (after first login)                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Validation Checklist

- [ ] New user signup generates key pair
- [ ] Keys stored correctly in Aurora
- [ ] Private key encrypted by KMS
- [ ] Key retrieval works for logged-in user
- [ ] Keys cached in browser correctly
- [ ] Existing users get keys on first login

### Rollback Procedure

```bash
# Phase 2 rollback: Remove Cognito trigger, keep data

# 1. Remove Cognito post-confirmation trigger
aws cognito-idp update-user-pool \
  --user-pool-id YOUR_POOL_ID \
  --lambda-config "{}"

# 2. Data in Aurora is harmless (just orphaned keys)
# Can delete later if needed:
# DELETE FROM users WHERE created_at > 'phase2-start-date';
```

---

## Phase 3: Encryption Pipeline

### Objectives
- Modify GPU processor to encrypt images after AI processing
- Store encrypted blobs in S3
- Store wrapped DEKs in Aurora

### Tasks

#### 3.1 Modify GPU Processor

```python
# scripts/process_images.py - additions

import boto3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
import os
import psycopg2

kms = boto3.client('kms')
s3 = boto3.client('s3')

def encrypt_and_store_image(
    image_data: bytes,
    image_id: str,
    owner_cognito_sub: str,
    metadata: dict,
    clip_embedding: list,
) -> None:
    """
    Encrypt image and store with wrapped DEK.
    Called AFTER AI processing completes.
    """

    # 1. Generate random DEK (256 bits)
    dek = os.urandom(32)
    iv = os.urandom(12)  # 96-bit IV for AES-GCM

    # 2. Encrypt image with DEK
    aesgcm = AESGCM(dek)
    encrypted_image = aesgcm.encrypt(iv, image_data, None)

    # 3. Get owner's public key from Aurora
    conn = get_aurora_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, public_key FROM users WHERE cognito_sub = %s
    """, (owner_cognito_sub,))
    owner_id, public_key_pem = cur.fetchone()

    # 4. Wrap DEK with owner's public key
    public_key = serialization.load_pem_public_key(public_key_pem.encode())
    wrapped_dek = public_key.encrypt(
        dek,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None
        )
    )

    # 5. Upload encrypted blob to S3
    s3_key = f'encrypted/{image_id}.enc'
    s3.put_object(
        Bucket=STORAGE_BUCKET,
        Key=s3_key,
        Body=encrypted_image,
        ContentType='application/octet-stream',
        Metadata={
            'encryption-algorithm': 'AES-256-GCM',
            'original-content-type': 'image/jpeg',
        }
    )

    # 6. Store metadata and wrapped DEK in Aurora
    cur.execute("""
        INSERT INTO images (
            id, owner_id, s3_bucket, s3_key_encrypted,
            encryption_iv, description, mood, main_subject,
            tags, main_colors, clip_embedding, processed_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
        )
    """, (
        image_id,
        owner_id,
        STORAGE_BUCKET,
        s3_key,
        iv,
        metadata.get('description'),
        metadata.get('mood'),
        metadata.get('main_subject'),
        json.dumps(metadata.get('tags', {})),
        json.dumps(metadata.get('main_colors', {})),
        clip_embedding,  # pgvector handles this
    ))

    # 7. Grant owner access (store wrapped DEK)
    cur.execute("""
        INSERT INTO image_access (image_id, user_id, wrapped_dek, granted_by)
        VALUES (%s, %s, %s, %s)
    """, (image_id, owner_id, wrapped_dek, owner_id))

    conn.commit()

    # 8. Delete plaintext from memory (Python GC will handle, but be explicit)
    del image_data
    del dek

    print(f"  Encrypted and stored: {image_id}")


# Modify process_single_image() to call encrypt_and_store_image()
# at the end instead of storing plaintext
```

#### 3.2 Update S3 Structure

```
BEFORE (plaintext):
s3://bucket/
  images/
    small/image1.jpg    (plaintext)
    medium/image1.jpg   (plaintext)
    full/image1.jpg     (plaintext)

AFTER (encrypted):
s3://bucket/
  encrypted/
    {image_id}.enc      (AES-256-GCM encrypted)
  legacy/               (migrated plaintext, eventually deleted)
    images/
      small/...
      medium/...
      full/...
```

**Note:** We store one encrypted blob per image (full resolution). Thumbnails are generated client-side after decryption, or we can store encrypted thumbnails separately.

### Data State After Phase 3

| Component | State |
|-----------|-------|
| New images | Encrypted in S3, wrapped DEK in Aurora |
| Existing images | Still plaintext (migration pending) |
| Aurora images table | Contains new encrypted images |
| Aurora image_access | Contains wrapped DEKs for owners |

### Validation Checklist

- [ ] GPU processor generates DEK correctly
- [ ] Images encrypted with AES-256-GCM
- [ ] Encrypted blobs stored in S3
- [ ] Wrapped DEKs stored in Aurora
- [ ] Owner has access grant in image_access
- [ ] Plaintext deleted from GPU memory
- [ ] No plaintext stored in S3 for new images

### Rollback Procedure

```bash
# Phase 3 rollback: Revert GPU processor, keep encrypted images

# 1. Deploy previous GPU processor version
git checkout HEAD~1 -- scripts/process_images.py
# Redeploy to GPU instances

# 2. Encrypted images in S3 are harmless (just unused blobs)
# Can delete later:
# aws s3 rm s3://bucket/encrypted/ --recursive

# 3. Aurora data can be cleaned:
# DELETE FROM image_access WHERE image_id IN (SELECT id FROM images WHERE processed_at > 'phase3-start');
# DELETE FROM images WHERE processed_at > 'phase3-start';
```

---

## Phase 4: Decryption & Viewing

### Objectives
- Implement client-side decryption in browser
- Fetch encrypted blobs instead of plaintext
- Display decrypted images

### Tasks

#### 4.1 Encrypted Image Fetcher

```typescript
// src/lib/encryption/imageFetcher.ts

import { keyManager } from './keyManager';

interface EncryptedImageData {
  encryptedBlob: ArrayBuffer;
  wrappedDek: ArrayBuffer;
  iv: Uint8Array;
}

export async function fetchEncryptedImage(imageId: string): Promise<EncryptedImageData> {
  // 1. Get image metadata and wrapped DEK from API
  const response = await fetch(`/api/images/${imageId}/encrypted`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const metadata = await response.json();

  // 2. Fetch encrypted blob from S3
  const blobResponse = await fetch(metadata.encryptedBlobUrl);
  const encryptedBlob = await blobResponse.arrayBuffer();

  return {
    encryptedBlob,
    wrappedDek: base64ToArrayBuffer(metadata.wrappedDek),
    iv: base64ToArrayBuffer(metadata.iv),
  };
}
```

#### 4.2 Client-Side Decryption

```typescript
// src/lib/encryption/imageDecryptor.ts

import { keyManager } from './keyManager';

export async function decryptImage(
  encryptedBlob: ArrayBuffer,
  wrappedDek: ArrayBuffer,
  iv: Uint8Array,
): Promise<Blob> {
  // 1. Get user's private key
  const { privateKey } = await keyManager.getKeys();

  // 2. Unwrap the DEK
  const dek = await crypto.subtle.unwrapKey(
    'raw',
    wrappedDek,
    privateKey,
    { name: 'RSA-OAEP' },
    { name: 'AES-GCM' },
    false,  // Not extractable
    ['decrypt']
  );

  // 3. Decrypt the image
  const decryptedData = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dek,
    encryptedBlob
  );

  // 4. Return as blob for display
  return new Blob([decryptedData], { type: 'image/jpeg' });
}
```

#### 4.3 Protected Image Component (Updated)

```typescript
// src/components/Gallery/ProtectedImage.tsx - updated

import { useState, useEffect } from 'react';
import { fetchEncryptedImage, decryptImage } from '@/lib/encryption';

export function ProtectedImage({ imageId, alt, className, size }: ProtectedImageProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    let objectUrl: string | null = null;

    async function loadImage() {
      try {
        setIsLoading(true);
        setError(null);

        // 1. Fetch encrypted image data
        const { encryptedBlob, wrappedDek, iv } = await fetchEncryptedImage(imageId);

        // 2. Decrypt in browser
        const decryptedBlob = await decryptImage(encryptedBlob, wrappedDek, iv);

        // 3. Create object URL for display
        objectUrl = URL.createObjectURL(decryptedBlob);

        if (mounted) {
          setImageUrl(objectUrl);
          setIsLoading(false);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error('Decryption failed'));
          setIsLoading(false);
        }
      }
    }

    loadImage();

    return () => {
      mounted = false;
      // Clean up object URL to free memory
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [imageId]);

  if (error) {
    return <div className="error">Failed to load image</div>;
  }

  if (isLoading) {
    return <div className="loading">Decrypting...</div>;
  }

  return (
    <img
      src={imageUrl!}
      alt={alt}
      className={className}
      // Existing protection attributes...
    />
  );
}
```

#### 4.4 Performance Optimization: Thumbnail Generation

```typescript
// src/lib/encryption/thumbnailGenerator.ts

export async function generateThumbnail(
  decryptedBlob: Blob,
  maxSize: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate thumbnail dimensions
      const ratio = Math.min(maxSize / img.width, maxSize / img.height);
      const width = img.width * ratio;
      const height = img.height * ratio;

      // Draw to canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to blob
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Thumbnail failed')),
        'image/jpeg',
        0.8
      );

      // Clean up
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(decryptedBlob);
  });
}
```

### Data State After Phase 4

| Component | State |
|-----------|-------|
| New images | Full encryption pipeline working |
| Viewing | Client-side decryption for new images |
| Existing images | Still using old CloudFront path |
| CDN | No longer caching new images |

### User Experience Impact

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| First image load | ~200ms | ~800-1500ms | +600-1300ms |
| Cached image load | ~50ms | ~500-1000ms | +450-950ms |
| Memory usage | Low | Higher (decrypted images in RAM) | ~2-3x |
| CPU usage | Low | Moderate (decryption) | +20-30% |

### Validation Checklist

- [ ] Encrypted images fetch correctly
- [ ] Client-side decryption works
- [ ] Images display correctly after decryption
- [ ] Memory is cleaned up (object URLs revoked)
- [ ] Loading states shown during decryption
- [ ] Error handling for decryption failures
- [ ] Performance acceptable on mobile devices

### Rollback Procedure

```bash
# Phase 4 rollback: Revert frontend to use CloudFront

# 1. Deploy previous frontend version
git checkout HEAD~1 -- src/components/Gallery/ProtectedImage.tsx
npm run build && npm run deploy

# 2. No data changes needed - encrypted images still accessible
# via old code path (will just 404 since old path doesn't exist)
```

---

## Phase 5: Sharing Implementation

### Objectives
- Implement share UI for image owners
- DEK re-wrapping for viewers
- Access management (grant/revoke)

### Tasks

#### 5.1 Share API

```typescript
// amplify/functions/shareImage/handler.ts

export const handler = async (event: any) => {
  const { imageId, viewerEmail } = event.arguments;
  const ownerSub = event.identity.sub;

  // 1. Verify owner has access to this image
  const ownerAccess = await pool.query(`
    SELECT ia.wrapped_dek, i.owner_id, u.id as owner_user_id
    FROM image_access ia
    JOIN images i ON i.id = ia.image_id
    JOIN users u ON u.cognito_sub = $2
    WHERE ia.image_id = $1 AND u.cognito_sub = $2
  `, [imageId, ownerSub]);

  if (ownerAccess.rows.length === 0) {
    throw new Error('Not authorized to share this image');
  }

  // 2. Get viewer's public key
  const viewer = await pool.query(`
    SELECT id, public_key FROM users WHERE email = $1
  `, [viewerEmail]);

  if (viewer.rows.length === 0) {
    throw new Error('Viewer not found');
  }

  // 3. Return data needed for client-side DEK re-wrapping
  // Client will:
  //   a. Decrypt owner's wrapped DEK with owner's private key
  //   b. Re-encrypt DEK with viewer's public key
  //   c. Send back to server

  return {
    viewerId: viewer.rows[0].id,
    viewerPublicKey: viewer.rows[0].public_key,
    ownerWrappedDek: ownerAccess.rows[0].wrapped_dek.toString('base64'),
  };
};
```

#### 5.2 Complete Share (store viewer's wrapped DEK)

```typescript
// amplify/functions/completeShare/handler.ts

export const handler = async (event: any) => {
  const { imageId, viewerId, viewerWrappedDek } = event.arguments;
  const ownerSub = event.identity.sub;

  // Verify owner still has access
  const ownerCheck = await pool.query(`
    SELECT 1 FROM image_access ia
    JOIN users u ON u.id = ia.user_id
    WHERE ia.image_id = $1 AND u.cognito_sub = $2
  `, [imageId, ownerSub]);

  if (ownerCheck.rows.length === 0) {
    throw new Error('Not authorized');
  }

  // Get owner's user ID
  const owner = await pool.query(`
    SELECT id FROM users WHERE cognito_sub = $1
  `, [ownerSub]);

  // Store viewer's wrapped DEK
  await pool.query(`
    INSERT INTO image_access (image_id, user_id, wrapped_dek, granted_by, access_level)
    VALUES ($1, $2, $3, $4, 'view')
    ON CONFLICT (image_id, user_id) DO UPDATE SET
      wrapped_dek = EXCLUDED.wrapped_dek,
      granted_at = NOW()
  `, [imageId, viewerId, Buffer.from(viewerWrappedDek, 'base64'), owner.rows[0].id]);

  return { success: true };
};
```

#### 5.3 Frontend Share Flow

```typescript
// src/components/Share/ShareDialog.tsx

async function shareImage(imageId: string, viewerEmail: string) {
  const { privateKey } = await keyManager.getKeys();

  // 1. Get sharing data from server
  const shareData = await client.mutations.initiateShare({ imageId, viewerEmail });

  // 2. Unwrap DEK with my private key
  const dek = await crypto.subtle.unwrapKey(
    'raw',
    base64ToArrayBuffer(shareData.ownerWrappedDek),
    privateKey,
    { name: 'RSA-OAEP' },
    { name: 'AES-GCM' },
    true,  // Extractable (need to re-wrap)
    ['encrypt', 'decrypt']
  );

  // 3. Import viewer's public key
  const viewerPublicKey = await crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(shareData.viewerPublicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['wrapKey']
  );

  // 4. Re-wrap DEK for viewer
  const viewerWrappedDek = await crypto.subtle.wrapKey(
    'raw',
    dek,
    viewerPublicKey,
    { name: 'RSA-OAEP' }
  );

  // 5. Complete share
  await client.mutations.completeShare({
    imageId,
    viewerId: shareData.viewerId,
    viewerWrappedDek: arrayBufferToBase64(viewerWrappedDek),
  });

  return { success: true };
}
```

### Validation Checklist

- [ ] Share UI works for image owners
- [ ] Viewer lookup by email works
- [ ] DEK unwrap/re-wrap works client-side
- [ ] Viewer's wrapped DEK stored correctly
- [ ] Viewer can decrypt shared image
- [ ] Non-owners cannot share
- [ ] Revocation removes access

---

## Phase 6: Migration

### Objectives
- Encrypt existing plaintext images
- Migrate metadata to Aurora
- Validate and cutover

### Tasks

#### 6.1 Migration Script

```python
# scripts/migrate_to_encrypted.py

import boto3
from concurrent.futures import ThreadPoolExecutor

def migrate_image(image_record):
    """Migrate single image from plaintext to encrypted."""
    image_id = image_record['id']

    try:
        # 1. Download plaintext image from S3
        response = s3.get_object(
            Bucket=STORAGE_BUCKET,
            Key=f'images/full/{image_id}.jpg'
        )
        plaintext_data = response['Body'].read()

        # 2. Get owner info
        owner_id = image_record['owner']  # From DynamoDB

        # 3. Encrypt and store (reuse existing function)
        encrypt_and_store_image(
            image_data=plaintext_data,
            image_id=image_id,
            owner_cognito_sub=owner_id,
            metadata={
                'description': image_record.get('description'),
                'mood': image_record.get('mood'),
                'main_subject': image_record.get('mainSubject'),
                'tags': image_record.get('tags', {}),
                'main_colors': image_record.get('mainColors', {}),
            },
            clip_embedding=image_record.get('clipEmbedding'),
        )

        # 4. Mark as migrated (don't delete yet)
        dynamodb.update_item(
            TableName=DYNAMODB_TABLE,
            Key={'id': image_id},
            UpdateExpression='SET migrated = :true, migratedAt = :now',
            ExpressionAttributeValues={
                ':true': True,
                ':now': datetime.utcnow().isoformat(),
            }
        )

        return {'id': image_id, 'status': 'success'}

    except Exception as e:
        return {'id': image_id, 'status': 'error', 'error': str(e)}


def run_migration(batch_size=100, max_workers=4):
    """Run migration in batches."""

    # Get all unmigrated images
    images = scan_unmigrated_images()
    total = len(images)

    print(f"Migrating {total} images...")

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        results = list(executor.map(migrate_image, images))

    success = sum(1 for r in results if r['status'] == 'success')
    errors = [r for r in results if r['status'] == 'error']

    print(f"Migration complete: {success}/{total} successful")
    if errors:
        print(f"Errors: {len(errors)}")
        for e in errors[:10]:
            print(f"  - {e['id']}: {e['error']}")


if __name__ == '__main__':
    run_migration()
```

#### 6.2 Validation Script

```python
# scripts/validate_migration.py

def validate_image(image_id):
    """Validate migrated image can be decrypted."""

    # 1. Get from Aurora
    cur.execute("""
        SELECT s3_key_encrypted, encryption_iv
        FROM images WHERE id = %s
    """, (image_id,))
    row = cur.fetchone()

    if not row:
        return {'id': image_id, 'status': 'error', 'error': 'Not in Aurora'}

    # 2. Fetch encrypted blob
    response = s3.get_object(Bucket=STORAGE_BUCKET, Key=row['s3_key_encrypted'])
    encrypted_data = response['Body'].read()

    # 3. Get owner's wrapped DEK
    cur.execute("""
        SELECT ia.wrapped_dek, u.private_key_encrypted, u.private_key_kms_key_id
        FROM image_access ia
        JOIN users u ON u.id = ia.user_id
        JOIN images i ON i.id = ia.image_id AND i.owner_id = u.id
        WHERE ia.image_id = %s
    """, (image_id,))
    access = cur.fetchone()

    # 4. Decrypt private key via KMS
    private_key_pem = kms.decrypt(
        CiphertextBlob=access['private_key_encrypted'],
        KeyId=access['private_key_kms_key_id'],
    )['Plaintext']

    # 5. Unwrap DEK
    private_key = serialization.load_pem_private_key(private_key_pem, password=None)
    dek = private_key.decrypt(access['wrapped_dek'], padding.OAEP(...))

    # 6. Decrypt image
    aesgcm = AESGCM(dek)
    decrypted = aesgcm.decrypt(row['encryption_iv'], encrypted_data, None)

    # 7. Validate it's a valid image
    img = Image.open(BytesIO(decrypted))
    img.verify()

    return {'id': image_id, 'status': 'valid', 'size': len(decrypted)}
```

#### 6.3 Cutover Procedure

```
┌─────────────────────────────────────────────────────────────────┐
│  CUTOVER PROCEDURE                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pre-cutover (1 week before):                                   │
│  ────────────────────────────                                   │
│  [ ] All images migrated                                        │
│  [ ] Validation script passes 100%                              │
│  [ ] Frontend tested with encrypted images                      │
│  [ ] Performance acceptable                                     │
│  [ ] Rollback procedure tested                                  │
│                                                                 │
│  Cutover day:                                                   │
│  ────────────                                                   │
│  [ ] 1. Enable maintenance mode                                 │
│  [ ] 2. Final migration sync (any new images)                   │
│  [ ] 3. Run validation on all images                            │
│  [ ] 4. Deploy frontend with encryption-only code               │
│  [ ] 5. Update CloudFront to not cache                          │
│  [ ] 6. Disable maintenance mode                                │
│  [ ] 7. Monitor for errors                                      │
│                                                                 │
│  Post-cutover (1 week after):                                   │
│  ─────────────────────────────                                  │
│  [ ] No errors reported                                         │
│  [ ] Performance metrics acceptable                             │
│  [ ] Delete plaintext images from S3                            │
│  [ ] Archive DynamoDB table                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data State Transitions

### Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA STATE TRANSITIONS                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Phase 1: Infrastructure                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ DynamoDB: existing images (unchanged)                   │   │
│  │ S3: plaintext images (unchanged)                        │   │
│  │ Aurora: empty database, schema deployed                 │   │
│  │ KMS: CMK created                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  Phase 2: User Keys                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ DynamoDB: unchanged                                     │   │
│  │ S3: unchanged                                           │   │
│  │ Aurora: users table populated (new signups)             │   │
│  │ KMS: encrypting private keys                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  Phase 3: Encryption Pipeline                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ DynamoDB: old images unchanged                          │   │
│  │ S3: new images encrypted in /encrypted/                 │   │
│  │ Aurora: new images + wrapped DEKs                       │   │
│  │ KMS: unchanged                                          │   │
│  │                                                         │   │
│  │ STATE: Dual-write (old images in DynamoDB/plaintext,   │   │
│  │        new images in Aurora/encrypted)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  Phase 4: Decryption                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Frontend: supports both encrypted and plaintext        │   │
│  │ New images: encrypted flow                              │   │
│  │ Old images: plaintext flow (temporary)                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  Phase 5: Sharing                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ image_access table: stores wrapped DEKs for sharing    │   │
│  │ Owner can share → viewer's wrapped DEK created          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                           │                                     │
│                           ▼                                     │
│  Phase 6: Migration                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ All images encrypted                                    │   │
│  │ All metadata in Aurora                                  │   │
│  │ DynamoDB: archived/deleted                              │   │
│  │ S3 plaintext: deleted                                   │   │
│  │                                                         │   │
│  │ FINAL STATE: All data encrypted, Aurora is source of   │   │
│  │              truth, envelope encryption active          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## User State Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│  USER STATE MACHINE                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐                                              │
│  │ COGNITO_ONLY │  ← Existing users before Phase 2             │
│  │              │                                              │
│  │ Has: Cognito │                                              │
│  │ No: Keys     │                                              │
│  └──────┬───────┘                                              │
│         │                                                       │
│         │ First login after Phase 2                            │
│         │ (trigger: login event)                               │
│         ▼                                                       │
│  ┌──────────────┐                                              │
│  │ KEYS_PENDING │  ← Keys being generated                      │
│  │              │                                              │
│  │ Has: Cognito │                                              │
│  │ Gen: Keys... │                                              │
│  └──────┬───────┘                                              │
│         │                                                       │
│         │ Key generation complete                               │
│         ▼                                                       │
│  ┌──────────────┐                                              │
│  │ KEYS_ACTIVE  │  ← Normal operating state                    │
│  │              │                                              │
│  │ Has: Cognito │                                              │
│  │ Has: Keys    │                                              │
│  │ Can: View    │                                              │
│  │ Can: Upload  │                                              │
│  │ Can: Share   │                                              │
│  └──────────────┘                                              │
│                                                                 │
│                                                                 │
│  New users (after Phase 2):                                     │
│  ──────────────────────────                                     │
│                                                                 │
│  ┌──────────────┐     ┌──────────────┐                        │
│  │ SIGNUP       │────>│ KEYS_ACTIVE  │                        │
│  │              │     │              │                        │
│  │ Cognito      │     │ Keys gen'd   │                        │
│  │ post-confirm │     │ on confirm   │                        │
│  │ trigger      │     │              │                        │
│  └──────────────┘     └──────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Rollback Procedures

### Global Rollback (Emergency)

```bash
#!/bin/bash
# emergency-rollback.sh
# Use only if critical issues in production

echo "=== EMERGENCY ROLLBACK ==="

# 1. Revert frontend to pre-encryption version
git checkout $LAST_GOOD_FRONTEND_COMMIT -- src/
npm run build
aws s3 sync dist/ s3://$FRONTEND_BUCKET/

# 2. Re-enable CloudFront caching
aws cloudfront update-distribution \
  --id $DISTRIBUTION_ID \
  --distribution-config file://old-distribution-config.json

# 3. Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"

# 4. GPU processor: revert to plaintext storage
git checkout $LAST_GOOD_GPU_COMMIT -- scripts/process_images.py
# Redeploy to GPU instances

# 5. Data is safe:
#    - Encrypted images remain in S3 (unused)
#    - Aurora data remains (unused)
#    - Original plaintext images still exist (if not deleted)

echo "Rollback complete. Encrypted images preserved for recovery."
```

### Per-Phase Rollback

See individual phase sections above for specific rollback procedures.

---

## Testing Strategy

### Unit Tests

```typescript
// tests/encryption/keyManager.test.ts
describe('KeyManager', () => {
  it('generates valid RSA key pair', async () => {});
  it('encrypts private key with KMS', async () => {});
  it('decrypts private key correctly', async () => {});
  it('caches keys for 5 minutes', async () => {});
});

// tests/encryption/imageEncryption.test.ts
describe('Image Encryption', () => {
  it('generates random DEK', () => {});
  it('encrypts image with AES-256-GCM', () => {});
  it('wraps DEK with RSA-OAEP', () => {});
  it('decrypts image correctly', () => {});
});
```

### Integration Tests

```typescript
// tests/integration/encryptionFlow.test.ts
describe('Full Encryption Flow', () => {
  it('upload → encrypt → store → retrieve → decrypt', async () => {});
  it('share → viewer can decrypt', async () => {});
  it('revoke → viewer cannot decrypt', async () => {});
});
```

### Performance Tests

```typescript
// tests/performance/decryption.test.ts
describe('Decryption Performance', () => {
  it('decrypts 1MB image in < 500ms', async () => {});
  it('decrypts 10MB image in < 2000ms', async () => {});
  it('handles 10 concurrent decryptions', async () => {});
});
```

### Security Tests

```typescript
// tests/security/encryption.test.ts
describe('Security', () => {
  it('DEK is random and unique per image', () => {});
  it('cannot decrypt without private key', () => {});
  it('wrapped DEK is different per user', () => {});
  it('revoked user cannot access', () => {});
});
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

| Metric | Alert Threshold | Action |
|--------|-----------------|--------|
| Decryption latency P99 | > 3000ms | Investigate, consider caching |
| Decryption error rate | > 1% | Check KMS, check keys |
| KMS API errors | > 0.1% | Check KMS quota, permissions |
| Aurora connections | > 80% max | Scale up |
| Memory usage (client) | > 500MB | Optimize blob handling |

### CloudWatch Alarms

```typescript
// Add to backend.ts
new cloudwatch.Alarm(stack, 'DecryptionLatencyAlarm', {
  metric: decryptionLatencyMetric,
  threshold: 3000,
  evaluationPeriods: 3,
  alarmDescription: 'High decryption latency',
  actionsEnabled: true,
  alarmActions: [alertTopic],
});
```

---

## Success Criteria

### Phase Completion Criteria

| Phase | Criteria |
|-------|----------|
| **Phase 1** | Aurora accessible, KMS key created, schema deployed |
| **Phase 2** | New users get keys, existing users get keys on login |
| **Phase 3** | New uploads encrypted, wrapped DEKs stored |
| **Phase 4** | Client-side decryption works, images display |
| **Phase 5** | Sharing works, revocation works |
| **Phase 6** | All images migrated, validated, plaintext deleted |

### Overall Success Criteria

- [ ] All images encrypted at rest with per-image DEKs
- [ ] Only authorized users can decrypt (envelope encryption working)
- [ ] Sharing works without duplicating images
- [ ] Revocation immediately prevents access
- [ ] Performance acceptable (< 2s for 10MB image)
- [ ] Zero data loss during migration
- [ ] Audit trail for all access grants
