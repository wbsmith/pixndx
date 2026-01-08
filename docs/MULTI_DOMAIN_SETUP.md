# PixGraf Gallery - Multi-Domain Setup with AWS Amplify

This guide explains how to deploy the same gallery codebase to multiple domains with different configurations.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Git Repository                            │
│                                                                  │
│   main ──────────────► pixgraf.com (Production)                 │
│     │                                                            │
│     ├── pixndx ──────► pixndx.com (Alternate branding)          │
│     │                                                            │
│     └── sorqua ──────► sorqua.com (Private/family gallery)      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Each branch can have:
- Different app name/branding
- Different authentication settings
- Different feature flags
- Shared or separate backend resources

---

## Step 1: Create Git Branches

```bash
# From your main branch
git checkout main
git pull origin main

# Create branch for pixndx.com
git checkout -b pixndx
git push -u origin pixndx

# Create branch for sorqua.com
git checkout -b sorqua
git push -u origin sorqua

# Return to main
git checkout main
```

---

## Step 2: Configure Amplify App

### Option A: Single Amplify App with Multiple Branches (Recommended)

This shares backend resources (DynamoDB, S3) across all domains.

1. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
2. Select your app or create new one
3. Click **Hosting environments** → **Add branch**
4. Add branches: `main`, `pixndx`, `sorqua`

### Option B: Separate Amplify Apps per Domain

This creates completely isolated environments (separate databases, storage).

```bash
# For each domain, create a new Amplify app
amplify init --app pixgraf
amplify init --app pixndx  
amplify init --app sorqua
```

---

## Step 3: Configure Environment Variables per Branch

In Amplify Console: **App settings** → **Environment variables**

### For `main` branch (pixgraf.com):

| Variable | Value |
|----------|-------|
| `VITE_APP_NAME` | `PixGraf` |
| `VITE_APP_TAGLINE` | `Explore the collection` |
| `VITE_ENABLE_ADMIN` | `true` |
| `VITE_ENABLE_RATINGS` | `true` |

### For `pixndx` branch (pixndx.com):

| Variable | Value |
|----------|-------|
| `VITE_APP_NAME` | `PixNdx` |
| `VITE_APP_TAGLINE` | `Your photo index` |
| `VITE_ENABLE_ADMIN` | `true` |
| `VITE_ENABLE_RATINGS` | `true` |

### For `sorqua` branch (sorqua.com):

| Variable | Value |
|----------|-------|
| `VITE_APP_NAME` | `Sorqua` |
| `VITE_APP_TAGLINE` | `Family memories` |
| `VITE_ENABLE_ADMIN` | `false` |
| `VITE_ENABLE_RATINGS` | `false` |

**To set variables per branch:**

1. Click **Environment variables**
2. Click **Manage variables**
3. Add variable with **Branch overrides**
4. Select branch and set value

---

## Step 4: Configure Custom Domains

### 4.1 Add Domains in Amplify Console

1. Go to **Domain management**
2. Click **Add domain**
3. Enter domain: `pixgraf.com`
4. Configure subdomains:
   - `pixgraf.com` → `main` branch
   - `www.pixgraf.com` → redirect to `pixgraf.com`

Repeat for other domains:
- `pixndx.com` → `pixndx` branch
- `sorqua.com` → `sorqua` branch

### 4.2 DNS Configuration (Route 53)

If your domains are in Route 53, Amplify auto-configures DNS. Otherwise, add these records manually:

```
# For pixgraf.com
Type: CNAME
Name: _acme-challenge.pixgraf.com
Value: (provided by Amplify for SSL verification)

Type: CNAME  
Name: pixgraf.com
Value: d1234567890.cloudfront.net (provided by Amplify)
```

### 4.3 SSL Certificates

Amplify automatically provisions and renews SSL certificates via AWS Certificate Manager (ACM).

---

## Step 5: Branch-Specific Build Settings

Create `amplify.yml` with branch-specific configurations:

```yaml
version: 1

backend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npx ampx pipeline-deploy --branch $AWS_BRANCH --app-id $AWS_APP_ID

frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        # Generate Amplify client configuration
        - npx ampx generate outputs --app-id $AWS_APP_ID --branch $AWS_BRANCH
        # Set branch-specific page title
        - |
          if [ "$AWS_BRANCH" = "main" ]; then
            sed -i 's/<title>.*<\/title>/<title>PixGraf<\/title>/' index.html
          elif [ "$AWS_BRANCH" = "pixndx" ]; then
            sed -i 's/<title>.*<\/title>/<title>PixNdx<\/title>/' index.html
          elif [ "$AWS_BRANCH" = "sorqua" ]; then
            sed -i 's/<title>.*<\/title>/<title>Sorqua<\/title>/' index.html
          fi
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .amplify/**/*

# Branch-specific settings
applications:
  - frontend:
      phases:
        build:
          commands:
            - echo "Building for branch $AWS_BRANCH"
```

---

## Step 6: Data Isolation (Optional)

### Option A: Shared Data (Default)

All branches share the same:
- DynamoDB tables
- S3 buckets
- User pool

Users can log in to any domain with the same credentials.

### Option B: Isolated Data per Domain

Modify `amplify/backend.ts` to use branch-specific resource names:

```typescript
import { defineBackend } from '@aws-amplify/backend';

// Get branch name from environment
const branch = process.env.AWS_BRANCH || 'main';

// Create branch-specific storage
export const storage = defineStorage({
  name: `pixgrafStorage-${branch}`,
  // ...
});
```

---

## Step 7: Access Control per Domain

### Different User Pools per Domain

For completely separate user bases:

```typescript
// amplify/auth/resource.ts
import { defineAuth } from '@aws-amplify/backend';

const branch = process.env.AWS_BRANCH || 'main';

export const auth = defineAuth({
  loginWith: {
    email: {
      // Branch-specific sender email
      verificationEmailSubject: `Welcome to ${
        branch === 'main' ? 'PixGraf' : 
        branch === 'pixndx' ? 'PixNdx' : 'Sorqua'
      }!`,
    },
  },
});
```

### Restrict Access to Specific Domains

Add domain validation in `AuthWrapper.tsx`:

```typescript
// Optionally restrict which domains can access
const allowedDomains = {
  'pixgraf.com': ['*'],  // Anyone can sign up
  'sorqua.com': ['@family.com', '@trusted.com'],  // Only specific emails
};

const currentDomain = window.location.hostname;
const restrictions = allowedDomains[currentDomain] || ['*'];

// In sign-up validation
if (!restrictions.includes('*')) {
  const emailDomain = email.split('@')[1];
  if (!restrictions.some(r => email.endsWith(r))) {
    throw new Error('Sign-up not allowed for this email domain');
  }
}
```

---

## Step 8: Monitoring per Domain

### CloudWatch Dashboards

Create separate dashboards per domain in CloudWatch:

```bash
aws cloudwatch put-dashboard --dashboard-name "PixGraf-Main" \
  --dashboard-body file://dashboard-main.json

aws cloudwatch put-dashboard --dashboard-name "PixGraf-PixNdx" \
  --dashboard-body file://dashboard-pixndx.json
```

### WAF Metrics per Domain

The WAF rules in `backend.ts` log metrics with branch-specific names:

```typescript
visibilityConfig: {
  cloudWatchMetricsEnabled: true,
  metricName: `RateLimitRule-${process.env.AWS_BRANCH}`,
  sampledRequestsEnabled: true,
}
```

---

## Quick Reference

### Deploy to Specific Branch

```bash
# Push to pixgraf.com (main)
git checkout main
git push origin main

# Push to pixndx.com
git checkout pixndx
git merge main  # Get latest from main
git push origin pixndx

# Push to sorqua.com
git checkout sorqua
git merge main
git push origin sorqua
```

### Sync Changes Across Branches

```bash
# Make changes on main
git checkout main
# ... make changes ...
git commit -m "New feature"
git push origin main

# Merge to other branches
git checkout pixndx && git merge main && git push origin pixndx
git checkout sorqua && git merge main && git push origin sorqua
```

### Environment Variable Quick Copy

```bash
# AWS CLI to set env vars
aws amplify update-branch \
  --app-id YOUR_APP_ID \
  --branch-name pixndx \
  --environment-variables VITE_APP_NAME=PixNdx,VITE_APP_TAGLINE="Your photo index"
```

---

## Cost Considerations

| Resource | Shared vs Isolated |
|----------|-------------------|
| Amplify Hosting | ~$0.01/build + bandwidth |
| WAF | ~$5/month per WebACL |
| DynamoDB | Pay per request (shared = lower cost) |
| S3 | Storage + bandwidth (shared = lower cost) |
| Cognito | 50,000 MAU free, then $0.0055/user |

**Recommendation:** Use shared backend (Option A) to minimize costs. Only isolate if you need completely separate user bases or data.

