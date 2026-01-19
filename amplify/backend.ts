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
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

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
s3Bucket.grantReadWrite(backend.deleteImage.resources.lambda);
s3Bucket.grantDelete(backend.deleteImage.resources.lambda);

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
      origin: new origins.S3Origin(s3Bucket, {
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
// Uses persistent EBS volume for model storage (fast restarts)
// ============================================================

// Get the stack for GPU resources (use storage stack for consistency)
const gpuStack = backend.storage.resources.bucket.stack;

// S3 bucket for scripts and configs (not models - those go on EBS)
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

// Create VPC with single AZ for EBS volume compatibility
const vpc = new ec2.Vpc(gpuStack, 'GpuVpc', {
  vpcName: 'picgraf-gpu-vpc',
  maxAzs: 1,  // Single AZ - EBS volumes are AZ-specific
  natGateways: 0,
  subnetConfiguration: [
    {
      name: 'public',
      subnetType: ec2.SubnetType.PUBLIC,
      cidrMask: 24,
    },
  ],
});

// Get the single AZ we're using
const gpuAvailabilityZone = vpc.availabilityZones[0];

// Persistent EBS volume for AI models (survives instance termination)
// Contains: Ollama models (~20GB), HuggingFace cache (~5GB), scripts
const modelsVolume = new ec2.Volume(gpuStack, 'ModelsVolume', {
  volumeName: 'picgraf-ai-models',
  availabilityZone: gpuAvailabilityZone,
  size: cdk.Size.gibibytes(100),
  volumeType: ec2.EbsDeviceVolumeType.GP3,
  encrypted: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep models on stack deletion!
});

// Tag the volume so instances can find it
cdk.Tags.of(modelsVolume).add('Name', 'picgraf-ai-models');
cdk.Tags.of(modelsVolume).add('Purpose', 'ai-models');

// Security group for GPU instances
const gpuSecurityGroup = new ec2.SecurityGroup(gpuStack, 'GpuSecurityGroup', {
  vpc,
  description: 'Security group for picgraf GPU processing instances',
  allowAllOutbound: true,
});

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

// Grant GPU instance access to DynamoDB Image table
// The GPU writes image metadata directly to DynamoDB after processing
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:GetItem',
    'dynamodb:Query',
    'dynamodb:Scan',
  ],
  resources: [
    `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/*-Image-*`,
    `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/*-Image-*/index/*`,
  ],
}));

// Grant GPU instance permission to attach the EBS volume
gpuInstanceRole.addToPolicy(new iam.PolicyStatement({
  actions: [
    'ec2:AttachVolume',
    'ec2:DetachVolume',
    'ec2:DescribeVolumes',
    'ec2:DescribeInstances',
  ],
  resources: ['*'], // Volume and instance ARNs are dynamic
}));

// User data script with persistent model storage
const userData = ec2.UserData.forLinux();
userData.addCommands(
  '#!/bin/bash',
  'set -ex',
  'exec > >(tee /var/log/user-data.log) 2>&1',
  '',
  '# ============================================================',
  '# PHASE 1: Attach persistent EBS volume for models',
  '# ============================================================',
  '',
  'INSTANCE_ID=$(curl -s http://169.254.169.254/latest/meta-data/instance-id)',
  'REGION=$(curl -s http://169.254.169.254/latest/meta-data/placement/region)',
  `VOLUME_ID="${modelsVolume.volumeId}"`,
  'MOUNT_POINT="/mnt/models"',
  '',
  '# Wait for volume to be available',
  'echo "Waiting for volume $VOLUME_ID to be available..."',
  'aws ec2 wait volume-available --volume-ids $VOLUME_ID --region $REGION || true',
  '',
  '# Attach the volume',
  'echo "Attaching volume $VOLUME_ID to instance $INSTANCE_ID..."',
  'aws ec2 attach-volume --volume-id $VOLUME_ID --instance-id $INSTANCE_ID --device /dev/xvdf --region $REGION || echo "Volume may already be attached"',
  '',
  '# Wait for attachment',
  'sleep 10',
  'while [ ! -e /dev/xvdf ] && [ ! -e /dev/nvme1n1 ]; do',
  '  echo "Waiting for device to appear..."',
  '  sleep 5',
  'done',
  '',
  '# Determine actual device name (varies by instance type)',
  'if [ -e /dev/nvme1n1 ]; then',
  '  DEVICE=/dev/nvme1n1',
  'else',
  '  DEVICE=/dev/xvdf',
  'fi',
  '',
  '# Check if volume needs formatting (first boot)',
  'if ! blkid $DEVICE; then',
  '  echo "Formatting new volume..."',
  '  mkfs.ext4 $DEVICE',
  'fi',
  '',
  '# Mount the volume',
  'mkdir -p $MOUNT_POINT',
  'mount $DEVICE $MOUNT_POINT',
  'echo "$DEVICE $MOUNT_POINT ext4 defaults,nofail 0 2" >> /etc/fstab',
  '',
  '# Create directory structure',
  'mkdir -p $MOUNT_POINT/ollama',
  'mkdir -p $MOUNT_POINT/huggingface',
  'mkdir -p $MOUNT_POINT/scripts',
  '',
  '# Set up symlinks for model storage',
  'mkdir -p /usr/share/ollama',
  'ln -sf $MOUNT_POINT/ollama /usr/share/ollama/.ollama || true',
  '',
  '# ============================================================',
  '# PHASE 2: Install system dependencies (if not cached)',
  '# ============================================================',
  '',
  '# Check if this is first boot (no marker file)',
  'FIRST_BOOT_MARKER="$MOUNT_POINT/.initialized"',
  '',
  'if [ ! -f "$FIRST_BOOT_MARKER" ]; then',
  '  echo "First boot detected - installing all dependencies..."',
  '  ',
  '  # Install NVIDIA drivers',
  '  apt-get update',
  '  apt-get install -y linux-headers-$(uname -r) build-essential',
  '  apt-get install -y nvidia-driver-535 nvidia-cuda-toolkit',
  '  ',
  '  # Install Ollama',
  '  curl -fsSL https://ollama.com/install.sh | sh',
  '  ',
  '  # Install Python dependencies',
  '  apt-get install -y python3-pip python3-venv awscli',
  '  pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu121',
  '  pip3 install transformers pillow boto3 sentence-transformers numpy requests',
  '  ',
  'else',
  '  echo "Subsequent boot - using cached dependencies"',
  '  # Just ensure Ollama is installed (in case of OS update)',
  '  which ollama || curl -fsSL https://ollama.com/install.sh | sh',
  'fi',
  '',
  '# ============================================================',
  '# PHASE 3: Configure Ollama with persistent storage',
  '# ============================================================',
  '',
  '# Configure Ollama to use mounted volume',
  'mkdir -p /etc/systemd/system/ollama.service.d',
  'cat > /etc/systemd/system/ollama.service.d/override.conf << EOF',
  '[Service]',
  'Environment="OLLAMA_MODELS=$MOUNT_POINT/ollama"',
  'EOF',
  '',
  'systemctl daemon-reload',
  'systemctl enable ollama',
  'systemctl start ollama',
  'sleep 10',
  '',
  '# ============================================================',
  '# PHASE 4: Download models (first boot only)',
  '# ============================================================',
  '',
  'if [ ! -f "$FIRST_BOOT_MARKER" ]; then',
  '  echo "Downloading AI models (first boot)..."',
  '  ',
  '  # Pull Gemma 3 27B (takes ~10 min on first boot)',
  '  OLLAMA_MODELS=$MOUNT_POINT/ollama ollama pull gemma3:27b',
  '  ',
  '  # Pre-download CLIP model for sentence-transformers',
  '  export HF_HOME=$MOUNT_POINT/huggingface',
  '  python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer(\'clip-ViT-L-14\')"',
  '  ',
  '  # Mark initialization complete',
  '  date > $FIRST_BOOT_MARKER',
  '  echo "First boot initialization complete!"',
  'else',
  '  echo "Models already cached on volume"',
  'fi',
  '',
  '# ============================================================',
  '# PHASE 5: Download latest processing script and start service',
  '# ============================================================',
  '',
  '# Always download latest script from S3',
  `aws s3 cp s3://${modelsBucket.bucketName}/scripts/process_images.py $MOUNT_POINT/scripts/process_images.py --region $REGION || echo "Script not found in S3"`,
  '',
  '# Create systemd service for image processor',
  'cat > /etc/systemd/system/picgraf-processor.service << SERVICEEOF',
  '[Unit]',
  'Description=PicGraf Image Processor',
  'After=network.target ollama.service',
  'Requires=ollama.service',
  '',
  '[Service]',
  'Type=simple',
  'WorkingDirectory=$MOUNT_POINT/scripts',
  `Environment=STORAGE_BUCKET=${s3Bucket.bucketName}`,
  `Environment=SQS_QUEUE_URL=${imageProcessingQueue.queueUrl}`,
  `Environment=AWS_REGION=${cdk.Aws.REGION}`,
  `Environment=MODELS_BUCKET=${modelsBucket.bucketName}`,
  'Environment=DYNAMODB_TABLE_PATTERN=Image',
  'Environment=OLLAMA_MODELS=$MOUNT_POINT/ollama',
  'Environment=HF_HOME=$MOUNT_POINT/huggingface',
  'ExecStart=/usr/bin/python3 $MOUNT_POINT/scripts/process_images.py',
  'Restart=on-failure',
  'RestartSec=10',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  'SERVICEEOF',
  '',
  'systemctl daemon-reload',
  'systemctl enable picgraf-processor',
  'systemctl start picgraf-processor',
  '',
  'echo "GPU instance ready for processing!"',
);

// Use Ubuntu 22.04 as base
const gpuAmi = ec2.MachineImage.fromSsmParameter(
  '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
  { os: ec2.OperatingSystemType.LINUX }
);

// Launch template for GPU instances
const gpuLaunchTemplate = new ec2.LaunchTemplate(gpuStack, 'GpuLaunchTemplate', {
  launchTemplateName: 'picgraf-gpu-processor',
  instanceType: ec2.InstanceType.of(ec2.InstanceClass.G5, ec2.InstanceSize.XLARGE),
  machineImage: gpuAmi,
  role: gpuInstanceRole,
  securityGroup: gpuSecurityGroup,
  userData,
  associatePublicIpAddress: true,
  blockDevices: [
    {
      deviceName: '/dev/sda1',
      volume: ec2.BlockDeviceVolume.ebs(50, { // 50GB root (models on separate EBS)
        volumeType: ec2.EbsDeviceVolumeType.GP3,
        encrypted: true,
      }),
    },
  ],
  spotOptions: {
    requestType: ec2.SpotRequestType.ONE_TIME,
    maxPrice: 1.50,
  },
});

// Auto Scaling Group - restricted to single AZ with the EBS volume
const gpuAsg = new autoscaling.AutoScalingGroup(gpuStack, 'GpuAutoScalingGroup', {
  autoScalingGroupName: 'picgraf-gpu-processors',
  vpc,
  vpcSubnets: {
    availabilityZones: [gpuAvailabilityZone], // Must match EBS volume AZ
  },
  launchTemplate: gpuLaunchTemplate,
  minCapacity: 0,
  maxCapacity: 1,
  desiredCapacity: 0,
  healthCheck: autoscaling.HealthCheck.ec2({
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

new cdk.CfnOutput(gpuStack, 'ModelsVolumeId', {
  value: modelsVolume.volumeId,
  description: 'Persistent EBS volume for AI models (100GB)',
});

new cdk.CfnOutput(gpuStack, 'GpuAvailabilityZone', {
  value: gpuAvailabilityZone,
  description: 'Availability Zone for GPU instances and EBS volume',
});
