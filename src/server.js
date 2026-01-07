const express = require('express');
const axios = require('axios');
const { getSecret } = require('./secrets');
const { signRequest } = require('./signing');
const { invokeLambda } = require('./lambda-invoke');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_BASE_URL = process.env.TARGET_BASE_URL;
const HMAC_SECRET_NAME = process.env.HMAC_SECRET_NAME;
const JWT_SECRET_NAME = process.env.JWT_SECRET_NAME;
const LAMBDA_FUNCTION_NAME = process.env.LAMBDA_FUNCTION_NAME;
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

if (!TARGET_BASE_URL) {
  console.error('ERROR: TARGET_BASE_URL environment variable is required');
  process.exit(1);
}

if (!HMAC_SECRET_NAME) {
  console.error('ERROR: HMAC_SECRET_NAME environment variable is required');
  process.exit(1);
}

// Middleware to parse JSON bodies while preserving raw body access
// Note: For accurate signing, we don't include body in canonical string per requirements
app.use(express.json());
app.use(express.text());
app.use(express.raw({ type: 'application/octet-stream' }));

// Middleware to add HMAC headers
async function createSignatureMiddleware(req, res, next) {
  try {
    // Always generate timestamp on server side
    const timestamp = new Date().toISOString();
    // Set the header name expected by the target API
    req.headers['x-hmac-timestamp'] = timestamp;

    // Get the secret from AWS Secrets Manager
    const secret = await getSecret(HMAC_SECRET_NAME, AWS_REGION);

    // Compute the signature
    const signature = signRequest(secret, req, timestamp);
    const sigPreview = signature.slice(0, 8);

    // Add signature to request headers for forwarding (header name expected by target API)
    req.headers['x-hmac-signature'] = signature;
    console.log(`[signature] ${req.method} ${req.originalUrl || req.url} sig=${sigPreview}...`);

    next();
  } catch (error) {
    console.error('Error creating signature:', error.message);
    return res.status(500).json({
      error: 'Failed to create signature',
      message: error.message
    });
  }
}

// Helper function to format request details for logging
function formatRequestForLogging(method, url, headers, body) {
  const lines = [];
  lines.push(`${method} ${url} HTTP/1.1`);
  
  // Log headers (sanitize sensitive values)
  Object.keys(headers).forEach(key => {
    let value = headers[key];
    // Truncate HMAC signature in logs for security
    if (key.toLowerCase() === 'x-hmac-signature' && typeof value === 'string' && value.length > 8) {
      value = `${value.slice(0, 8)}...`;
    }
    lines.push(`${key}: ${value}`);
  });
  
  lines.push(''); // Empty line before body
  
  // Log body if present
  if (body !== undefined && body !== null && body !== '') {
    let bodyStr = '';
    if (Buffer.isBuffer(body)) {
      bodyStr = `[Binary data: ${body.length} bytes]`;
    } else if (typeof body === 'object') {
      bodyStr = JSON.stringify(body, null, 2);
    } else {
      bodyStr = String(body);
    }
    
    // Limit body size in logs to avoid huge log entries
    const maxBodyLogSize = 2000;
    if (bodyStr.length > maxBodyLogSize) {
      bodyStr = bodyStr.substring(0, maxBodyLogSize) + `\n... [truncated, total ${bodyStr.length} chars]`;
    }
    lines.push(bodyStr);
  }
  
  return lines.join('\n');
}

// JWT generation endpoint: POST /auth/:cpf
app.post('/auth/:cpf', createSignatureMiddleware, async (req, res) => {
  const start = Date.now();
  try {
    const cpf = req.params.cpf;

    if (!cpf) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'CPF parameter is required'
      });
    }

    // 1. Lookup client from target API with HMAC signature
    const clientLookupPath = `/api/v1/client/cpf/${cpf}`;
    const clientLookupUrl = `${TARGET_BASE_URL}${clientLookupPath}`;
    console.log(`[auth] Looking up client: ${clientLookupUrl}`);

    // Generate signature for the client lookup request
    const hmacSecret = await getSecret(HMAC_SECRET_NAME, AWS_REGION);
    const timestamp = new Date().toISOString();
    const mockReq = {
      method: 'GET',
      originalUrl: clientLookupPath,
      url: clientLookupPath
    };
    const clientSignature = signRequest(hmacSecret, mockReq, timestamp);

    const clientResponse = await axios({
      method: 'GET',
      url: clientLookupUrl,
      headers: {
        'x-hmac-signature': clientSignature,
        'x-hmac-timestamp': timestamp
      },
      validateStatus: () => true,
      timeout: 30000
    });

    if (clientResponse.status !== 200) {
      console.error(`[auth] Client lookup failed: ${clientResponse.status}`, clientResponse.data);
      return res.status(clientResponse.status).json({
        error: 'Client lookup failed',
        message: clientResponse.data?.message || 'Failed to retrieve client information'
      });
    }

    // Extract client data from nested data property
    const client = clientResponse.data?.data || clientResponse.data;
    
    // Validate client data
    if (!client.id || !client.email) {
      console.error('[auth] Invalid client data:', client);
      return res.status(500).json({
        error: 'Invalid client data',
        message: 'Client data missing required fields (id, email)'
      });
    }

    // 2. Fetch JWT secret from AWS Secrets Manager
    if (!JWT_SECRET_NAME) {
      console.error('[auth] JWT_SECRET_NAME environment variable is not set');
      return res.status(500).json({
        error: 'Configuration error',
        message: 'JWT secret name not configured'
      });
    }

    const jwtSecret = await getSecret(JWT_SECRET_NAME, AWS_REGION);
    
    // Log secret retrieval (truncated for security)
    if (jwtSecret) {
      const secretPreview = jwtSecret.length > 8 ? `${jwtSecret.slice(0, 8)}...` : '***';
      console.log(`[auth] JWT secret retrieved (length: ${jwtSecret.length}, preview: ${secretPreview})`);
    } else {
      console.error('[auth] JWT secret is null or undefined');
    }

    // 3. Invoke Lambda function to generate JWT
    if (!LAMBDA_FUNCTION_NAME) {
      console.error('[auth] LAMBDA_FUNCTION_NAME environment variable is not set');
      return res.status(500).json({
        error: 'Configuration error',
        message: 'Lambda function name not configured'
      });
    }

    const lambdaPayload = {
      userId: client.id,
      email: client.email,
      role: client.role || 'user', // Provide default role if not present
      jwtSecret: jwtSecret
    };

    console.log(`[auth] Invoking Lambda function: ${LAMBDA_FUNCTION_NAME}`);
    const lambdaResponse = await invokeLambda(LAMBDA_FUNCTION_NAME, lambdaPayload, AWS_REGION);

    // 4. Return Lambda response to client
    if (lambdaResponse.statusCode === 200 && lambdaResponse.body) {
      res.status(200).json(lambdaResponse.body);
      console.log(`[auth] JWT generated successfully for CPF ${cpf} (${Date.now() - start}ms)`);
    } else {
      throw new Error('Lambda function returned an error');
    }
  } catch (error) {
    console.error('[auth] Error generating JWT:', error.message);
    
    if (error.response) {
      // Error from target API
      res.status(error.response.status || 500).json({
        error: 'Client lookup failed',
        message: error.response.data?.message || error.message
      });
    } else if (error.message.includes('Lambda function')) {
      // Lambda-specific errors
      res.status(500).json({
        error: 'JWT generation failed',
        message: error.message
      });
    } else {
      // Other errors
      res.status(500).json({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }
});

// Catch-all route to proxy requests
app.all('*', createSignatureMiddleware, async (req, res) => {
  const start = Date.now();
  try {
    // Construct target URL
    const targetUrl = `${TARGET_BASE_URL}${req.originalUrl || req.url}`;

    // Prepare headers - copy from request but clean up problematic ones
    const headers = { ...req.headers };
    
    // Remove headers that shouldn't be forwarded or will be set by axios
    delete headers.host;
    delete headers['content-length']; // Let axios calculate this automatically
    
    // Ensure Content-Type is set for JSON bodies
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }

    // Prepare request configuration
    const config = {
      method: req.method,
      url: targetUrl,
      headers: {
        ...headers,
        // Ensure HMAC headers are included (already set by middleware)
        'x-hmac-signature': req.headers['x-hmac-signature'],
        'x-hmac-timestamp': req.headers['x-hmac-timestamp']
      },
      // Forward the body if present
      data: req.body,
      // Don't validate status - forward all status codes
      validateStatus: () => true,
      // Set timeout
      timeout: 30000
    };

    // Log the full request being forwarded
    console.log('[proxy] Forwarding request to target:');
    console.log(formatRequestForLogging(config.method, config.url, config.headers, config.data));

    // Forward the request
    const response = await axios(config);

    // Forward status code
    res.status(response.status);

    // Forward response headers (filter out some that shouldn't be forwarded)
    const headersToSkip = ['connection', 'transfer-encoding', 'content-encoding'];
    if (response.headers) {
      Object.keys(response.headers).forEach(header => {
        if (!headersToSkip.includes(header.toLowerCase())) {
          res.setHeader(header, response.headers[header]);
        }
      });
    }

    // Forward response body
    res.send(response.data);

    console.log(
      `[proxy] ${req.method} ${targetUrl} -> ${response.status} (${Date.now() - start}ms)`
    );
  } catch (error) {
    console.error('Error proxying request:', error.message);
    
    if (error.response) {
      // Forward error response from target
      res.status(error.response.status);
      res.send(error.response.data);

      console.log(
        `[proxy] ${req.method} ${req.originalUrl || req.url} -> upstream ${error.response.status} (${Date.now() - start}ms)`
      );
    } else if (error.code === 'ECONNREFUSED') {
      res.status(502).json({
        error: 'Bad Gateway',
        message: 'Unable to connect to target server'
      });
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      res.status(504).json({
        error: 'Gateway Timeout',
        message: 'Request to target server timed out'
      });
    } else {
      res.status(500).json({
        error: 'Internal Server Error',
        message: error.message
      });
    }
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Start server only if this file is run directly (not when imported for tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Express HMAC Proxy server listening on port ${PORT}`);
    console.log(`Target base URL: ${TARGET_BASE_URL}`);
    console.log(`HMAC Secret Name: ${HMAC_SECRET_NAME}`);
    console.log(`AWS Region: ${AWS_REGION}`);
  });
}

module.exports = app;

