# PixNdx Security & Privacy Architecture

## Overview

This document describes the end-to-end encryption architecture for PixNdx, designed to provide strong privacy guarantees for users' photos while maintaining AI-powered search and discovery features.

**Security Philosophy:** Users' images should be encrypted at rest with keys that only authorized viewers can access. The server processes images once during upload (for AI indexing), then encrypts them. After encryption, even PixNdx operators cannot view the images.

---

## Table of Contents

1. [Current State vs. Target State](#current-state-vs-target-state)
2. [Threat Model](#threat-model)
3. [Encryption Architecture](#encryption-architecture)
4. [Key Hierarchy](#key-hierarchy)
5. [Data Flows](#data-flows)
6. [Database Schema](#database-schema)
7. [Cost Analysis](#cost-analysis)
8. [Security Guarantees](#security-guarantees)

---

## Current State vs. Target State

### Current State (Before Implementation)

| Component | Status | Risk |
|-----------|--------|------|
| Images at rest in S3 | SSE-S3 (AWS-managed keys) | AWS employees could theoretically access |
| Images in CloudFront cache | Plaintext | Cached at 400+ edge locations |
| Authentication | Cognito + signed cookies | Cookie theft = 24hr access to ALL images |
| Sharing | All authenticated users see all images | No per-user access control |
| Server access | Server can view all images | Insider threat, subpoena risk |

### Target State (After Implementation)

| Component | Status | Benefit |
|-----------|--------|---------|
| Images at rest in S3 | Per-image AES-256 encryption | Each image has unique key |
| Images in CDN | **No caching** (encrypted blobs only) | No plaintext at edge |
| Authentication | Cognito + envelope encryption | Stolen credentials can't decrypt without private key |
| Sharing | Per-user wrapped DEKs | Granular access control |
| Server access | Server cannot decrypt images | Zero-knowledge after processing |

---

## Threat Model

### Threats We Protect Against

| Threat | Protection |
|--------|------------|
| **Unauthorized internet access** | Cognito authentication required |
| **Credential theft** | Envelope encryption - credentials alone can't decrypt |
| **Insider threat (PixNdx employee)** | Server never has plaintext after initial processing |
| **AWS employee access** | Per-user encryption keys, not AWS-managed |
| **Database breach** | Only encrypted blobs and wrapped keys stored |
| **CDN cache exposure** | No plaintext caching - encrypted blobs only |
| **Bulk scraping** | Rate limiting + per-image decryption overhead |
| **Legal subpoena** | Cannot produce plaintext (don't have keys) |

### Threats We Accept

| Threat | Rationale |
|--------|-----------|
| **Initial upload exposure** | GPU must see plaintext for AI processing |
| **Client-side compromise** | If user's browser is compromised, attacker sees what user sees |
| **Key derivation weakness** | Mitigated by strong password requirements + optional MFA |
| **Quantum computing** | Future concern - can migrate to post-quantum algorithms |

---

## Encryption Architecture

### Envelope Encryption Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  ENVELOPE ENCRYPTION                                            │
│                                                                 │
│  Image encrypted ONCE with random DEK (Data Encryption Key)    │
│  DEK wrapped (encrypted) separately for each authorized user   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Encrypted Image Blob (10MB)                           │    │
│  │  AES-256-GCM encrypted with DEK                        │    │
│  └────────────────────────────────────────────────────────┘    │
│                            │                                    │
│                            │ DEK (32 bytes)                     │
│                            │                                    │
│       ┌────────────────────┼────────────────────┐              │
│       ▼                    ▼                    ▼              │
│  ┌─────────┐         ┌─────────┐         ┌─────────┐          │
│  │DEK enc. │         │DEK enc. │         │DEK enc. │   ...    │
│  │for      │         │for      │         │for      │          │
│  │Owner    │         │User B   │         │User C   │          │
│  │(~256 B) │         │(~256 B) │         │(~256 B) │          │
│  └─────────┘         └─────────┘         └─────────┘          │
│                                                                 │
│  Storage: 10MB + (256 bytes × N users) ≈ 10MB                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Envelope Encryption?

| Approach | Storage for 10MB image shared with 100 users |
|----------|---------------------------------------------|
| Encrypt per-user (naive) | 10MB × 100 = **1GB** |
| Envelope encryption | 10MB + (256B × 100) = **~10MB** |

The image is **never duplicated**. Only the tiny DEK (~256 bytes wrapped) is duplicated per user.

---

## Key Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│  KEY HIERARCHY                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  AWS KMS Customer Master Key (CMK)                              │
│  ════════════════════════════════                               │
│  • Managed in AWS KMS                                           │
│  • Used to encrypt user private keys at rest                    │
│  • Never leaves KMS (encryption/decryption via API)             │
│  • Automatic rotation available                                 │
│         │                                                       │
│         ▼                                                       │
│  User Key Pair (RSA-2048 or ECDSA P-256)                       │
│  ════════════════════════════════════════                       │
│  ┌─────────────────────────────────────┐                       │
│  │ Public Key      │  Private Key      │                       │
│  │                 │                   │                       │
│  │ Stored:         │  Stored:          │                       │
│  │ Plaintext in    │  Encrypted with   │                       │
│  │ Aurora (anyone  │  KMS CMK, stored  │                       │
│  │ can encrypt     │  in Aurora        │                       │
│  │ DEKs for user)  │                   │                       │
│  └─────────────────────────────────────┘                       │
│         │                   │                                   │
│         │                   │ (decrypted on-demand              │
│         │                   │  in Lambda/browser)               │
│         ▼                   ▼                                   │
│  Per-Image DEK (Data Encryption Key)                           │
│  ═══════════════════════════════════                           │
│  • Random 256-bit AES key                                      │
│  • Generated fresh for each image                              │
│  • Wrapped with each authorized user's public key              │
│  • Never stored plaintext                                      │
│         │                                                       │
│         ▼                                                       │
│  Encrypted Image                                                │
│  ═══════════════                                                │
│  • AES-256-GCM encrypted                                       │
│  • Stored in S3                                                │
│  • Decrypted only in authorized user's browser                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flows

### Upload Flow (with AI Processing)

```
┌─────────────────────────────────────────────────────────────────┐
│  UPLOAD FLOW                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Browser              GPU Instance              S3 + Aurora     │
│  ───────              ────────────              ───────────     │
│     │                      │                         │          │
│  1. User selects           │                         │          │
│     image                  │                         │          │
│     │                      │                         │          │
│  2. Upload plaintext ─────>│                         │          │
│     (TLS encrypted         │                         │          │
│      in transit)           │                         │          │
│                            │                         │          │
│                      3. TLS terminates               │          │
│                         Image in RAM                 │          │
│                         (plaintext)                  │          │
│                            │                         │          │
│                      4. AI Processing:               │          │
│                         • CLIP embedding             │          │
│                         • Gemma description          │          │
│                         • Color extraction           │          │
│                         • Tag generation             │          │
│                            │                         │          │
│                      5. Generate random DEK          │          │
│                         (32 bytes)                   │          │
│                            │                         │          │
│                      6. Encrypt image                │          │
│                         AES-256-GCM(DEK, image)      │          │
│                            │                         │          │
│                      7. Get owner's public key ─────>│          │
│                            │<─── public key ─────────│          │
│                            │                         │          │
│                      8. Wrap DEK with owner's        │          │
│                         public key                   │          │
│                            │                         │          │
│                      9. Store encrypted ────────────>│          │
│                         blob + wrapped DEK           │          │
│                         + metadata                   │          │
│                            │                         │          │
│                     10. DELETE plaintext             │          │
│                         from RAM                     │          │
│                            │                         │          │
│                                                                 │
│  SECURITY BOUNDARY:                                             │
│  ══════════════════                                             │
│  • Plaintext exists only in GPU RAM during steps 3-6           │
│  • After step 10, plaintext is gone forever                    │
│  • Server cannot decrypt (doesn't have owner's private key)    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Sharing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  SHARING FLOW                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Owner Browser            Server                Viewer          │
│  ─────────────            ──────                ──────          │
│       │                      │                     │            │
│  1. "Share image X          │                     │            │
│      with viewer@email"     │                     │            │
│       │                      │                     │            │
│  2. Request viewer's ───────>│                     │            │
│     public key               │                     │            │
│       │                      │                     │            │
│       │<─── viewer's ────────│                     │            │
│       │     public key       │                     │            │
│       │                      │                     │            │
│  3. Request my              │                     │            │
│     wrapped DEK ────────────>│                     │            │
│       │                      │                     │            │
│       │<─── my wrapped ──────│                     │            │
│       │     DEK              │                     │            │
│       │                      │                     │            │
│  4. Decrypt wrapped DEK      │                     │            │
│     with my private key      │                     │            │
│     (in browser RAM)         │                     │            │
│       │                      │                     │            │
│  5. Re-wrap DEK with         │                     │            │
│     viewer's public key      │                     │            │
│       │                      │                     │            │
│  6. Upload viewer's ────────>│                     │            │
│     wrapped DEK              │                     │            │
│       │                      │                     │            │
│       │                      │ Store in            │            │
│       │                      │ image_access        │            │
│       │                      │ table               │            │
│       │                      │                     │            │
│                                                                 │
│  SERVER NEVER SEES:                                             │
│  ══════════════════                                             │
│  • Plaintext DEK                                                │
│  • Owner's private key                                          │
│  • The actual image                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Viewing Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  VIEWING FLOW                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Viewer Browser              Server                 S3          │
│  ──────────────              ──────                 ──          │
│       │                         │                    │          │
│  1. Request image X             │                    │          │
│       │                         │                    │          │
│       │──── GET /images/X ─────>│                    │          │
│       │                         │                    │          │
│       │                         │─── Check access ──>│          │
│       │                         │    (image_access   │          │
│       │                         │     table)         │          │
│       │                         │                    │          │
│       │                         │<── encrypted ──────│          │
│       │                         │    blob            │          │
│       │                         │                    │          │
│       │<── encrypted blob ──────│                    │          │
│       │    + my wrapped DEK     │                    │          │
│       │    + IV                 │                    │          │
│       │                         │                    │          │
│  2. Get my private key          │                    │          │
│     (from local storage or      │                    │          │
│      KMS-decrypt from server)   │                    │          │
│       │                         │                    │          │
│  3. Unwrap DEK with my          │                    │          │
│     private key                 │                    │          │
│       │                         │                    │          │
│  4. Decrypt image with DEK      │                    │          │
│     (AES-256-GCM)               │                    │          │
│       │                         │                    │          │
│  5. Display image               │                    │          │
│     (plaintext in RAM only)     │                    │          │
│       │                         │                    │          │
│                                                                 │
│  LATENCY IMPACT:                                                │
│  ═══════════════                                                │
│  • No CDN caching (must fetch encrypted blob each time)        │
│  • KMS call for private key (~50ms)                            │
│  • RSA unwrap (~5ms)                                           │
│  • AES decrypt (~100-500ms for large image)                    │
│  • Total additional latency: ~200-800ms per image              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Revocation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  REVOCATION FLOW                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Simple Revocation (remove access):                             │
│  ───────────────────────────────────                            │
│  DELETE FROM image_access                                       │
│  WHERE image_id = X AND user_id = revoked_user;                │
│                                                                 │
│  • Immediate effect                                             │
│  • Revoked user can't get wrapped DEK anymore                  │
│  • ⚠️ User may have cached decrypted image locally             │
│                                                                 │
│  Strong Revocation (re-encrypt):                                │
│  ────────────────────────────────                               │
│  1. Generate new DEK                                            │
│  2. Re-encrypt image with new DEK                              │
│  3. Re-wrap new DEK for all remaining authorized users         │
│  4. Delete old encrypted blob                                   │
│  5. Delete all old wrapped DEKs                                │
│                                                                 │
│  • Invalidates any cached wrapped DEKs                         │
│  • Higher cost (re-encryption + re-wrapping)                   │
│  • Use for sensitive revocations                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Aurora PostgreSQL Schema

```sql
-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cognito_sub             TEXT UNIQUE NOT NULL,      -- Cognito identity
    email                   TEXT UNIQUE NOT NULL,

    -- Encryption keys
    public_key              TEXT NOT NULL,             -- RSA/ECDSA public key (PEM)
    private_key_encrypted   BYTEA NOT NULL,            -- Private key encrypted by KMS
    private_key_kms_key_id  TEXT NOT NULL,             -- KMS key ARN used for encryption

    -- Metadata
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX idx_users_email ON users(email);


-- ============================================================
-- IMAGES (metadata only, blob in S3)
-- ============================================================
CREATE TABLE images (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id                UUID NOT NULL REFERENCES users(id),

    -- S3 reference
    s3_bucket               TEXT NOT NULL,
    s3_key_encrypted        TEXT NOT NULL,             -- S3 key for encrypted blob

    -- Encryption parameters
    encryption_iv           BYTEA NOT NULL,            -- AES-GCM IV (12 bytes)
    encryption_algorithm    TEXT DEFAULT 'AES-256-GCM',

    -- AI-generated metadata (stored plaintext for search)
    description             TEXT,
    mood                    TEXT,
    main_subject            TEXT,
    tags                    JSONB DEFAULT '{}',
    main_colors             JSONB DEFAULT '{}',

    -- CLIP embedding for similarity search
    clip_embedding          VECTOR(512),               -- pgvector extension

    -- Timestamps
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,

    CONSTRAINT fk_owner FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX idx_images_owner ON images(owner_id);
CREATE INDEX idx_images_mood ON images(mood);
CREATE INDEX idx_images_created ON images(created_at DESC);

-- Vector similarity index (pgvector)
CREATE INDEX idx_images_embedding ON images
    USING ivfflat (clip_embedding vector_cosine_ops)
    WITH (lists = 100);


-- ============================================================
-- IMAGE ACCESS (wrapped DEKs)
-- ============================================================
CREATE TABLE image_access (
    image_id                UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Wrapped DEK (encrypted with user's public key)
    wrapped_dek             BYTEA NOT NULL,            -- ~256 bytes for RSA-2048
    wrap_algorithm          TEXT DEFAULT 'RSA-OAEP-SHA256',

    -- Access metadata
    granted_by              UUID REFERENCES users(id),
    granted_at              TIMESTAMPTZ DEFAULT NOW(),
    access_level            TEXT DEFAULT 'view',       -- 'view', 'reshare', 'admin'

    PRIMARY KEY (image_id, user_id)
);

CREATE INDEX idx_image_access_user ON image_access(user_id);
CREATE INDEX idx_image_access_image ON image_access(image_id);


-- ============================================================
-- IMAGE RATINGS (unchanged from current)
-- ============================================================
CREATE TABLE image_ratings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id                UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id),
    rating                  INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (image_id, user_id)
);


-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- View: Images accessible by a user
CREATE VIEW user_accessible_images AS
SELECT
    i.*,
    ia.access_level,
    ia.granted_at,
    ia.wrapped_dek
FROM images i
JOIN image_access ia ON ia.image_id = i.id;

-- View: Image with average rating
CREATE VIEW images_with_ratings AS
SELECT
    i.*,
    COALESCE(AVG(r.rating), 0) as avg_rating,
    COUNT(r.id) as rating_count
FROM images i
LEFT JOIN image_ratings r ON r.image_id = i.id
GROUP BY i.id;
```

---

## Cost Analysis

### Aurora PostgreSQL Costs

| Component | Configuration | Monthly Cost (Estimate) |
|-----------|---------------|------------------------|
| **Aurora Serverless v2** | 0.5-4 ACU, auto-scaling | $50-200 |
| **Aurora Standard** | db.r6g.large (2 vCPU, 16GB) | ~$175 |
| **Aurora I/O Optimized** | For high I/O workloads | +40% over standard |
| **Storage** | $0.10/GB-month | ~$5-20 |
| **Backup** | $0.021/GB-month | ~$2-5 |
| **Data transfer** | $0.02/GB out | Variable |

**Recommendation:** Start with Aurora Serverless v2 for auto-scaling. Minimum ~$50/month when idle, scales up under load.

### AWS KMS Costs

| Operation | Cost |
|-----------|------|
| **CMK (Customer Master Key)** | $1/month per key |
| **API requests** | $0.03 per 10,000 requests |
| **Encrypt/Decrypt calls** | $0.03 per 10,000 |

**Estimate:** For 10,000 image views/day:
- 10,000 × 30 = 300,000 KMS calls/month
- 300,000 / 10,000 × $0.03 = **$0.90/month**

### S3 Costs (unchanged)

| Component | Cost |
|-----------|------|
| **Storage** | $0.023/GB-month |
| **PUT requests** | $0.005 per 1,000 |
| **GET requests** | $0.0004 per 1,000 |

### Total Additional Costs

| Component | Monthly Cost |
|-----------|--------------|
| Aurora Serverless v2 (estimated) | $50-150 |
| KMS | ~$2 |
| Additional Lambda compute | ~$5-10 |
| **Total additional** | **~$60-165/month** |

---

## Security Guarantees

### What We Guarantee

| Guarantee | How |
|-----------|-----|
| **Images encrypted at rest** | AES-256-GCM with per-image DEK |
| **Only authorized users can decrypt** | DEK wrapped with each user's public key |
| **Server cannot view images** | Private keys encrypted by KMS, decrypted only in user context |
| **Sharing doesn't duplicate images** | Envelope encryption - only DEKs duplicated |
| **Revocation is immediate** | Delete wrapped DEK from image_access table |
| **Audit trail** | All access grants logged with timestamps |

### What We Don't Guarantee

| Limitation | Reason |
|------------|--------|
| **Privacy during initial upload** | GPU must see plaintext for AI processing |
| **Protection from client compromise** | If browser is compromised, attacker sees decrypted images |
| **Perfect forward secrecy** | Compromised private key exposes all historical images (can add key rotation) |
| **Protection from screenshot** | User can always screenshot displayed images |

---

## Comparison: Before vs. After

| Aspect | Before | After |
|--------|--------|-------|
| **Images at rest** | SSE-S3 (AWS-managed) | AES-256-GCM (user-specific keys) |
| **CDN caching** | Plaintext cached at edge | No plaintext caching |
| **Server access** | Can view all images | Cannot decrypt images |
| **Sharing model** | All-or-nothing | Per-user access grants |
| **Revocation** | Delete account | Delete wrapped DEK |
| **Subpoena response** | Must produce images | Cannot produce (no keys) |
| **Image load latency** | ~100-300ms (CDN hit) | ~500-1500ms (decrypt) |
| **Monthly cost** | ~$20-50 | ~$80-200 |

---

## Next Steps

See [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) for the detailed rollout plan including:
- Phase-by-phase implementation
- Data migration strategy
- Rollback procedures
- User state transitions
