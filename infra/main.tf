locals {
  name_prefix = "${var.project}-${var.environment}"
  tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    },
    var.tags
  )
  secret_arns = concat(
    # Include ARNs for secrets that exist externally
    var.hmac_secret_name != "" ? [
      "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.hmac_secret_name}*"
    ] : [],
    var.jwt_secret_name != "" ? [
      "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.jwt_secret_name}*"
    ] : [],
    var.secrets_manager_resource_arns
  )
  # Extract Lambda function name from ARN if not explicitly provided
  # ARN format: arn:aws:lambda:REGION:ACCOUNT_ID:function:FUNCTION_NAME
  lambda_function_name = var.lambda_function_name != "" ? var.lambda_function_name : element(split(":", var.lambda_function_arn), length(split(":", var.lambda_function_arn)) - 1)
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

# Public subnets (for NAT gateways)
resource "aws_subnet" "public" {
  for_each = toset(var.public_subnet_cidrs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.key
  availability_zone       = element(data.aws_availability_zones.available.names, index(var.public_subnet_cidrs, each.key))
  map_public_ip_on_launch = true
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-public-${replace(each.key, "/", "-")}"
  })
}

# Private subnets (ECS + internal NLB)
resource "aws_subnet" "private" {
  for_each = toset(var.private_subnet_cidrs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = each.key
  availability_zone = element(data.aws_availability_zones.available.names, index(var.private_subnet_cidrs, each.key))
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-private-${replace(each.key, "/", "-")}"
  })
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-igw"
  })
}

# Elastic IPs for NAT gateways
resource "aws_eip" "nat" {
  for_each = aws_subnet.public

  domain = "vpc"
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-eip-${each.key}"
  })
}

resource "aws_nat_gateway" "nat" {
  for_each = aws_subnet.public

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = each.value.id
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-nat-${each.key}"
  })

  depends_on = [aws_internet_gateway.igw]
}

# Route tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route" "public_internet_access" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.igw.id
}

resource "aws_route_table_association" "public_assoc" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  for_each = aws_nat_gateway.nat

  vpc_id = aws_vpc.main.id
  tags = merge(local.tags, {
    Name = "${local.name_prefix}-private-rt-${each.key}"
  })
}

resource "aws_route" "private_nat" {
  for_each = aws_nat_gateway.nat

  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = each.value.id
}

resource "aws_route_table_association" "private_assoc" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  # pick matching private RT by AZ position
  route_table_id = aws_route_table.private[element(keys(aws_nat_gateway.nat), index(var.private_subnet_cidrs, each.key))].id
}

# ECR
resource "aws_ecr_repository" "app" {
  name = var.ecr_repository_name

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(local.tags, {
    Name = "${local.name_prefix}-ecr"
  })
}

# IAM policy for ECS task role to invoke external Lambda function
# Lambda function is deployed separately in carshop-jwt-lambda repository
data "aws_iam_policy_document" "task_lambda_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [var.lambda_function_arn]
  }
}

resource "aws_iam_policy" "task_lambda_invoke" {
  name   = "${local.name_prefix}-task-lambda-invoke"
  policy = data.aws_iam_policy_document.task_lambda_invoke.json
}

resource "aws_iam_role_policy_attachment" "task_lambda_invoke_attach" {
  role       = aws_iam_role.task_role.name
  policy_arn = aws_iam_policy.task_lambda_invoke.arn
}

# IAM policy for ECS task role to read JWT secret
data "aws_iam_policy_document" "task_jwt_secret" {
  statement {
    actions = ["secretsmanager:GetSecretValue"]
    resources = var.jwt_secret_name != "" ? [
      "arn:aws:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${var.jwt_secret_name}*"
    ] : ["*"]
  }
}

resource "aws_iam_policy" "task_jwt_secret" {
  name   = "${local.name_prefix}-task-jwt-secret"
  policy = data.aws_iam_policy_document.task_jwt_secret.json
}

resource "aws_iam_role_policy_attachment" "task_jwt_secret_attach" {
  role       = aws_iam_role.task_role.name
  policy_arn = aws_iam_policy.task_jwt_secret.arn
}

# IAM roles
data "aws_iam_policy_document" "task_execution_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name_prefix}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.task_execution_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "task_execution_default" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_role" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "task_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = length(local.secret_arns) > 0 ? local.secret_arns : ["*"]
  }
}

resource "aws_iam_policy" "task_secrets" {
  name   = "${local.name_prefix}-task-secrets"
  policy = data.aws_iam_policy_document.task_secrets.json
}

resource "aws_iam_role_policy_attachment" "task_secrets_attach" {
  role       = aws_iam_role.task_role.name
  policy_arn = aws_iam_policy.task_secrets.arn
}

# Log group
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 14
  tags              = local.tags
}

# ECS cluster
resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"
  tags = local.tags
}

# Security group for ECS tasks
resource "aws_security_group" "tasks" {
  name        = "${local.name_prefix}-tasks-sg"
  description = "ECS tasks security group"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "Allow NLB traffic to app port"
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.tags, { Name = "${local.name_prefix}-tasks-sg" })
}

# NLB target group (IP mode)
resource "aws_lb_target_group" "app" {
  name        = substr("${local.name_prefix}-tg", 0, 32)
  port        = var.container_port
  protocol    = "TCP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    protocol = "TCP"
  }

  tags = local.tags
}

# Internal NLB
resource "aws_lb" "nlb" {
  name               = substr("${local.name_prefix}-nlb", 0, 32)
  internal           = true
  load_balancer_type = "network"
  subnets            = values(aws_subnet.private)[*].id
  tags               = local.tags
}

resource "aws_lb_listener" "nlb_listener" {
  load_balancer_arn = aws_lb.nlb.arn
  port              = 80
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# ECS task definition
resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  container_definitions = jsonencode([
    {
      name      = "app"
      image     = "${aws_ecr_repository.app.repository_url}:latest"
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "PORT", value = tostring(var.container_port) },
        { name = "TARGET_BASE_URL", value = var.target_base_url },
        { name = "HMAC_SECRET_NAME", value = var.hmac_secret_name },
        { name = "JWT_SECRET_NAME", value = var.jwt_secret_name },
        { name = "LAMBDA_FUNCTION_NAME", value = local.lambda_function_name },
        { name = "AWS_REGION", value = var.region }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  tags = local.tags
}

# ECS service
resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-svc"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = values(aws_subnet.private)[*].id
    security_groups = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.container_port
  }

  tags = local.tags

  depends_on = [aws_lb_listener.nlb_listener]
}

# API Gateway HTTP API with VPC Link to internal NLB
resource "aws_apigatewayv2_vpc_link" "nlb_link" {
  name               = "${local.name_prefix}-vpc-link"
  security_group_ids = [] # NLB does not use SGs
  subnet_ids         = values(aws_subnet.private)[*].id
  tags               = local.tags
}

resource "aws_apigatewayv2_api" "http_api" {
  name          = var.api_name
  protocol_type = "HTTP"
  tags          = local.tags
}

resource "aws_apigatewayv2_integration" "nlb_integration" {
  api_id                 = aws_apigatewayv2_api.http_api.id
  integration_type       = "HTTP_PROXY"
  integration_method     = "ANY"
  connection_type        = "VPC_LINK"
  connection_id          = aws_apigatewayv2_vpc_link.nlb_link.id
  integration_uri        = aws_lb_listener.nlb_listener.arn
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "proxy" {
  api_id    = aws_apigatewayv2_api.http_api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.nlb_integration.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http_api.id
  name        = "$default"
  auto_deploy = true
  tags        = local.tags
}
