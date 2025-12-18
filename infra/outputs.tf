output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = values(aws_subnet.public)[*].id
}

output "private_subnet_ids" {
  value = values(aws_subnet.private)[*].id
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "nlb_dns_name" {
  value = aws_lb.nlb.dns_name
}

output "ecs_task_security_group_id" {
  value = aws_security_group.tasks.id
}

output "http_api_endpoint" {
  value = aws_apigatewayv2_api.http_api.api_endpoint
}

output "hmac_secret_arn" {
  value       = var.create_hmac_secret ? aws_secretsmanager_secret.hmac[0].arn : null
  description = "ARN of the HMAC secret if managed by Terraform"
}

