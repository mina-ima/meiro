# Repository Guidelines
私がgoと指示したら
@prompt_spec.md と @todo.md を開く。
この指示に従って未完了なステップを１つずつ完了させる

やること:
1) まず失敗するテストを書く（Vitest + RTL）。
2) テストに合格するコードを実装する。
3) 実行: pnpm format && pnpm lint && pnpm typecheck && pnpm test
4) すべて合格したら: git commit -m "<分かりやすい日本語のメッセージ>"
5) prompt_spec.md と todo.md を更新する。
6) いったん停止して、続行可否を確認する。

日本語で分かりやすく答えること
