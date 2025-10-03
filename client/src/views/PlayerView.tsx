import { HUD } from './HUD';

export interface PlayerViewProps {
  points: number;
  targetPoints: number;
  predictionHits: number;
}

export function PlayerView({ points, targetPoints, predictionHits }: PlayerViewProps): JSX.Element {
  return (
    <div>
      <h2>プレイヤービュー</h2>
      <canvas width={640} height={360} aria-label="レイキャスト表示" />
      <HUD timeRemaining={300} score={points} targetScore={targetPoints}>
        <p>予測地点ヒット: {predictionHits}</p>
      </HUD>
    </div>
  );
}
