-- ============================================================
-- PIXNDX ENVELOPE ENCRYPTION SCHEMA
--
-- Run this after Aurora cluster is created:
--   psql -h <aurora-endpoint> -U pixndx_admin -d pixndx -f schema.sql
--
-- Prerequisites:
--   - Aurora PostgreSQL 15.4+ cluster
--   - pgvector extension (for CLIP embeddings)
-- ============================================================

-- Enable pgvector extension for CLIP embedding similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- USERS TABLE
-- Stores user encryption keys (public key plaintext, private key KMS-encrypted)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cognito_sub             TEXT UNIQUE NOT NULL,      -- Cognito identity ID
    email                   TEXT UNIQUE NOT NULL,

    -- Encryption keys
    public_key              TEXT NOT NULL,             -- RSA/ECDSA public key (PEM format)
    private_key_encrypted   BYTEA NOT NULL,            -- Private key encrypted by KMS CMK
    private_key_kms_key_id  TEXT NOT NULL,             -- KMS key ARN used for encryption

    -- Metadata
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_cognito_sub ON users(cognito_sub);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- IMAGES TABLE
-- Stores encrypted image metadata (blob in S3, metadata here)
-- ============================================================
CREATE TABLE IF NOT EXISTS images (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id                UUID NOT NULL REFERENCES users(id),

    -- S3 reference for encrypted blob
    s3_bucket               TEXT NOT NULL,
    s3_key_encrypted        TEXT NOT NULL,             -- S3 key for encrypted blob

    -- Encryption parameters
    encryption_iv           BYTEA NOT NULL,            -- AES-GCM IV (12 bytes)
    encryption_algorithm    TEXT DEFAULT 'AES-256-GCM',

    -- AI-generated metadata (stored plaintext for search)
    -- These are generated during upload before encryption
    filename                TEXT,
    description             TEXT,
    mood                    TEXT,
    main_subject            TEXT,
    tags                    JSONB DEFAULT '{}',
    main_colors             JSONB DEFAULT '{}',
    exif                    JSONB DEFAULT '{}',

    -- CLIP embedding for similarity search (768-dimensional vector from ViT-L/14)
    clip_embedding          vector(768),

    -- Precomputed neighbors for fast similarity lookup
    clip_neighbors          JSONB DEFAULT '[]',

    -- Rating aggregates
    avg_rating              REAL DEFAULT 0,
    rating_count            INTEGER DEFAULT 0,

    -- Timestamps
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_images_owner ON images(owner_id);
CREATE INDEX IF NOT EXISTS idx_images_mood ON images(mood);
CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_processed ON images(processed_at DESC);

-- Vector similarity index using IVFFlat (for approximate nearest neighbor search)
-- lists = sqrt(num_rows) is a good starting point, adjust based on data size
CREATE INDEX IF NOT EXISTS idx_images_embedding ON images
    USING ivfflat (clip_embedding vector_cosine_ops)
    WITH (lists = 100);

CREATE TRIGGER update_images_updated_at
    BEFORE UPDATE ON images
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- IMAGE ACCESS TABLE
-- Stores wrapped DEKs for each authorized user (envelope encryption)
-- ============================================================
CREATE TABLE IF NOT EXISTS image_access (
    image_id                UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Wrapped DEK (Data Encryption Key encrypted with user's public key)
    wrapped_dek             BYTEA NOT NULL,            -- ~256 bytes for RSA-2048
    wrap_algorithm          TEXT DEFAULT 'RSA-OAEP-SHA256',

    -- Access metadata
    granted_by              UUID REFERENCES users(id),
    granted_at              TIMESTAMPTZ DEFAULT NOW(),
    access_level            TEXT DEFAULT 'view',       -- 'view', 'reshare', 'admin'

    PRIMARY KEY (image_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_image_access_user ON image_access(user_id);
CREATE INDEX IF NOT EXISTS idx_image_access_image ON image_access(image_id);
CREATE INDEX IF NOT EXISTS idx_image_access_granted_by ON image_access(granted_by);


-- ============================================================
-- IMAGE RATINGS TABLE
-- User ratings for images (1-5 stars)
-- ============================================================
CREATE TABLE IF NOT EXISTS image_ratings (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    image_id                UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    user_id                 UUID NOT NULL REFERENCES users(id),
    rating                  INTEGER CHECK (rating >= 1 AND rating <= 5),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (image_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_image ON image_ratings(image_id);
CREATE INDEX IF NOT EXISTS idx_ratings_user ON image_ratings(user_id);

CREATE TRIGGER update_ratings_updated_at
    BEFORE UPDATE ON image_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update image rating aggregates
CREATE OR REPLACE FUNCTION update_image_rating_aggregates()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the image's rating aggregates
    UPDATE images
    SET
        avg_rating = (
            SELECT COALESCE(AVG(rating)::REAL, 0)
            FROM image_ratings
            WHERE image_id = COALESCE(NEW.image_id, OLD.image_id)
        ),
        rating_count = (
            SELECT COUNT(*)
            FROM image_ratings
            WHERE image_id = COALESCE(NEW.image_id, OLD.image_id)
        ),
        updated_at = NOW()
    WHERE id = COALESCE(NEW.image_id, OLD.image_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rating_aggregates_on_insert
    AFTER INSERT ON image_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_image_rating_aggregates();

CREATE TRIGGER update_rating_aggregates_on_update
    AFTER UPDATE ON image_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_image_rating_aggregates();

CREATE TRIGGER update_rating_aggregates_on_delete
    AFTER DELETE ON image_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_image_rating_aggregates();


-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- View: Images accessible by a specific user (join with image_access)
CREATE OR REPLACE VIEW user_accessible_images AS
SELECT
    i.*,
    ia.access_level,
    ia.granted_at,
    ia.granted_by,
    ia.wrapped_dek,
    u.email as owner_email
FROM images i
JOIN image_access ia ON ia.image_id = i.id
JOIN users u ON u.id = i.owner_id;

-- View: Image summary with rating info
CREATE OR REPLACE VIEW images_summary AS
SELECT
    i.id,
    i.owner_id,
    i.filename,
    i.description,
    i.mood,
    i.main_subject,
    i.avg_rating,
    i.rating_count,
    i.created_at,
    i.processed_at,
    u.email as owner_email,
    (SELECT COUNT(*) FROM image_access WHERE image_id = i.id) as share_count
FROM images i
JOIN users u ON u.id = i.owner_id;


-- ============================================================
-- FUNCTIONS FOR COMMON OPERATIONS
-- ============================================================

-- Function: Get images accessible by a user with pagination
CREATE OR REPLACE FUNCTION get_user_images(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    filename TEXT,
    description TEXT,
    mood TEXT,
    main_subject TEXT,
    avg_rating REAL,
    rating_count INTEGER,
    access_level TEXT,
    wrapped_dek BYTEA,
    s3_key_encrypted TEXT,
    encryption_iv BYTEA
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        i.id,
        i.filename,
        i.description,
        i.mood,
        i.main_subject,
        i.avg_rating,
        i.rating_count,
        ia.access_level,
        ia.wrapped_dek,
        i.s3_key_encrypted,
        i.encryption_iv
    FROM images i
    JOIN image_access ia ON ia.image_id = i.id
    WHERE ia.user_id = p_user_id
    ORDER BY i.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function: Find similar images by CLIP embedding
CREATE OR REPLACE FUNCTION find_similar_images(
    p_image_id UUID,
    p_user_id UUID,
    p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    filename TEXT,
    similarity REAL
) AS $$
DECLARE
    v_embedding vector(768);
BEGIN
    -- Get the embedding of the source image
    SELECT clip_embedding INTO v_embedding
    FROM images
    WHERE id = p_image_id;

    IF v_embedding IS NULL THEN
        RETURN;
    END IF;

    -- Find similar images that the user has access to
    RETURN QUERY
    SELECT
        i.id,
        i.filename,
        (1 - (i.clip_embedding <=> v_embedding))::REAL as similarity
    FROM images i
    JOIN image_access ia ON ia.image_id = i.id
    WHERE ia.user_id = p_user_id
      AND i.id != p_image_id
      AND i.clip_embedding IS NOT NULL
    ORDER BY i.clip_embedding <=> v_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- GRANTS (adjust as needed for your DB users)
-- ============================================================

-- Example: Create a read-only role for Lambda functions
-- CREATE ROLE lambda_reader;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO lambda_reader;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lambda_reader;

-- Example: Create a read-write role for GPU processor
-- CREATE ROLE gpu_processor;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO gpu_processor;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gpu_processor;


-- ============================================================
-- VERIFICATION
-- ============================================================

-- Show all created tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Show all created indexes
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
