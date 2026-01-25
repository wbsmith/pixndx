#!bash

ec2instance=aws ec2 run-instances \
  --image-id ami-05c9c6b0a8129b523 \
  --instance-type g5.xlarge \
  --key-name pixndx-admin \
  --security-group-ids sg-0c16a96d1822d96a6 \
  --subnet-id subnet-06849bfcfa6e34831 \
  --iam-instance-profile Name=amplify-d2lj29cnhp0ir0-main-branch-3d6a030b72-storage0EC3F24A-1EYAI9S0STTTM-GpuLaunchTemplateProfile2D03B57E-hdcR3DIuJm7u \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=pixndx-gpu-manual-test}]' \
  --query 'Instances[0].InstanceId' \
  --output text

#Now let me get the public IP for SSH:

ec2_ip=aws ec2 describe-instances --instance-ids $ec2instance --query 'Reservations[0].Instances[0].PublicIpAddress' --output text

ssh -i ~/.ssh/pixndx-admin.pem ubuntu@$ec2_ip

