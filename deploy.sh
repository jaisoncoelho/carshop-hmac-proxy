#!/bin/bash
set -e

# Load AWS profile from infra/commands (but don't run terraform)
export AWS_PROFILE=jaison

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=${AWS_REGION:-us-east-1}
ECR_REPO="express-hmac-proxy"
ECR_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}"
IMAGE_TAG="latest"
CLUSTER_NAME="express-hmac-proxy-prod-cluster"
SERVICE_NAME="express-hmac-proxy-prod-svc"

echo "🚀 Starting deployment..."
echo "ECR Repository: ${ECR_URI}"
echo "Image Tag: ${IMAGE_TAG}"

# Step 1: Build Docker image for linux/amd64 platform (required for ECS Fargate)
echo ""
echo "📦 Building Docker image for linux/amd64 platform..."
docker build --platform linux/amd64 -t ${ECR_REPO}:${IMAGE_TAG} .

# Step 2: Authenticate Docker to ECR
echo ""
echo "🔐 Authenticating Docker to ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_URI}

# Step 3: Tag image for ECR
echo ""
echo "🏷️  Tagging image..."
docker tag ${ECR_REPO}:${IMAGE_TAG} ${ECR_URI}:${IMAGE_TAG}

# Step 4: Push image to ECR
echo ""
echo "⬆️  Pushing image to ECR..."
docker push ${ECR_URI}:${IMAGE_TAG}

# Step 5: Force new deployment in ECS
echo ""
echo "🔄 Forcing new ECS deployment..."
aws ecs update-service \
  --cluster ${CLUSTER_NAME} \
  --service ${SERVICE_NAME} \
  --force-new-deployment \
  --region ${AWS_REGION} \
  --query 'service.{ServiceName:serviceName,Status:status,DesiredCount:desiredCount,RunningCount:runningCount}' \
  --output table

echo ""
echo "✅ Deployment initiated!"
echo "📊 Monitor deployment status with:"
echo "   aws ecs describe-services --cluster ${CLUSTER_NAME} --services ${SERVICE_NAME} --region ${AWS_REGION}"

