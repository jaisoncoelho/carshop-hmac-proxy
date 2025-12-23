const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

/**
 * Invokes a Lambda function synchronously
 * @param {string} functionName - Name of the Lambda function to invoke
 * @param {Object} payload - Payload to send to the Lambda function
 * @param {string} region - AWS region (defaults to us-east-1)
 * @returns {Promise<Object>} Parsed response from Lambda function
 */
async function invokeLambda(functionName, payload, region = process.env.AWS_REGION || 'us-east-1') {
  try {
    const client = new LambdaClient({ region });
    const command = new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse', // Synchronous invocation
      Payload: JSON.stringify(payload)
    });

    const response = await client.send(command);

    // Parse the response payload
    if (response.Payload) {
      const responseBody = JSON.parse(Buffer.from(response.Payload).toString());
      
      // If Lambda returned an error status code, throw an error
      if (responseBody.statusCode && responseBody.statusCode >= 400) {
        const errorBody = JSON.parse(responseBody.body);
        throw new Error(errorBody.message || errorBody.error || 'Lambda function returned an error');
      }

      // Parse the body if it's a string
      if (typeof responseBody.body === 'string') {
        try {
          responseBody.body = JSON.parse(responseBody.body);
        } catch (e) {
          // If parsing fails, keep it as a string
        }
      }

      return responseBody;
    }

    throw new Error('Empty response from Lambda function');
  } catch (error) {
    // Handle AWS SDK errors
    if (error.name === 'ResourceNotFoundException') {
      throw new Error(`Lambda function ${functionName} not found`);
    }
    if (error.name === 'InvalidParameterValueException') {
      throw new Error(`Invalid parameter for Lambda function ${functionName}`);
    }
    throw error;
  }
}

module.exports = {
  invokeLambda
};

