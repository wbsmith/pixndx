import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { searchImages } from './functions/searchImages/resource';
import { ingestImage } from './functions/ingestImage/resource';
import { computeSimilarity } from './functions/computeSimilarity/resource';
import { generateImageCookies } from './functions/generateImageCookies/resource';
import { processImage } from './functions/processImage/resource';
import { deleteImage } from './functions/deleteImage/resource';
import { notifyManifest } from './functions/notifyManifest/resource';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as lambda from 'aws-cdk-lib/aws-lambda';

// Custom domain for CloudFront (allows cookie sharing with app domain)
const CDN_DOMAIN = 'cdn.picgraf.com';
const COOKIE_DOMAIN = '.picgraf.com'; // Parent domain for cookie sharing

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
  generateImageCookies,
  processImage,
  deleteImage,
  notifyManifest,
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

// Grant read/write access to processImage function
backend.processImage.resources.lambda.addEnvironment(
  'STORAGE_BUCKET_NAME',
  s3Bucket.bucketName
);
s3Bucket.grantReadWrite(backend.processImage.resources.lambda);

// Grant read/write/delete access to deleteImage function
backend.deleteImage.resources.lambda.addEnvironment(
  'STORAGE_BUCKET_NAME',
  s3Bucket.bucketName
);
backend.deleteImage.resources.lambda.addEnvironment(
  'DYNAMODB_TABLE_PATTERN',
  'Image'
);
s3Bucket.grantReadWrite(backend.deleteImage.resources.lambda);
s3Bucket.grantDelete(backend.deleteImage.resources.lambda);

// Grant deleteImage Lambda permission to delete from DynamoDB Image table
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
    ],
    resources: [
      `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/Image-*`,
    ],
  })
);
// Grant permission to list tables (to find the Image table by pattern)
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['dynamodb:ListTables'],
    resources: ['*'],
  })
);

// ============================================================
// notifyManifest Lambda Configuration
// Simple Lambda that GPU invokes to notify AppSync of manifest updates.
// NOT in VPC - reaches public AppSync directly (avoids VPC endpoint issues).
// ============================================================

// Pass AppSync endpoint to notifyManifest
backend.notifyManifest.resources.lambda.addEnvironment(
  'APPSYNC_ENDPOINT',
  backend.data.resources.cfnResources.cfnGraphqlApi.attrGraphQlUrl
);

// Grant permission to call AppSync mutations
backend.notifyManifest.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['appsync:GraphQL'],
    resources: [`${backend.data.resources.cfnResources.cfnGraphqlApi.attrArn}/*`],
  })
);

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

// Grant CloudFront read access to the S3 bucket (images and manifest)
s3Bucket.addToResourcePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject'],
    resources: [
      `${s3Bucket.bucketArn}/images/*`,
      `${s3Bucket.bucketArn}/manifest/*`,
    ],
    principals: [originAccessIdentity.grantPrincipal],
  })
);

// ============================================================
// CloudFront Signed Cookies Setup
// Requires authentication to access images
// ============================================================

// Public key for CloudFront signed cookies
const cfPublicKey = new cloudfront.PublicKey(
  backend.storage.resources.bucket.stack,
  'ImageSigningPublicKey',
  {
    encodedKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwNgeS0XDx7TW7NhC+A0v
k+MehW6memdFfzxDTW/uxBDtb5Y7du5OQGuygabH9slOIYd/FvMIiG8JixJvNDZC
pvOTHKws6HmOAYM4p0kHuQFzPxjc8vn3g0tQML1dvZAX0V/CW6cBzK+BFGbGC+/A
4kwfchiggSApjm32WaxHWX9dpVxGzRf8PqUH+vxY8sRLGtZfnOprmUOuEAYTbYGc
tt8iu4WGHogEmWyDVK9nwwEF5iDC2L+D2n0TXy0MQT6bS2g6zGhi/EwzvbBfTDJu
1RN+Fwh0UBv1AVWkxfQ/2XdOUbJCpLiiuVvd7QZpmeB8RloxOXALhXPTvDKuh7bG
hQIDAQAB
-----END PUBLIC KEY-----`,
    comment: 'Public key for picgraf image cookie signing',
  }
);

// Key group for signed cookies
const imageKeyGroup = new cloudfront.KeyGroup(
  backend.storage.resources.bucket.stack,
  'ImageSigningKeyGroup',
  {
    items: [cfPublicKey],
    comment: 'Key group for picgraf image cookie signing',
  }
);

// Store private key in Secrets Manager for Lambda to use
const privateKeySecret = new secretsmanager.Secret(
  backend.storage.resources.bucket.stack,
  'CloudFrontPrivateKey',
  {
    secretName: 'picgraf/cloudfront-private-key',
    description: 'Private key for signing CloudFront cookies',
  }
);

// Response headers policy with Cache-Control and CORS for browser caching
const imageResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
  backend.storage.resources.bucket.stack,
  'ImageResponseHeadersPolicy',
  {
    responseHeadersPolicyName: 'picgraf-image-cache-headers',
    comment: 'Cache and CORS headers for picgraf images',
    customHeadersBehavior: {
      customHeaders: [
        {
          header: 'Cache-Control',
          value: 'public, max-age=31536000, immutable',
          override: true,
        },
      ],
    },
    // CORS configuration for cross-origin image requests with credentials
    corsBehavior: {
      accessControlAllowOrigins: ['https://www.picgraf.com', 'https://picgraf.com'],
      accessControlAllowMethods: ['GET', 'HEAD'],
      accessControlAllowHeaders: ['Accept', 'Accept-Language', 'Content-Language', 'Content-Type'],
      accessControlAllowCredentials: true,
      accessControlMaxAge: cdk.Duration.days(1),
      originOverride: true,
    },
  }
);

// Grant Lambda access to read the private key
privateKeySecret.grantRead(backend.generateImageCookies.resources.lambda);

// Pass configuration to the Lambda
backend.generateImageCookies.resources.lambda.addEnvironment(
  'CLOUDFRONT_PRIVATE_KEY_SECRET_ARN',
  privateKeySecret.secretArn
);
backend.generateImageCookies.resources.lambda.addEnvironment(
  'COOKIE_DOMAIN',
  COOKIE_DOMAIN
);

// ACM Certificate for custom domain (must be in us-east-1 for CloudFront)
// Note: This requires DNS validation - add the CNAME record AWS provides
const cdnCertificate = new acm.Certificate(
  backend.storage.resources.bucket.stack,
  'CdnCertificate',
  {
    domainName: CDN_DOMAIN,
    validation: acm.CertificateValidation.fromDns(),
  }
);

// Create CloudFront distribution with signed cookie authentication
const imageDistribution = new cloudfront.Distribution(
  backend.storage.resources.bucket.stack,
  'ImageCDN',
  {
    comment: 'picgraf Image CDN (signed cookies required)',
    // Custom domain configuration
    domainNames: [CDN_DOMAIN],
    certificate: cdnCertificate,
    defaultBehavior: {
      origin: origins.S3BucketOrigin.withOriginAccessIdentity(s3Bucket, {
        originAccessIdentity,
        originPath: '', // Serve from bucket root
      }),
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      // Require signed cookies for access
      trustedKeyGroups: [imageKeyGroup],
      // Add Cache-Control headers to responses
      responseHeadersPolicy: imageResponseHeadersPolicy,
      cachePolicy: new cloudfront.CachePolicy(
        backend.storage.resources.bucket.stack,
        'ImageCachePolicy',
        {
          cachePolicyName: 'picgraf-image-cache-policy',
          comment: 'Cache policy for picgraf images',
          defaultTtl: cdk.Duration.days(7),
          maxTtl: cdk.Duration.days(365),
          minTtl: cdk.Duration.hours(1),
          queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
          headerBehavior: cloudfront.CacheHeaderBehavior.none(),
          // Don't cache based on cookies (signed cookies are for auth, not cache key)
          cookieBehavior: cloudfront.CacheCookieBehavior.none(),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
        }
      ),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
      compress: true,
    },
    // Enable HTTP/2 and HTTP/3 for better performance
    httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    // Price class - use all edge locations for best global performance
    priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
  }
);

// Output the CloudFront URLs
new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'ImageCDNUrl', {
  value: `https://${CDN_DOMAIN}`,
  description: 'CloudFront CDN URL for images (custom domain)',
});

new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'ImageCDNDistributionUrl', {
  value: `https://${imageDistribution.distributionDomainName}`,
  description: 'CloudFront CDN URL (distribution domain)',
});

new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'ImageCDNDistributionId', {
  value: imageDistribution.distributionId,
  description: 'CloudFront Distribution ID (for cache invalidation)',
});

// Output the public key ID for cookie signing
new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'CloudFrontPublicKeyId', {
  value: cfPublicKey.publicKeyId,
  description: 'CloudFront Public Key ID for signed cookies',
});

// Output certificate validation info
new cdk.CfnOutput(backend.storage.resources.bucket.stack, 'CertificateArn', {
  value: cdnCertificate.certificateArn,
  description: 'ACM Certificate ARN (check AWS Console for DNS validation records)',
});

// Pass CloudFront configuration to the cookie generation Lambda
backend.generateImageCookies.resources.lambda.addEnvironment(
  'CLOUDFRONT_DOMAIN',
  CDN_DOMAIN  // Use custom domain for cookie signing
);
backend.generateImageCookies.resources.lambda.addEnvironment(
  'CLOUDFRONT_KEY_PAIR_ID',
  cfPublicKey.publicKeyId
);

// ============================================================
// GPU Image Processing Infrastructure
// On-demand spot instances for privacy-first AI processing
// Uses EFS for cross-AZ model storage (zero-boot-delay, any AZ)
// ============================================================

// Get the stack for GPU resources (use storage stack for consistency)
const gpuStack = backend.storage.resources.bucket.stack;

// S3 bucket for scripts and configs (not models - those go on EFS)
const modelsBucket = new s3.Bucket(gpuStack, 'ModelsBucket', {
  bucketName: `picgraf-models-${cdk.Aws.ACCOUNT_ID}`,
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
});

// SQS queue for image processing jobs
const imageProcessingQueue = new sqs.Queue(gpuStack, 'ImageProcessingQueue', {
  queueName: 'picgraf-image-processing',
  visibilityTimeout: cdk.Duration.minutes(15),
  retentionPeriod: cdk.Duration.days(7),
  deadLetterQueue: {
    queue: new sqs.Queue(gpuStack, 'ImageProcessingDLQ', {
      queueName: 'picgraf-image-processing-dlq',
      retentionPeriod: cdk.Duration.days(14),
    }),
    maxReceiveCount: 3,
  },
});

// Create VPC with multiple AZs for flexibility (EFS spans AZs)
// Keep original 3-AZ config to avoid EFS mount target conflicts
const vpc = new ec2.Vpc(gpuStack, 'GpuVpc', {
  vpcName: 'picgraf-gpu-vpc',
  maxAzs: 3,  // Must match original deployment to avoid EFS mount target conflicts
  natGateways: 0,  // No NAT - Lambda uses VPC endpoints for AWS services
  subnetConfiguration: [
    {
      name: 'public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
  ],
});

// S3 Gateway endpoint (free) - allows Lambda to access S3 without going through NAT
vpc.addGatewayEndpoint('S3Endpoint', {
  service: ec2.GatewayVpcEndpointAwsService.S3,
});

// Security group for AppSync VPC endpoint
const appsyncEndpointSg = new ec2.SecurityGroup(gpuStack, 'AppSyncEndpointSg', {
  vpc,
  description: 'Security group for AppSync VPC endpoint',
  allowAllOutbound: false,
});

// AppSync Interface endpoint - allows Lambda to call AppSync mutations from VPC
// Cost: ~$7.30/month/AZ (3 AZs = ~$22/month) + $0.01/GB data processed
// NOTE: privateDnsEnabled must be false because our AppSync API is public.
// With true, ALL VPC traffic to AppSync would go through this endpoint,
// which returns 404 for public APIs ("Unable to find private GraphQL API").
// The deleteImage Lambda uses IAM auth and can reach public AppSync directly.
vpc.addInterfaceEndpoint('AppSyncEndpoint', {
  service: ec2.InterfaceVpcEndpointAwsService.APP_SYNC,
  subnets: { subnetType: ec2.SubnetType.PUBLIC },
  securityGroups: [appsyncEndpointSg],
  privateDnsEnabled: false,
});

// Security group for GPU instances
const gpuSecurityGroup = new ec2.SecurityGroup(gpuStack, 'GpuSecurityGroup', {
  vpc,
  description: 'Security group for picgraf GPU processing instances',
  allowAllOutbound: true,
});

// Security group for EFS mount targets
const efsSecurityGroup = new ec2.SecurityGroup(gpuStack, 'EfsSecurityGroup', {
  vpc,
  description: 'Security group for picgraf EFS model storage',
  allowAllOutbound: false,
});

// Allow NFS traffic from GPU instances to EFS
efsSecurityGroup.addIngressRule(
  gpuSecurityGroup,
  ec2.Port.tcp(2049),
  'Allow NFS from GPU instances'
);

// Persistent EFS filesystem for AI models (cross-AZ, survives instance termination)
// Contains: Ollama models (~20GB), HuggingFace cache (~5GB), scripts
const modelsFileSystem = new efs.FileSystem(gpuStack, 'ModelsFileSystem', {
  fileSystemName: 'picgraf-ai-models',
  vpc,
  securityGroup: efsSecurityGroup,
  performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
  throughputMode: efs.ThroughputMode.BURSTING,
  encrypted: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep models on stack deletion!
  lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS, // Move infrequently accessed files to IA storage
  outOfInfrequentAccessPolicy: efs.OutOfInfrequentAccessPolicy.AFTER_1_ACCESS, // Move back on access
});

// Tag the filesystem
cdk.Tags.of(modelsFileSystem).add('Name', 'picgraf-ai-models');
cdk.Tags.of(modelsFileSystem).add('Purpose', 'ai-models');

// ============================================================
// deleteImage Lambda EFS Configuration
// Allows Lambda to read/write EFS for metadata cleanup & manifest regen
// ============================================================

// Security group for deleteImage Lambda to access EFS
const deleteImageLambdaSg = new ec2.SecurityGroup(gpuStack, 'DeleteImageLambdaSg', {
  vpc,
  description: 'Security group for deleteImage Lambda to access EFS',
  allowAllOutbound: true,
});

// Allow NFS traffic from deleteImage Lambda to EFS
efsSecurityGroup.addIngressRule(
  deleteImageLambdaSg,
  ec2.Port.tcp(2049),
  'Allow NFS from deleteImage Lambda'
);

// Allow HTTPS traffic from deleteImage Lambda to AppSync VPC endpoint
appsyncEndpointSg.addIngressRule(
  deleteImageLambdaSg,
  ec2.Port.tcp(443),
  'Allow HTTPS from deleteImage Lambda to AppSync'
);

// EFS access point for Lambda (different from root access used by GPU)
const deleteImageAccessPoint = new efs.AccessPoint(gpuStack, 'DeleteImageAccessPoint', {
  fileSystem: modelsFileSystem,
  path: '/cache',
  createAcl: {
    ownerGid: '1000',
    ownerUid: '1000',
    permissions: '755',
  },
  posixUser: {
    gid: '1000',
    uid: '1000',
  },
});

// Get the underlying CfnFunction to configure VPC and EFS
const deleteImageLambdaFn = backend.deleteImage.resources.lambda.node.defaultChild as lambda.CfnFunction;

// Configure VPC for deleteImage Lambda
deleteImageLambdaFn.vpcConfig = {
  securityGroupIds: [deleteImageLambdaSg.securityGroupId],
  subnetIds: vpc.privateSubnets.length > 0
    ? vpc.privateSubnets.map(s => s.subnetId)
    : vpc.publicSubnets.map(s => s.subnetId),
};

// Configure EFS mount for deleteImage Lambda
deleteImageLambdaFn.fileSystemConfigs = [{
  arn: deleteImageAccessPoint.accessPointArn,
  localMountPath: '/mnt/efs',
}];

// Add EFS mount path environment variable
backend.deleteImage.resources.lambda.addEnvironment('EFS_MOUNT_PATH', '/mnt/efs');

// Grant Lambda VPC networking permissions (required for Lambda in VPC)
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'ec2:CreateNetworkInterface',
      'ec2:DescribeNetworkInterfaces',
      'ec2:DeleteNetworkInterface',
      'ec2:AssignPrivateIpAddresses',
      'ec2:UnassignPrivateIpAddresses',
    ],
    resources: ['*'],
  })
);

// Grant Lambda permission to access EFS
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'elasticfilesystem:ClientMount',
      'elasticfilesystem:ClientWrite',
      'elasticfilesystem:ClientRootAccess',
    ],
    resources: [modelsFileSystem.fileSystemArn],
  })
);

// Grant Lambda permission to access the access point
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['elasticfilesystem:ClientMount'],
    resources: [deleteImageAccessPoint.accessPointArn],
  })
);

// Grant deleteImage permission to invoke notifyManifest Lambda for manifest updates
// (deleteImage is in VPC for EFS access, so can't reach public AppSync directly)
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:InvokeFunction'],
    resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:*notifyManifest*`],
  })
);
backend.deleteImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['lambda:ListFunctions'],
    resources: ['*'],
  })
);

// IAM role for GPU instances
const gpuInstanceRole = new iam.Role(gpuStack, 'GpuInstanceRole', {
  assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
  description: 'Role for picgraf GPU processing instances',
  managedPolicies: [
    iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
  ],
});

// Grant GPU instance access to S3 buckets
s3Bucket.grantReadWrite(gpuInstanceRole);
modelsBucket.grantRead(gpuInstanceRole);

// Grant GPU instance access to SQS queue
imageProcessingQueue.grantConsumeMessages(gpuInstanceRole);
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: ['sqs:ListQueues'],
  resources: ['*'],
}));

// Grant GPU instance access to DynamoDB Image table
// The GPU writes image metadata directly to DynamoDB after processing
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'dynamodb:ListTables',
  ],
  resources: ['*'],
}));
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:GetItem',
    'dynamodb:Query',
    'dynamodb:Scan',
  ],
  resources: [
    `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/Image-*`,
    `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/Image-*/index/*`,
  ],
}));

// Grant GPU instance access to EFS (via security group, but also need elasticfilesystem permissions)
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'elasticfilesystem:ClientMount',
    'elasticfilesystem:ClientWrite',
    'elasticfilesystem:DescribeMountTargets',
  ],
  resources: [modelsFileSystem.fileSystemArn],
}));

// Grant GPU instance access to AppSync (for listing APIs/keys and making mutations)
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'appsync:ListGraphqlApis',
    'appsync:ListApiKeys',
    'appsync:GetGraphqlApi',
  ],
  resources: ['*'], // Needs to list all APIs to find the right one
}));

// Grant GPU instance access to invoke notifyManifest Lambda
// (GPU can't reach AppSync directly due to VPC endpoint routing)
// Use wildcard pattern to avoid cross-stack dependency (function is in data stack)
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: ['lambda:InvokeFunction'],
  resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:*notifyManifest*`],
}));

// Grant GPU instance access to list Lambda functions (to discover notifyManifest)
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: ['lambda:ListFunctions'],
  resources: ['*'],
}));

// User data script - simplified for pre-configured AMI
// All deps, ollama, and Python packages are pre-installed in the AMI
// This just mounts EFS and calls the startup script from the repo
const userData = ec2.UserData.forLinux();
userData.addCommands(
  '#!/bin/bash',
  'set -ex',
  'exec > >(tee /var/log/user-data.log) 2>&1',
  '',
  'echo "=========================================="',
  'echo "PicGraf GPU Instance Starting"',
  'echo "=========================================="',
  '',
  '# ============================================================',
  '# Mount EFS filesystem',
  '# ============================================================',
  '',
  'REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',
  `EFS_ID="${modelsFileSystem.fileSystemId}"`,
  'MOUNT_POINT="/mnt/models"',
  '',
  'mkdir -p $MOUNT_POINT',
  'mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport $EFS_ID.efs.$REGION.amazonaws.com:/ $MOUNT_POINT',
  '',
  'echo "EFS mounted at $MOUNT_POINT"',
  '',
  '# ============================================================',
  '# Configure and start Ollama with EFS storage',
  '# ============================================================',
  '',
  'mkdir -p /etc/systemd/system/ollama.service.d',
  'cat > /etc/systemd/system/ollama.service.d/override.conf << EOF',
  '[Service]',
  'Environment="OLLAMA_MODELS=$MOUNT_POINT/ollama"',
  'EOF',
  '',
  'systemctl daemon-reload',
  'systemctl start ollama',
  '',
  '# ============================================================',
  '# Pull latest code from git (before running startup script)',
  '# ============================================================',
  '',
  'REPO_DIR="$MOUNT_POINT/repo"',
  'DEPLOY_KEY="$MOUNT_POINT/config/deploy_key"',
  '',
  'chmod 600 "$DEPLOY_KEY"',
  'export HOME=/root',
  'git config --global --add safe.directory "$REPO_DIR"',
  'export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"',
  '',
  'cd "$REPO_DIR"',
  'git fetch origin main || echo "Warning: Could not fetch from origin"',
  'git reset --hard origin/main || echo "Warning: Could not reset to origin/main"',
  'echo "Current commit: $(git log --oneline -1)"',
  '',
  '# ============================================================',
  '# Run the GPU startup script from the repo',
  '# ============================================================',
  '',
  'STARTUP_SCRIPT="$REPO_DIR/scripts/gpu_startup.sh"',
  '',
  'if [ -f "$STARTUP_SCRIPT" ]; then',
  '  echo "Running startup script: $STARTUP_SCRIPT"',
  '  chmod +x "$STARTUP_SCRIPT"',
  '  exec "$STARTUP_SCRIPT"',
  'else',
  '  echo "ERROR: Startup script not found at $STARTUP_SCRIPT"',
  '  echo "EFS contents:"',
  '  ls -la $MOUNT_POINT/',
  '  exit 1',
  'fi',
);

// Custom AMI with NVIDIA, ollama, PyTorch, transformers, sentence-transformers pre-installed
const gpuAmi = ec2.MachineImage.genericLinux({
  'us-east-1': 'ami-0a81ada0aac338121', // pixndx-gpu-heic-20260125 (pillow-heif, pynvml fix)
});

// Launch template for GPU instances (no spot options - controlled by ASG mixed policy)
const gpuLaunchTemplate = new ec2.LaunchTemplate(gpuStack, 'GpuLaunchTemplate', {
  launchTemplateName: 'picgraf-gpu-processor',
  machineImage: gpuAmi,
  role: gpuInstanceRole,
  securityGroup: gpuSecurityGroup,
  userData,
  keyName: 'pixndx-admin',  // SSH access for debugging
  associatePublicIpAddress: true,
  blockDevices: [
    {
      deviceName: '/dev/sda1',
      volume: ec2.BlockDeviceVolume.ebs(100, { // 100GB root (Deep Learning AMI needs 75GB+)
        volumeType: ec2.EbsDeviceVolumeType.GP3,
        encrypted: true,
      }),
    },
  ],
});

// Auto Scaling Group with mixed instances policy (spot preferred, on-demand fallback)
const gpuAsg = new autoscaling.AutoScalingGroup(gpuStack, 'GpuAutoScalingGroup', {
  autoScalingGroupName: 'picgraf-gpu-processors',
  vpc,
  vpcSubnets: {
    subnetType: ec2.SubnetType.PUBLIC, // Use any public subnet (any AZ)
  },
  mixedInstancesPolicy: {
    instancesDistribution: {
      onDemandBaseCapacity: 0,           // No guaranteed on-demand
      onDemandPercentageAboveBaseCapacity: 0, // 100% spot when available
      spotAllocationStrategy: autoscaling.SpotAllocationStrategy.PRICE_CAPACITY_OPTIMIZED,
      spotMaxPrice: '1.50',              // Max spot price
    },
    launchTemplate: gpuLaunchTemplate,
    launchTemplateOverrides: [
      // Only g5 instances - need 24GB VRAM for Gemma 3 27B + CLIP
      { instanceType: ec2.InstanceType.of(ec2.InstanceClass.G5, ec2.InstanceSize.XLARGE2) },
      { instanceType: ec2.InstanceType.of(ec2.InstanceClass.G5, ec2.InstanceSize.XLARGE) },
    ],
  },
  minCapacity: 0,
  maxCapacity: 1,
  desiredCapacity: 0,
  healthChecks: autoscaling.HealthChecks.ec2({
    grace: cdk.Duration.minutes(15), // Allow time for first-boot model download
  }),
  updatePolicy: autoscaling.UpdatePolicy.rollingUpdate(),
});

// Pass GPU infrastructure config to processImage Lambda
backend.processImage.resources.lambda.addEnvironment(
  'SQS_QUEUE_URL',
  imageProcessingQueue.queueUrl
);
backend.processImage.resources.lambda.addEnvironment(
  'ASG_NAME',
  gpuAsg.autoScalingGroupName
);

// Grant Lambda permission to send to SQS and manage ASG
imageProcessingQueue.grantSendMessages(backend.processImage.resources.lambda);
backend.processImage.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: [
      'autoscaling:DescribeAutoScalingGroups',
      'autoscaling:SetDesiredCapacity',
    ],
    resources: ['*'], // ASG ARNs are complex, use * with condition
  })
);

// Outputs
new cdk.CfnOutput(gpuStack, 'ModelsBucketName', {
  value: modelsBucket.bucketName,
  description: 'S3 bucket for scripts (upload process_images.py here)',
});

new cdk.CfnOutput(gpuStack, 'ImageProcessingQueueUrl', {
  value: imageProcessingQueue.queueUrl,
  description: 'SQS queue URL for image processing jobs',
});

new cdk.CfnOutput(gpuStack, 'GpuAsgName', {
  value: gpuAsg.autoScalingGroupName,
  description: 'Auto Scaling Group name for GPU instances',
});

new cdk.CfnOutput(gpuStack, 'ModelsFileSystemId', {
  value: modelsFileSystem.fileSystemId,
  description: 'EFS filesystem for AI models (cross-AZ)',
});

new cdk.CfnOutput(gpuStack, 'GpuVpcAzs', {
  value: vpc.availabilityZones.join(', '),
  description: 'Availability Zones for GPU instances (any AZ can be used)',
});
