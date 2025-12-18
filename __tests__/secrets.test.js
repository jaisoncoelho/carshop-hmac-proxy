const { getSecret, clearCache } = require('../src/secrets');

// Jest mock for the AWS SDK client used in secrets.js
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => {
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({
      send: mockSend
    })),
    GetSecretValueCommand: jest.fn()
  };
});

describe('getSecret caching behavior', () => {
  beforeEach(() => {
    mockSend.mockReset();
    clearCache();
  });

  it('caches the secret after the first fetch', async () => {
    mockSend.mockResolvedValue({ SecretString: 'cached-value' });

    const first = await getSecret('my-secret');
    const second = await getSecret('my-secret');

    expect(first).toBe('cached-value');
    expect(second).toBe('cached-value');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent fetches using secretPromise', async () => {
    let resolveFetch;
    mockSend.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const pending1 = getSecret('my-secret');
    const pending2 = getSecret('my-secret');

    expect(mockSend).toHaveBeenCalledTimes(1);

    resolveFetch({ SecretString: 'concurrent-value' });
    const [value1, value2] = await Promise.all([pending1, pending2]);

    expect(value1).toBe('concurrent-value');
    expect(value2).toBe('concurrent-value');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('refetches after cache is cleared', async () => {
    mockSend.mockResolvedValue({ SecretString: 'first-value' });
    const first = await getSecret('my-secret');
    expect(first).toBe('first-value');
    expect(mockSend).toHaveBeenCalledTimes(1);

    clearCache();

    mockSend.mockResolvedValueOnce({ SecretString: 'second-value' });
    const second = await getSecret('my-secret');
    expect(second).toBe('second-value');
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

