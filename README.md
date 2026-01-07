# Express HMAC Proxy

An Express.js API proxy that receives requests from AWS API Gateway and forwards them to target backends, adding an `X-Signature` header containing an HMAC-SHA256 signature.

## Overview

This proxy acts as an intermediary between AWS API Gateway and your target backend services. It:

1. Receives requests from API Gateway
2. Generates an ISO timestamp for each request
3. Computes an HMAC-SHA256 signature using a secret from AWS Secrets Manager
4. Adds the signature and timestamp as `x-hmac-signature` and `x-hmac-timestamp` headers
5. Forwards the request to the target backend

Additionally, the proxy provides a special endpoint `/auth/:cpf` that:
- Looks up a client by CPF
- Invokes a Lambda function to generate a JWT token
- Returns the JWT token to the client

## Canonical String Format

The signature is computed over a canonical string with the following format:

```
<HTTP_METHOD>\n
<PATH_AND_QUERY>\n
<TIMESTAMP>\n
```

**Note:** The request body is NOT included in the canonical string.

## Prerequisites

- Node.js (v14 or higher)
- AWS credentials configured (via AWS CLI, IAM role, or environment variables)
- Access to AWS Secrets Manager to retrieve the HMAC secret
- **Lambda Function**: The JWT generator Lambda function must be deployed separately from the [carshop-jwt-lambda](https://github.com/your-org/carshop-jwt-lambda) repository

## Installation

```bash
npm install
```

## Configuration

Set the following environment variables:

- `PORT` - Port for the Express server (default: 3000)
- `TARGET_BASE_URL` - Base URL of the target backend (required)
- `HMAC_SECRET_NAME` - Name of the secret in AWS Secrets Manager (required)
- `JWT_SECRET_NAME` - Name of the JWT secret in AWS Secrets Manager (required for JWT generation)
- `LAMBDA_FUNCTION_NAME` - Name of the Lambda function that generates JWT tokens (required for JWT generation)
- `AWS_REGION` - AWS region for Secrets Manager and Lambda (default: us-east-1)

## Usage

### Running the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

### Example Request

The proxy expects an `X-Timestamp` header in incoming requests:

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: 2024-01-15T10:30:00Z" \
  -d '{"name": "John Doe"}'
```

The proxy will:
1. Generate an ISO timestamp
2. Fetch the HMAC secret from AWS Secrets Manager
3. Compute the signature over the canonical string
4. Forward the request to `TARGET_BASE_URL/api/users` with the `x-hmac-signature` and `x-hmac-timestamp` headers added

### JWT Generation Endpoint

The proxy also provides a JWT generation endpoint for client authentication:

```bash
curl -X POST http://localhost:3000/auth/12345678900
```

This endpoint:
1. Looks up the client by CPF in the target backend
2. Retrieves the JWT secret from AWS Secrets Manager
3. Invokes the Lambda function to generate a JWT token
4. Returns the token with `expires_in` and `token_type`

**Note**: The Lambda function must be deployed separately from the [carshop-jwt-lambda](https://github.com/your-org/carshop-jwt-lambda) repository and the `LAMBDA_FUNCTION_NAME` environment variable must be set.

## AWS API Gateway Integration

To use this proxy with AWS API Gateway:

1. Deploy the Express server to an environment accessible by API Gateway (e.g., EC2, ECS, Lambda, or Elastic Beanstalk)
2. Configure API Gateway to:
   - Pass through all HTTP methods and paths
   - Forward all headers (especially `X-Timestamp`)
   - Forward the request body
   - Route to your proxy endpoint

### Example API Gateway Configuration

- Integration type: HTTP Proxy
- Endpoint URL: `http://your-proxy-host:3000`
- Method: ANY (to handle all HTTP methods)
- Path: `{proxy+}` (to forward all paths)

## Signature Verification

The target backend can verify the signature by:

1. Reconstructing the canonical string using the same format
2. Computing HMAC-SHA256 with the shared secret
3. Comparing the computed signature with the `X-Signature` header

## Error Handling

The proxy returns appropriate HTTP status codes:

- `400` - Missing `X-Timestamp` header
- `500` - Failed to fetch secret or compute signature
- `502` - Unable to connect to target server
- `504` - Request to target server timed out
- Other status codes are forwarded from the target backend

## Security Considerations

- The HMAC secret is cached in memory after the first fetch
- Ensure the proxy has appropriate IAM permissions to:
  - Access AWS Secrets Manager (for HMAC and JWT secrets)
  - Invoke the Lambda function (for JWT generation)
- Use HTTPS in production to protect requests in transit
- Consider implementing rate limiting and request validation

## Lambda Function Integration

The proxy integrates with a separate Lambda function for JWT token generation. The Lambda function is deployed independently from the [carshop-jwt-lambda](https://github.com/your-org/carshop-jwt-lambda) repository.

**Deployment Order:**
1. Deploy the Lambda function from the `carshop-jwt-lambda` repository
2. Get the Lambda function ARN from the Terraform outputs
3. Deploy this proxy with the `lambda_function_arn` Terraform variable set

**IAM Permissions:**
The ECS task role must have permission to invoke the Lambda function. This is configured automatically via Terraform when `lambda_function_arn` is provided.

## License

ISC

