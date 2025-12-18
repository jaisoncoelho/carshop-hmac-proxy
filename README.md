# Express HMAC Proxy

An Express.js API proxy that receives requests from AWS API Gateway and forwards them to target backends, adding an `X-Signature` header containing an HMAC-SHA256 signature.

## Overview

This proxy acts as an intermediary between AWS API Gateway and your target backend services. It:

1. Receives requests from API Gateway
2. Reads the `X-Timestamp` header from incoming requests
3. Computes an HMAC-SHA256 signature using a secret from AWS Secrets Manager
4. Adds the signature as an `X-Signature` header
5. Forwards the request to the target backend

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

## Installation

```bash
npm install
```

## Configuration

Set the following environment variables:

- `PORT` - Port for the Express server (default: 3000)
- `TARGET_BASE_URL` - Base URL of the target backend (required)
- `HMAC_SECRET_NAME` - Name of the secret in AWS Secrets Manager (required)
- `AWS_REGION` - AWS region for Secrets Manager (default: us-east-1)

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
1. Read the `X-Timestamp` header
2. Fetch the HMAC secret from AWS Secrets Manager
3. Compute the signature over the canonical string
4. Forward the request to `TARGET_BASE_URL/api/users` with the `X-Signature` header added

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
- Ensure the proxy has appropriate IAM permissions to access AWS Secrets Manager
- Use HTTPS in production to protect requests in transit
- Consider implementing rate limiting and request validation

## License

ISC

