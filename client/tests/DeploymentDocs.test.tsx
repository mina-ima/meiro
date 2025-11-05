import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import readmeContent from '../../README.md?raw';
import deploymentLogContent from '../../docs/deployment-log.md?raw';

describe('Deployment documentation', () => {
  it('guides how to deploy with Vercel + Cloudflare', () => {
    render(<pre>{readmeContent}</pre>);

    expect(
      screen.getByText(/Vercel.*Cloudflare.*併用構成を再現できる手順/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Cloudflare Workers.*本番 WebSocket.*URL.*記録/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Vercel.*環境変数.*VITE_WS_URL.*設定/, { exact: false }),
    ).toBeInTheDocument();
  });

  it('records the production WebSocket endpoint and connection log', () => {
    render(<pre>{deploymentLogContent}</pre>);

    expect(
      screen.getByText(/wss:\/\/game\.meiro\.example\.com\/ws/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/101.*Switching Protocols/, { exact: false }),
    ).toBeInTheDocument();
  });
});
