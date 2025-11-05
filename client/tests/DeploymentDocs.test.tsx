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

  it('documents Vercel build configuration and initial build output', () => {
    const { getByText } = render(<pre>{readmeContent}</pre>);

    expect(
      getByText(/Output Directory を `client\/dist` に設定/, { exact: false }),
    ).toBeInTheDocument();

    const { getAllByText: getLogAllByText } = render(<pre>{deploymentLogContent}</pre>);

    expect(
      getLogAllByText(/client\/dist\/index\.html/, { exact: false }).length,
    ).toBeGreaterThan(0);
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

  it('records Vercel environment variable setup for VITE_WS_URL', () => {
    render(<pre>{deploymentLogContent}</pre>);

    expect(
      screen.getByText(/Vercel.*Production.*VITE_WS_URL.*設定/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Vercel.*Preview.*VITE_WS_URL.*設定/, { exact: false }),
    ).toBeInTheDocument();
  });

  it('records end-to-end verification from the Vercel-hosted client', () => {
    render(<pre>{deploymentLogContent}</pre>);

    expect(
      screen.getByText(/Vercel.*ホスト.*クライアント.*ルーム作成.*接続確認/, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/準備フェーズ.*探索フェーズ.*終了判定まで進行/, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('recommends linking a new Vercel project with GitHub for automated deploys', () => {
    render(<pre>{readmeContent}</pre>);

    expect(
      screen.getByText(/GitHub.*連携.*Vercel.*新規プロジェクト.*自動デプロイ/, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });
});
