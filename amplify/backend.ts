import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { searchImages } from './functions/searchImages/resource';
import { ingestImage } from './functions/ingestImage/resource';
import { computeSimilarity } from './functions/computeSimilarity/resource';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * PixGraf Gallery Backend
 * 
 * This backend provides:
 * - Authentication via Cognito (optional, can be disabled for public galleries)
 * - GraphQL API for image metadata and search
 * - S3 storage for images (small, medium, full sizes)
 * - Lambda functions for:
 *   - Vector-based semantic search
 *   - Image ingestion and metadata processing
 *   - Similarity matrix computation
 */
export const backend = defineBackend({
  auth,
  data,
  storage,
  searchImages,
  ingestImage,
  computeSimilarity,
});

// Configure additional permissions
const { cfnUserPool } = backend.auth.resources.cfnResources;

// Allow unauthenticated access for public galleries (optional)
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: false,
    requireUppercase: true,
  },
};

// Grant Lambda functions access to S3
const s3Bucket = backend.storage.resources.bucket;

backend.searchImages.resources.lambda.addEnvironment(
  'STORAGE_BUCKET_NAME',
  s3Bucket.bucketName
);

backend.ingestImage.resources.lambda.addEnvironment(
  'STORAGE_BUCKET_NAME',
  s3Bucket.bucketName
);

backend.computeSimilarity.resources.lambda.addEnvironment(
  'STORAGE_BUCKET_NAME',
  s3Bucket.bucketName
);

// Grant read access to search function
s3Bucket.grantRead(backend.searchImages.resources.lambda);

// Grant read/write access to ingest function
s3Bucket.grantReadWrite(backend.ingestImage.resources.lambda);

// Grant read access to similarity function
s3Bucket.grantRead(backend.computeSimilarity.resources.lambda);

// ============================================================
// WAF (Web Application Firewall) Configuration
// Protects against scraping, DDoS, and common web attacks
// ============================================================

const webAcl = new wafv2.CfnWebACL(backend.data.resources.cfnResources.cfnGraphqlApi.stack, 'GalleryWAF', {
  defaultAction: { allow: {} },
  scope: 'REGIONAL', // Use 'CLOUDFRONT' if attaching to CloudFront distribution
  visibilityConfig: {
    cloudWatchMetricsEnabled: true,
    metricName: 'GalleryWAFMetrics',
    sampledRequestsEnabled: true,
  },
  name: 'picgrafWebACL',
  description: 'WAF rules for picgraf gallery API protection',
  rules: [
    // Rule 1: Rate limiting - Block IPs making too many requests
    {
      name: 'RateLimitRule',
      priority: 1,
      statement: {
        rateBasedStatement: {
          limit: 2000, // Max 2000 requests per 5 minutes per IP
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
    // Rule 2: AWS Managed Rules - Common attack protection
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
        metricName: 'CommonRuleSet',
        sampledRequestsEnabled: true,
      },
    },
    // Rule 3: AWS Managed Rules - Known bad inputs
    {
      name: 'AWSManagedRulesKnownBadInputsRuleSet',
      priority: 3,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'KnownBadInputs',
        sampledRequestsEnabled: true,
      },
    },
    // Rule 4: AWS Managed Rules - Bot control (optional, has additional cost)
    // Uncomment if you want bot detection
    // {
    //   name: 'AWSManagedRulesBotControlRuleSet',
    //   priority: 4,
    //   overrideAction: { none: {} },
    //   statement: {
    //     managedRuleGroupStatement: {
    //       vendorName: 'AWS',
    //       name: 'AWSManagedRulesBotControlRuleSet',
    //     },
    //   },
    //   visibilityConfig: {
    //     cloudWatchMetricsEnabled: true,
    //     metricName: 'BotControl',
    //     sampledRequestsEnabled: true,
    //   },
    // },
    // Rule 5: Geo-blocking (optional) - Block specific countries
    // Uncomment and modify countryCodes as needed
    // {
    //   name: 'GeoBlockRule',
    //   priority: 5,
    //   statement: {
    //     geoMatchStatement: {
    //       countryCodes: ['CN', 'RU', 'KP'], // Countries to block
    //     },
    //   },
    //   action: { block: {} },
    //   visibilityConfig: {
    //     cloudWatchMetricsEnabled: true,
    //     metricName: 'GeoBlock',
    //     sampledRequestsEnabled: true,
    //   },
    // },
  ],
});

// Associate WAF with the GraphQL API
new wafv2.CfnWebACLAssociation(backend.data.resources.cfnResources.cfnGraphqlApi.stack, 'WAFAssociation', {
  resourceArn: backend.data.resources.cfnResources.cfnGraphqlApi.attrArn,
  webAclArn: webAcl.attrArn,
});

// Output WAF ARN for reference
new cdk.CfnOutput(backend.data.resources.cfnResources.cfnGraphqlApi.stack, 'WAFWebACLArn', {
  value: webAcl.attrArn,
  description: 'ARN of the WAF Web ACL protecting the API',
});

// ============================================================
// CloudFront CDN for Image Delivery
// Provides global edge caching for faster image loading
// ============================================================

// Create Origin Access Identity for CloudFront to access S3
const originAccessIdentity = new cloudfront.OriginAccessIdentity(
  backend.storage.resources.bucket.stack,
  'ImageCDNOriginAccessIdentity',
  {
    comment: 'OAI for picgraf image CDN',
  }
);

// Grant CloudFront read access to the S3 bucket
s3Bucket.addToResourcePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject'],
    resources: [`${s3Bucket.bucketArn}/images/*`],
    principals: [originAccessIdentity.grantPrincipal],
  })
);

// Create CloudFront distribution
const imageDistribution = new cloudfront.Distribution(
  backend.storage.resources.bucket.stack,
  'ImageCDN',
  {
    comment: 'picgraf Image CDN',
    defaultBehavior: {
      origin: new origins.S3Origin(s3Bucket, {
        originAccessIdentity,
        originPath: '', // Serve from bucket root
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: new cloudfront.CachePolicy(
        backend.storage.resources.bucket.stack,
        'ImageCachePolicy',
        {
          cachePolicyName: 'picgraf-image-cache-policy',
          comment: 'Cache policy for picgraf images',
          defaultTtl: cdk.Duration.days(7),
          maxTtl: cdk.Duration.days(365),
          minTtl: cdk.Duration.hours(1),
          // Cache based on query strings (for cache busting if needed)
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
          // Don't cache based on headers (improves cache hit ratio)
          headerBehavior: cloudfront.CacheHeaderBehavior.none(),
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
        }
      ),
      // Allow GET and HEAD only for images
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
      compress: true,
    },
    // Enable HTTP/2 and HTTP/3 for better performance
    httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    // Price class - use all edge locations for best global performance
    // Change to PriceClass.PRICE_CLASS_100 for US/Europe only (cheaper)
    priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
    // Enable logging (optional - uncomment if you want access logs)
    // logBucket: new s3.Bucket(stack, 'CDNLogBucket'),
    // logFilePrefix: 'cdn-logs/',
  }
);

// Output the CloudFront distribution URL
new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'ImageCDNUrl', {
  value: `https://${imageDistribution.distributionDomainName}`,
  description: 'CloudFront CDN URL for images',
});

new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'ImageCDNDistributionId', {
  value: imageDistribution.distributionId,
  description: 'CloudFront Distribution ID (for cache invalidation)',
});
