#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"                # set your region
VPC_ID="vpc-0e9b1ac13f726cdaa"    # set the VPC to delete
ECR_REPO="express-hmac-proxy"     # set the ECR repo to delete

confirm() {
  read -r -p "$1 [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]]
}

aws_vpc_filter="Name=vpc-id,Values=${VPC_ID}"

echo "Region: $REGION"
echo "VPC:    $VPC_ID"
echo "ECR:    $ECR_REPO"
confirm "Proceed with deletion?" || exit 0

echo "Deleting ECS load balancers (ALB/NLB) in VPC..."
for lb_arn in $(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "LoadBalancers[?VpcId=='${VPC_ID}'].LoadBalancerArn" --output text); do
  echo "  Deleting LB $lb_arn"
  aws elbv2 delete-load-balancer --region "$REGION" --load-balancer-arn "$lb_arn"
done

echo "Deleting NAT gateways..."
for nat_id in $(aws ec2 describe-nat-gateways --region "$REGION" --filter "$aws_vpc_filter" \
  --query "NatGateways[].NatGatewayId" --output text); do
  echo "  Deleting NAT $nat_id"
  aws ec2 delete-nat-gateway --region "$REGION" --nat-gateway-id "$nat_id"
done

echo "Releasing EIPs from NAT gateways..."
for alloc_id in $(aws ec2 describe-addresses --region "$REGION" \
  --filters "$aws_vpc_filter" \
  --query "Addresses[].AllocationId" --output text); do
  echo "  Releasing EIP $alloc_id"
  aws ec2 release-address --region "$REGION" --allocation-id "$alloc_id"
done

echo "Deleting route tables (non-main)..."
for rt_id in $(aws ec2 describe-route-tables --region "$REGION" --filters "$aws_vpc_filter" \
  --query "RouteTables[?Associations[?Main==false]].RouteTableId" --output text); do
  echo "  Removing associations for $rt_id"
  for assoc in $(aws ec2 describe-route-tables --region "$REGION" --route-table-id "$rt_id" \
    --query "RouteTables[].Associations[].RouteTableAssociationId" --output text); do
    aws ec2 disassociate-route-table --region "$REGION" --association-id "$assoc"
  done
  echo "  Deleting $rt_id"
  aws ec2 delete-route-table --region "$REGION" --route-table-id "$rt_id"
done

echo "Detaching and deleting Internet Gateway..."
IGW_ID=$(aws ec2 describe-internet-gateways --region "$REGION" --filters "$aws_vpc_filter" \
  --query "InternetGateways[].InternetGatewayId" --output text || true)
if [[ -n "$IGW_ID" ]]; then
  aws ec2 detach-internet-gateway --region "$REGION" --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID" || true
  aws ec2 delete-internet-gateway --region "$REGION" --internet-gateway-id "$IGW_ID"
fi

echo "Deleting subnets..."
for sn in $(aws ec2 describe-subnets --region "$REGION" --filters "$aws_vpc_filter" \
  --query "Subnets[].SubnetId" --output text); do
  echo "  Deleting subnet $sn"
  aws ec2 delete-subnet --region "$REGION" --subnet-id "$sn"
done

echo "Deleting non-default security groups..."
for sg in $(aws ec2 describe-security-groups --region "$REGION" --filters "$aws_vpc_filter" \
  --query "SecurityGroups[?GroupName!='default'].GroupId" --output text); do
  echo "  Deleting SG $sg"
  aws ec2 delete-security-group --region "$REGION" --group-id "$sg"
done

echo "Ensuring no ENIs remain..."
enis=$(aws ec2 describe-network-interfaces --region "$REGION" --filters "$aws_vpc_filter" \
  --query "NetworkInterfaces[].NetworkInterfaceId" --output text)
if [[ -n "$enis" ]]; then
  echo "ENIs still present; delete them before removing VPC:"
  echo "$enis"
  exit 1
fi

echo "Deleting VPC..."
aws ec2 delete-vpc --region "$REGION" --vpc-id "$VPC_ID"

echo "Deleting ECR repo $ECR_REPO..."
aws ecr delete-repository --region "$REGION" --repository-name "$ECR_REPO" --force

echo "Done."