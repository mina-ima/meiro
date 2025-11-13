import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import readmeContent from '../../README.md?raw';
import deploymentLogContent from '../../docs/deployment-log.md?raw';

describe('Deployment documentation', () => {
  it('guides how to deploy with Cloudflare Pages + Workers', () => {
    render(<pre>{readmeContent}</pre>);

    expect(
      screen.getByText(/Cloudflare Pages.*Cloudflare Workers.*併用構成/, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Cloudflare Pages.*環境変数.*VITE_WS_URL.*wss:\/\/meiro-server\.minamidenshi\.workers\.dev/,
        { exact: false },
      ),
    ).toBeInTheDocument();
  });

  it('documents Cloudflare Pages build configuration and build output', () => {
    const { getByText } = render(<pre>{readmeContent}</pre>);

    expect(
      getByText(/Cloudflare Pages.*Build Command.*npm run build --workspace @meiro\/client/, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      getByText(/Output Directory.*client\/dist/, { exact: false }),
    ).toBeInTheDocument();

    const { getAllByText: getLogAllByText } = render(<pre>{deploymentLogContent}</pre>);

    expect(
      getLogAllByText(/client\/dist\/index\.html/, { exact: false }).length,
    ).toBeGreaterThan(0);
  });

  it('records the production WebSocket endpoint and connection log', () => {
    render(<pre>{deploymentLogContent}</pre>);

    expect(
      screen.getByText(/wss:\/\/meiro-server\.minamidenshi\.workers\.dev\/ws/, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/101.*Switching Protocols/, { exact: false }),
    ).toBeInTheDocument();
  });

  it('records Cloudflare Pages environment variable setup for VITE_WS_URL', () => {
    render(<pre>{deploymentLogContent}</pre>);

    expect(
      screen.getByText(
        /Cloudflare Pages.*Production.*VITE_WS_URL.*wss:\/\/meiro-server\.minamidenshi\.workers\.dev/,
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Cloudflare Pages.*Preview.*VITE_WS_URL/, { exact: false }),
    ).toBeInTheDocument();
  });

  it('records end-to-end verification from the Cloudflare Pages-hosted client', () => {
    render(<pre>{deploymentLogContent}</pre>);

    expect(
      screen.getByText(/Cloudflare Pages.*ホスト.*クライアント.*ルーム作成.*接続確認/, {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/準備フェーズ.*探索フェーズ.*終了判定まで進行/, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });

  it('recommends linking Cloudflare Pages with GitHub for automated deploys', () => {
    render(<pre>{readmeContent}</pre>);

    expect(
      screen.getByText(/GitHub.*連携.*Cloudflare Pages.*自動デプロイ/, {
        exact: false,
      }),
    ).toBeInTheDocument();
  });
});
