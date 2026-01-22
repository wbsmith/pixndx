import type { AppSyncResolverHandler } from 'aws-lambda';
import { S3Client, CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { AutoScalingClient, DescribeAutoScalingGroupsCommand, SetDesiredCapacityCommand } from '@aws-sdk/client-auto-scaling';

const s3 = new S3Client({});
const sqs = new SQSClient({});
const autoscaling = new AutoScalingClient({});

const BUCKET_NAME = process.env.STORAGE_BUCKET_NAME;
const QUEUE_URL = process.env.SQS_QUEUE_URL;
const ASG_NAME = process.env.ASG_NAME;

interface ProcessImageInput {
  sourceKey: string; // S3 key of uploaded image (e.g., uploads/admin/xxx.jpg)
}

interface ProcessImageResult {
  success: boolean;
  imageId: string;
  message: string;
  queuedAt: string;
}

export const handler: AppSyncResolverHandler<ProcessImageInput, ProcessImageResult> = async (event) => {
  const { sourceKey } = event.arguments;

  if (!BUCKET_NAME) {
    throw new Error('STORAGE_BUCKET_NAME not configured');
  }

  // Extract original filename and preserve it
  const fullFilename = sourceKey.split('/').pop() || 'unknown.jpg';
  // Remove timestamp prefix if frontend added one (e.g., "1234567890-myimage.jpg" -> "myimage.jpg")
  const originalFilename = fullFilename.replace(/^\d+-/, '');
  const extension = originalFilename.split('.').pop()?.toLowerCase() || 'jpg';
  // Use original filename (without extension) as the image ID
  const imageId = originalFilename.replace(/\.[^.]+$/, '');
  // Use timestamped key for processing queue to avoid collisions during processing
  const queueKey = `processing-queue/${Date.now()}-${originalFilename}`;

  try {
    // Verify source file exists
    await s3.send(new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: sourceKey,
    }));

    // Copy to processing queue
    await s3.send(new CopyObjectCommand({
      Bucket: BUCKET_NAME,
      CopySource: `${BUCKET_NAME}/${sourceKey}`,
      Key: queueKey,
    }));

    // Send SQS message for GPU processing
    if (QUEUE_URL) {
      await sqs.send(new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify({
          imageId,
          sourceKey: queueKey,
          originalKey: sourceKey,
          timestamp: new Date().toISOString(),
        }),
      }));
    }

    // Check if GPU instance is running, start if not
    if (ASG_NAME) {
      await ensureGpuInstanceRunning();
    }

    return {
      success: true,
      imageId,
      message: 'Image queued for processing',
      queuedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to process image:', error);
    throw new Error(`Failed to queue image for processing: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Check if GPU Auto Scaling Group has running instances, start one if not
 */
async function ensureGpuInstanceRunning(): Promise<void> {
  if (!ASG_NAME) return;

  try {
    const describeResult = await autoscaling.send(new DescribeAutoScalingGroupsCommand({
      AutoScalingGroupNames: [ASG_NAME],
    }));

    const asg = describeResult.AutoScalingGroups?.[0];
    if (!asg) {
      console.warn(`ASG ${ASG_NAME} not found`);
      return;
    }

    // If no instances running, set desired capacity to 1
    if ((asg.DesiredCapacity || 0) === 0) {
      console.log(`Starting GPU instance in ASG ${ASG_NAME}`);
      await autoscaling.send(new SetDesiredCapacityCommand({
        AutoScalingGroupName: ASG_NAME,
        DesiredCapacity: 1,
      }));
    } else {
      console.log(`GPU instance already running in ASG ${ASG_NAME}`);
    }
  } catch (error) {
    // Log but don't fail - processing will happen when instance comes up
    console.warn('Failed to check/start GPU instance:', error);
  }
}
