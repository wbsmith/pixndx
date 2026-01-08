# PixGraf Gallery - Security & Anti-Scraping

## Current Protection Layers

### 1. Authentication Required (Cognito)
- **Email verification required** - Users must verify their email before accessing
- **No guest/anonymous access** - All API calls require a valid JWT token
- **Session-based access** - Tokens expire and require re-authentication

```typescript
// From amplify/data/resource.ts
authorization((allow) => [
  allow.authenticated().to(['read']),  // Only authenticated users
  allow.owner(),                        // Only owners can write
])
```

### 2. S3 Image Protection
Images are served through **CloudFront with signed URLs** (when configured):

```typescript
// Example: Generate signed URL for images
import { getUrl } from 'aws-amplify/storage';

const signedUrl = await getUrl({
  path: 'images/full/photo.jpg',
  options: {
    expiresIn: 300,  // URL expires in 5 minutes
  }
});
```

**Benefits:**
- URLs expire, preventing link sharing
- Direct S3 access is blocked
- Only authenticated users can request URLs

### 3. Rate Limiting (CloudFront/WAF)
Add AWS WAF rules to limit requests per IP:

```yaml
# CloudFormation for WAF rate limiting
WebACL:
  Type: AWS::WAFv2::WebACL
  Properties:
    Rules:
      - Name: RateLimitRule
        Priority: 1
        Statement:
          RateBasedStatement:
            Limit: 2000        # Requests per 5 minutes per IP
            AggregateKeyType: IP
        Action:
          Block: {}
```

### 4. API Request Throttling
Lambda functions have built-in concurrency limits. Add explicit throttling:

```typescript
// In amplify/backend.ts
backend.searchImages.resources.cfnResources.cfnFunction.addPropertyOverride(
  'ReservedConcurrentExecutions',
  10  // Max 10 concurrent Lambda executions
);
```

---

## User Tracking & Ratings

### Already Implemented ✅

The GraphQL schema includes user-specific ratings:

```typescript
// From amplify/data/resource.ts
ImageRating: a.model({
  imageId: a.id().required(),
  rating: a.integer().required(),  // 1-5 stars
  // 'owner' field auto-added by Amplify for authorization
})
.authorization((allow) => [
  allow.authenticated().to(['read']),  // Anyone can see ratings
  allow.owner(),                        // Only owner can create/update/delete
])
```

**How it works:**
1. User logs in with email → Cognito creates identity
2. User rates an image → Rating stored with their `owner` ID
3. Query: "Get all ratings by this user" → Filter by owner
4. Query: "Get average rating for image" → Aggregate all ratings

### Querying User Ratings

```graphql
# Get all ratings by the current user
query MyRatings {
  listImageRatings(filter: { owner: { eq: "current-user-id" } }) {
    items {
      imageId
      rating
      createdAt
    }
  }
}

# Get average rating for an image
query ImageAverageRating($imageId: ID!) {
  listImageRatings(filter: { imageId: { eq: $imageId } }) {
    items {
      rating
    }
  }
}
```

---

## Additional Security Recommendations

### 1. Enable WAF (Web Application Firewall)

Add to `amplify/backend.ts`:

```typescript
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

// After backend definition, add WAF
const webAcl = new wafv2.CfnWebACL(backend.stack, 'GalleryWAF', {
  defaultAction: { allow: {} },
  scope: 'CLOUDFRONT',
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: 'GalleryWAFMetrics',
    sampledRequestsEnabled: true,
  },
  rules: [
    {
      name: 'RateLimit',
      priority: 1,
      statement: {
        rateBasedStatement: {
          limit: 2000,
          aggregateKeyType: 'IP',
        },
      },
      action: { block: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'RateLimitRule',
        sampledRequestsEnabled: true,
      },
    },
    // Add AWS Managed Rules for common attacks
    {
      name: 'AWSManagedRulesCommonRuleSet',
      priority: 2,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesCommonRuleSet',
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'CommonRules',
        sampledRequestsEnabled: true,
      },
    },
  ],
});
```

### 2. Content Security Policy

Add to CloudFront distribution (via Amplify custom headers):

```yaml
# In amplify.yml, add custom headers
customHeaders:
  - pattern: '**/*'
    headers:
      - key: 'Content-Security-Policy'
        value: "default-src 'self'; img-src 'self' https://*.amazonaws.com; script-src 'self' 'unsafe-inline'"
      - key: 'X-Frame-Options'
        value: 'DENY'
      - key: 'X-Content-Type-Options'
        value: 'nosniff'
```

### 3. Watermarking (Future Enhancement)

For high-value images, consider:
- Dynamic watermarking via Lambda@Edge
- Invisible watermarks for tracking leaked images
- Lower resolution for non-premium users

### 4. Access Logging

Enable CloudFront access logs to track:
- Which users accessed which images
- Unusual access patterns (bulk downloads)
- Geographic anomalies

---

## What Scrapers Would See

Without authentication:
```
┌─────────────────────────────────────┐
│     PixGraf Login Screen            │
│                                     │
│  [Email]                            │
│  [Password]                         │
│  [Sign In]                          │
│                                     │
│  No images visible                  │
│  No API access                      │
│  No S3 URLs                         │
└─────────────────────────────────────┘
```

With valid credentials but rate limited:
```
HTTP 429 Too Many Requests
{
  "error": "Rate limit exceeded",
  "retryAfter": 300
}
```

---

## Monitoring Suspicious Activity

### CloudWatch Alarms

Set up alerts for:
- High API request rates from single IP
- Unusual S3 download patterns
- Failed authentication attempts

```bash
# AWS CLI to create alarm
aws cloudwatch put-metric-alarm \
  --alarm-name "HighAPIRequests" \
  --metric-name "Count" \
  --namespace "AWS/ApiGateway" \
  --statistic Sum \
  --period 300 \
  --threshold 1000 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:ACCOUNT:AlertTopic
```

