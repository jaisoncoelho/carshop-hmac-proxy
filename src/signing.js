const crypto = require('crypto');

/**
 * Builds the canonical string for HMAC signing
 * Format: <HTTP_METHOD>\n<PATH_AND_QUERY>\n<TIMESTAMP>\n
 * 
 * @param {string} method - HTTP method (e.g., 'GET', 'POST')
 * @param {string} pathAndQuery - Path and query string (e.g., '/api/users?page=1')
 * @param {string} timestamp - Timestamp string
 * @returns {string} Canonical string
 */
function buildCanonicalString(method, pathAndQuery, timestamp) {
  return `${method}\n${pathAndQuery}\n${timestamp}\n`;
}

/**
 * Computes HMAC-SHA256 signature
 * 
 * @param {string} secret - Secret key for HMAC
 * @param {string} canonicalString - Canonical string to sign
 * @returns {string} Hexadecimal signature
 */
function computeSignature(secret, canonicalString) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(canonicalString);
  return hmac.digest('hex');
}

/**
 * Extracts path and query from request URL
 * 
 * @param {Object} req - Express request object
 * @returns {string} Path and query string
 */
function extractPathAndQuery(req) {
  // Use originalUrl which includes the query string, or fallback to path + query
  const url = req.originalUrl || req.url;
  // Ensure it starts with / if it's a path
  return url.startsWith('/') ? url : `/${url}`;
}

/**
 * Gets timestamp from request headers
 * 
 * @param {Object} req - Express request object
 * @returns {string|null} Timestamp from X-Timestamp header, or null if not found
 */
function getTimestampFromHeader(req) {
  return req.headers['x-timestamp'] || req.headers['X-Timestamp'] || null;
}

/**
 * Creates a signature for the request
 * 
 * @param {string} secret - HMAC secret
 * @param {Object} req - Express request object
 * @returns {string} HMAC-SHA256 signature in hexadecimal format
 */
function signRequest(secret, req) {
  const method = req.method.toUpperCase();
  const pathAndQuery = extractPathAndQuery(req);
  const timestamp = getTimestampFromHeader(req);

  if (!timestamp) {
    throw new Error('X-Timestamp header is required');
  }

  const canonicalString = buildCanonicalString(method, pathAndQuery, timestamp);
  return computeSignature(secret, canonicalString);
}

module.exports = {
  buildCanonicalString,
  computeSignature,
  extractPathAndQuery,
  getTimestampFromHeader,
  signRequest
};

