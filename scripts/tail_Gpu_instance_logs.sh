#!/bin/bash


  # Check instance system logs (console output)
  INSTANCE_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=*GPU*" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0].InstanceId' --output text)
  echo "Instance: $INSTANCE_ID"
  aws ec2 get-console-output --instance-id $INSTANCE_ID --output text | tail -100

  # Check if SSM agent is online (for remote commands)
  aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE_ID" --query 'InstanceInformationList[0].[PingStatus,LastPingDateTime]' --output table

  # Check EFS for activity (mount targets and connections)
  aws efs describe-mount-targets --file-system-id $(aws efs describe-file-systems --query 'FileSystems[?Name!=`null`].FileSystemId' --output text | head -1) --query 'MountTargets[].[AvailabilityZoneName,LifeCycleState,IpAddress]' --output table

  # Check CloudWatch metrics for EFS activity (last 30 min)
  aws cloudwatch get-metric-statistics --namespace AWS/EFS --metric-name ClientConnections --dimensions Name=FileSystemId,Value=$(aws efs describe-file-systems --query 'FileSystems[0].FileSystemId' --output text) --start-time $(date -u -v-30M +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) --period 300 --statistics Sum

  If SSM is online, you can run commands directly:

  # Run command on instance via SSM
  aws ssm send-command --instance-ids $INSTANCE_ID --document-name "AWS-RunShellScript" --parameters 'commands=["df -h | grep efs", "ps aux | grep python", "cat /var/log/cloud-init-output.log | tail -50"]' --output text

  # Get command output (wait a few seconds after above)
  aws ssm list-command-invocations --instance-id $INSTANCE_ID --details --query 'CommandInvocations[0].CommandPlugins[0].Output' --output text

  What does the console output show?

❯ seems to be stuck for awhile 'collecting torch': [  351.456596] cloud-init[1299]:   Downloading https://download.pytorch.org/whl/cu121/torch-2.5.1%2Bcu121-cp310-cp310-linux_x86_64.whl (780.4 MB). and i see in   
  the instance details an EBS is mounted, but not an EFS. so there's that as well. how can i see if the EFS we created has been mounted anywhere?                                                                    

⏺ Two issues: slow PyTorch download (normal for first boot, ~780MB), and EFS not mounted. Let's diagnose the EFS:

  # List all EFS filesystems
  aws efs describe-file-systems --query 'FileSystems[].[FileSystemId,Name,LifeCycleState,NumberOfMountTargets]' --output table

  # Check mount targets for each EFS
  aws efs describe-file-systems --query 'FileSystems[].FileSystemId' --output text | while read fs; do
    echo "=== $fs ==="
    aws efs describe-mount-targets --file-system-id $fs --query 'MountTargets[].[AvailabilityZoneName,LifeCycleState,IpAddress]' --output table
  done

  # Check what the instance's user data says about mounting
 aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].UserData' --output text | base64 -d | grep -A5 -i "efs\|mount"


  # Get instance's security groups and check for NFS rule
  aws ec2 describe-instances --instance-ids $INSTANCE_ID --query 'Reservations[0].Instances[0].SecurityGroups[].GroupId' --output text | while read sg; do
    echo "=== $sg ==="
    aws ec2 describe-security-groups --group-ids $sg --query 'SecurityGroups[0].IpPermissions[?FromPort==`2049`]' --output table
  done

