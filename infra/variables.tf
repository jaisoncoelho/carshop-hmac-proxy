variable "project" {
  description = "Project name prefix for resources"
  type        = string
  default     = "express-hmac-proxy"
}

variable "environment" {
  description = "Deployment environment (e.g., dev, prod)"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDRs for public subnets (used for NAT gateways)"
  type        = list(string)
  default     = ["10.0.0.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDRs for private subnets (ECS tasks, internal NLB)"
  type        = list(string)
  default     = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "ecr_repository_name" {
  description = "Name of the ECR repository to create"
  type        = string
  default     = "express-hmac-proxy"
}

variable "container_port" {
  description = "Application container port"
  type        = number
  default     = 3000
}

variable "desired_count" {
  description = "Number of ECS tasks to run"
  type        = number
  default     = 1
}

variable "task_cpu" {
  description = "CPU units for the task definition"
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Memory (MiB) for the task definition"
  type        = number
  default     = 512
}

variable "target_base_url" {
  description = "Target base URL for the proxy (required at deploy time)"
  type        = string
  default     = ""
}

variable "hmac_secret_name" {
  description = "Secrets Manager secret name containing the HMAC key (must exist externally)"
  type        = string
  default     = ""
}

variable "secrets_manager_resource_arns" {
  description = "List of Secrets Manager ARNs tasks can read (leave empty to allow any - not recommended)"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional resource tags"
  type        = map(string)
  default     = {}
}

variable "api_name" {
  description = "Name for API Gateway HTTP API"
  type        = string
  default     = "express-hmac-proxy-http-api"
}

variable "jwt_secret_name" {
  description = "Secrets Manager secret name containing the JWT signing key (must exist externally)"
  type        = string
  default     = ""
}

variable "lambda_function_name" {
  description = "Name for the Lambda function that generates JWT tokens"
  type        = string
  default     = ""
}

