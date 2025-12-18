const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

let cachedSecret = null;
let secretPromise = null;

/**
 * Fetches the HMAC secret from AWS Secrets Manager
 * @param {string} secretName - Name of the secret in AWS Secrets Manager
 * @param {string} region - AWS region
 * @returns {Promise<string>} The secret value
 */
async function getSecret(secretName, region = process.env.AWS_REGION || 'us-east-1') {
  // Return cached secret if available
  if (cachedSecret) {
    return cachedSecret;
  }

  // If a fetch is already in progress, wait for it
  if (secretPromise) {
    return secretPromise;
  }

  // Start fetching the secret
  secretPromise = (async () => {
    try {
      const client = new SecretsManagerClient({ region });
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await client.send(command);

      let secret;
      if (response.SecretString) {
        secret = response.SecretString;
      } else {
        secret = Buffer.from(response.SecretBinary, 'base64').toString('utf-8');
      }

      // Cache the secret
      cachedSecret = secret;
      return secret;
    } catch (error) {
      // Clear the promise so we can retry
      secretPromise = null;
      throw new Error(`Failed to fetch secret from AWS Secrets Manager: ${error.message}`);
    }
  })();

  return secretPromise;
}

/**
 * Clears the cached secret (useful for testing or refresh scenarios)
 */
function clearCache() {
  cachedSecret = null;
  secretPromise = null;
}

module.exports = {
  getSecret,
  clearCache
};

