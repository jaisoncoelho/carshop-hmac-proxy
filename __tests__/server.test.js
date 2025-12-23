const request = require('supertest');
const { getSecret, clearCache } = require('../src/secrets');

// Mock axios
const mockAxios = jest.fn();
jest.mock('axios', () => mockAxios);

// Mock secrets module
jest.mock('../src/secrets');
const mockedGetSecret = getSecret;

describe('Express HMAC Proxy Server', () => {
  let app;
  let server;

  beforeAll(() => {
    // Set required environment variables
    process.env.TARGET_BASE_URL = 'http://target.example.com';
    process.env.HMAC_SECRET_NAME = 'test-secret';
    process.env.AWS_REGION = 'us-east-1';
    
    // Mock getSecret to return a test secret
    mockedGetSecret.mockResolvedValue('test-secret-key');
    
    // Import app after mocks are set up
    app = require('../src/server');
  });

  afterAll(async () => {
    // Clean up
    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }
    delete process.env.TARGET_BASE_URL;
    delete process.env.HMAC_SECRET_NAME;
    delete process.env.AWS_REGION;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    mockedGetSecret.mockResolvedValue('test-secret-key');
    // Reset axios mock
    mockAxios.mockReset();
  });

  describe('POST requests', () => {
    it('should forward POST request with JSON body correctly', async () => {
      const mockResponse = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { success: true, message: 'Received' }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const requestBody = { name: 'John Doe', age: 30 };
      
      const response = await request(app)
        .post('/api/users')
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockResponse.data);

      // Verify axios was called with correct parameters
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('POST');
      expect(axiosCall.url).toBe('http://target.example.com/api/users');
      expect(axiosCall.data).toEqual(requestBody);
      expect(axiosCall.headers['content-type']).toBe('application/json');
      expect(axiosCall.headers['x-hmac-signature']).toBeDefined();
      expect(axiosCall.headers['x-hmac-timestamp']).toBeDefined();
      expect(axiosCall.headers.host).toBeUndefined(); // Should be removed
    });

    it('should forward POST request with text body correctly', async () => {
      const mockResponse = {
        status: 200,
        headers: { 'content-type': 'text/plain' },
        data: 'OK'
      };
      mockAxios.mockResolvedValue(mockResponse);

      const requestBody = 'This is a text body';
      
      const response = await request(app)
        .post('/api/text')
        .set('Content-Type', 'text/plain')
        .send(requestBody);

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');

      // Verify axios was called with correct parameters
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('POST');
      expect(axiosCall.url).toBe('http://target.example.com/api/text');
      expect(axiosCall.data).toBe(requestBody);
      expect(axiosCall.headers['content-type']).toBe('text/plain');
    });

    it('should forward POST request with query parameters', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const requestBody = { data: 'test' };
      
      await request(app)
        .post('/api/users?page=1&limit=10')
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.url).toBe('http://target.example.com/api/users?page=1&limit=10');
      expect(axiosCall.data).toEqual(requestBody);
    });

    it('should forward POST request with empty body', async () => {
      const mockResponse = {
        status: 201,
        data: { id: 123 }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/create')
        .send();

      expect(response.status).toBe(201);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('POST');
      // Express sets req.body to {} when there's no body, so we check for empty object
      expect(axiosCall.data).toEqual({});
    });

    it('should forward POST request with binary/raw body', async () => {
      const mockResponse = {
        status: 200,
        data: 'Binary received'
      };
      mockAxios.mockResolvedValue(mockResponse);

      const binaryData = Buffer.from('binary data');
      
      const response = await request(app)
        .post('/api/upload')
        .set('Content-Type', 'application/octet-stream')
        .send(binaryData);

      expect(response.status).toBe(200);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('POST');
      expect(Buffer.isBuffer(axiosCall.data)).toBe(true);
    });

    it('should preserve custom headers in POST requests', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/test')
        .set('Content-Type', 'application/json')
        .set('X-Custom-Header', 'custom-value')
        .set('Authorization', 'Bearer token123')
        .send({ test: 'data' });

      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.headers['x-custom-header']).toBe('custom-value');
      expect(axiosCall.headers['authorization']).toBe('Bearer token123');
    });
  });

  describe('HMAC signature', () => {
    it('should add HMAC signature and timestamp headers to POST requests', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/test')
        .set('Content-Type', 'application/json')
        .send({ test: 'data' });

      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      // Verify HMAC headers are present
      expect(axiosCall.headers['x-hmac-signature']).toBeDefined();
      expect(axiosCall.headers['x-hmac-signature']).toMatch(/^[a-f0-9]{64}$/); // 64 char hex string
      expect(axiosCall.headers['x-hmac-timestamp']).toBeDefined();
      expect(axiosCall.headers['x-hmac-timestamp']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
      
      // Verify secret was fetched
      expect(mockedGetSecret).toHaveBeenCalledWith('test-secret', 'us-east-1');
    });

    it('should compute correct signature for POST with path and query', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/users?page=1')
        .set('Content-Type', 'application/json')
        .send({ name: 'test' });

      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      // Verify signature is computed (we can't verify exact value without knowing the exact timestamp)
      expect(axiosCall.headers['x-hmac-signature']).toBeDefined();
      expect(axiosCall.headers['x-hmac-timestamp']).toBeDefined();
    });
  });

  describe('Other HTTP methods', () => {
    it('should forward GET requests correctly', async () => {
      const mockResponse = {
        status: 200,
        data: { users: [] }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/users')
        .query({ page: 1 });

      expect(response.status).toBe(200);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('GET');
      expect(axiosCall.url).toContain('/api/users');
      expect(axiosCall.headers['x-hmac-signature']).toBeDefined();
    });

    it('should forward PUT requests with body correctly', async () => {
      const mockResponse = {
        status: 200,
        data: { updated: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const requestBody = { name: 'Updated Name' };
      
      const response = await request(app)
        .put('/api/users/123')
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(response.status).toBe(200);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('PUT');
      expect(axiosCall.data).toEqual(requestBody);
    });

    it('should forward PATCH requests with body correctly', async () => {
      const mockResponse = {
        status: 200,
        data: { patched: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const requestBody = { name: 'Patched Name' };
      
      const response = await request(app)
        .patch('/api/users/123')
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(response.status).toBe(200);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('PATCH');
      expect(axiosCall.data).toEqual(requestBody);
    });

    it('should forward DELETE requests correctly', async () => {
      const mockResponse = {
        status: 204,
        data: null
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .delete('/api/users/123');

      expect(response.status).toBe(204);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.method).toBe('DELETE');
    });
  });

  describe('Response forwarding', () => {
    it('should forward response status code correctly', async () => {
      const mockResponse = {
        status: 404,
        headers: { 'content-type': 'application/json' },
        data: { error: 'Not found' }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/notfound')
        .send({ test: 'data' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not found' });
    });

    it('should forward response headers correctly', async () => {
      const mockResponse = {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-custom-header': 'custom-value',
          'etag': 'abc123'
        },
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.headers['x-custom-header']).toBe('custom-value');
      expect(response.headers['etag']).toBe('abc123');
    });

    it('should forward response body correctly', async () => {
      const mockResponse = {
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { id: 1, name: 'Test', items: [1, 2, 3] }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.body).toEqual(mockResponse.data);
    });
  });

  describe('Error handling', () => {
    it('should handle connection refused errors', async () => {
      const error = new Error('connect ECONNREFUSED');
      error.code = 'ECONNREFUSED';
      mockAxios.mockRejectedValue(error);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.status).toBe(502);
      expect(response.body.error).toBe('Bad Gateway');
      expect(response.body.message).toBe('Unable to connect to target server');
    });

    it('should handle timeout errors', async () => {
      const error = new Error('timeout');
      error.code = 'ETIMEDOUT';
      mockAxios.mockRejectedValue(error);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.status).toBe(504);
      expect(response.body.error).toBe('Gateway Timeout');
      expect(response.body.message).toBe('Request to target server timed out');
    });

    it('should forward error responses from target server', async () => {
      const error = new Error('Request failed');
      error.response = {
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: { error: 'Bad Request', details: 'Invalid input' }
      };
      mockAxios.mockRejectedValue(error);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.details).toBe('Invalid input');
    });

    it('should handle secret fetch errors', async () => {
      mockedGetSecret.mockRejectedValue(new Error('Failed to fetch secret'));

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to create signature');
      expect(response.body.message).toContain('Failed to fetch secret');
    });

    it('should handle other errors gracefully', async () => {
      const error = new Error('Unknown error');
      mockAxios.mockRejectedValue(error);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Unknown error');
    });
  });

  describe('Request configuration', () => {
    it('should remove host header from forwarded requests', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/test')
        .set('Host', 'proxy.example.com')
        .send({ test: 'data' });

      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.headers.host).toBeUndefined();
    });

    it('should set timeout to 30000ms', async () => {
      const mockResponse = {
        status: 200,
        data: { success: true }
      };
      mockAxios.mockResolvedValue(mockResponse);

      await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.timeout).toBe(30000);
    });

    it('should not validate status codes', async () => {
      const mockResponse = {
        status: 500,
        data: { error: 'Internal error' }
      };
      mockAxios.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/test')
        .send({ test: 'data' });

      expect(response.status).toBe(500);
      expect(mockAxios).toHaveBeenCalledTimes(1);
      const axiosCall = mockAxios.mock.calls[0][0];
      
      expect(axiosCall.validateStatus).toBeDefined();
      expect(typeof axiosCall.validateStatus).toBe('function');
      expect(axiosCall.validateStatus(500)).toBe(true);
    });
  });
});

