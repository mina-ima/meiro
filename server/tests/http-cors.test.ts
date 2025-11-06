import { describe, expect, it } from 'vitest';
import type { Env } from '../src';
import { handleRequest } from '../src/router';

const mockEnv = { ROOM: {} } as unknown as Env;

describe('HTTP CORS handling', () => {
  it('includes CORS headers on POST /rooms responses', async () => {
    const origin = 'https://app.example.com';
    const request = new Request('https://meiro-server.example/rooms', {
      method: 'POST',
      headers: {
        Origin: origin,
      },
    });

    const response = await handleRequest(request, mockEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('responds to OPTIONS preflight with CORS headers', async () => {
    const request = new Request('https://meiro-server.example/rooms', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    const response = await handleRequest(request, mockEnv);
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});
