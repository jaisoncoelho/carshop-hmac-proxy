const jwt = require('jsonwebtoken');

/**
 * Generates a unique ID for JWT jti claim
 * @returns {string} Unique ID in format: timestamp-randomstring
 */
function generateUniqueId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Lambda handler to generate JWT token
 * @param {Object} event - Event payload containing userId, email, jwtSecret
 * @returns {Object} Response with token, expires_in, and token_type
 */
exports.handler = async (event) => {
  try {
    const { userId, email, jwtSecret } = event;

    // Validate required fields
    if (!userId || !email || !jwtSecret) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required fields',
          message: 'userId, email and jwtSecret are required'
        })
      };
    }

    // Generate JWT payload
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: userId,
      email: email,
      role: 'USER',
      iat: now,
      jti: generateUniqueId()
    };

    // Set expiration to 1 hour (3600 seconds)
    const expiresIn = 3600;
    payload.exp = now + expiresIn;

    // Sign the JWT
    const token = jwt.sign(payload, jwtSecret, {
      algorithm: 'HS256'
    });

    // Return token response
    return {
      statusCode: 200,
      body: JSON.stringify({
        token: token,
        expires_in: expiresIn,
        token_type: 'Bearer'
      })
    };
  } catch (error) {
    console.error('Error generating JWT:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      })
    };
  }
};

