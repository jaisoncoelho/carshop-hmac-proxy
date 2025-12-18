const express = require('express');
const axios = require('axios');
const { getSecret } = require('./secrets');
const { signRequest, getTimestampFromHeader } = require('./signing');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_BASE_URL = process.env.TARGET_BASE_URL;
const HMAC_SECRET_NAME = process.env.HMAC_SECRET_NAME;
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

// Middleware to add X-Signature header
async function createSignatureMiddleware(req, res, next) {
  try {
    // Check if timestamp header exists
    let timestamp = getTimestampFromHeader(req);
    if (!timestamp) {
      timestamp = new Date().toISOString();
      req.headers['X-Timestamp'] = timestamp;
    }

    // Get the secret from AWS Secrets Manager
    const secret = await getSecret(HMAC_SECRET_NAME, AWS_REGION);

    // Compute the signature
    const signature = signRequest(secret, req);
    const sigPreview = signature.slice(0, 8);

    // Add signature to request headers for forwarding
    req.headers['X-Signature'] = signature;
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

// Catch-all route to proxy requests
app.all('*', createSignatureMiddleware, async (req, res) => {
  try {
    // Construct target URL
    const targetUrl = `${TARGET_BASE_URL}${req.originalUrl || req.url}`;

    const start = Date.now();
    console.log(`[proxy] ${req.method} ${targetUrl}`);

    // Prepare request configuration
    const config = {
      method: req.method,
      url: targetUrl,
      headers: {
        ...req.headers,
        // Ensure X-Signature is included (already set by middleware)
        'X-Signature': req.headers['X-Signature']
      },
      // Forward the body if present
      data: req.body,
      // Don't validate status - forward all status codes
      validateStatus: () => true,
      // Set timeout
      timeout: 30000
    };

    // Remove host header to avoid conflicts
    delete config.headers.host;

    // Forward the request
    const response = await axios(config);

    // Forward status code
    res.status(response.status);

    // Forward response headers (filter out some that shouldn't be forwarded)
    const headersToSkip = ['connection', 'transfer-encoding', 'content-encoding'];
    Object.keys(response.headers).forEach(header => {
      if (!headersToSkip.includes(header.toLowerCase())) {
        res.setHeader(header, response.headers[header]);
      }
    });

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
    } else if (error.code === 'ETIMEDOUT') {
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

// Start server
app.listen(PORT, () => {
  console.log(`Express HMAC Proxy server listening on port ${PORT}`);
  console.log(`Target base URL: ${TARGET_BASE_URL}`);
  console.log(`HMAC Secret Name: ${HMAC_SECRET_NAME}`);
  console.log(`AWS Region: ${AWS_REGION}`);
});

module.exports = app;

