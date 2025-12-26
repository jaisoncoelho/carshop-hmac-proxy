const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Cache secrets by key (secretName:region)
const cachedSecrets = {};
const secretPromises = {};

/**
 * Fetches a secret from AWS Secrets Manager
 * @param {string} secretName - Name of the secret in AWS Secrets Manager
 * @param {string} region - AWS region
 * @returns {Promise<string>} The secret value
 */
async function getSecret(secretName, region = process.env.AWS_REGION || 'us-east-1') {
  // Create a cache key from secret name and region
  const cacheKey = `${secretName}:${region}`;

  // Return cached secret if available
  if (cachedSecrets[cacheKey]) {
    return cachedSecrets[cacheKey];
  }

  // If a fetch is already in progress for this secret, wait for it
  if (secretPromises[cacheKey]) {
    return secretPromises[cacheKey];
  }

  // Start fetching the secret
  secretPromises[cacheKey] = (async () => {
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

      // Trim whitespace and newlines from the secret (AWS Secrets Manager may add trailing newlines)
      secret = secret.trim();

      // Cache the secret by key
      cachedSecrets[cacheKey] = secret;
      return secret;
    } catch (error) {
      // Clear the promise so we can retry
      delete secretPromises[cacheKey];
      throw new Error(`Failed to fetch secret from AWS Secrets Manager: ${error.message}`);
    } finally {
      // Clear the promise after completion (success or failure)
      delete secretPromises[cacheKey];
    }
  })();

  return secretPromises[cacheKey];
}

/**
 * Clears the cached secret (useful for testing or refresh scenarios)
 * @param {string} secretName - Optional secret name to clear specific secret, or clears all if not provided
 * @param {string} region - Optional region to clear specific secret
 */
function clearCache(secretName = null, region = process.env.AWS_REGION || 'us-east-1') {
  if (secretName) {
    const cacheKey = `${secretName}:${region}`;
    delete cachedSecrets[cacheKey];
    delete secretPromises[cacheKey];
  } else {
    // Clear all cached secrets
    Object.keys(cachedSecrets).forEach(key => delete cachedSecrets[key]);
    Object.keys(secretPromises).forEach(key => delete secretPromises[key]);
  }
}

module.exports = {
  getSecret,
  clearCache
};

