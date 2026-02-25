"""
uzustudio シナリオ文章抽出ツール
================================
使い方:
    python extract_scenario.py <シナリオURL>

例:
    python extract_scenario.py "https://editor.studio.uzu-app.com/ja/scenarios/65123bdd811f99978d160e13/edit/characters"

手順:
    1. スクリプトを起動するとブラウザが開きます
    2. Discord ログインを完了してください
    3. シナリオページが表示されたら Enter を押してください
    4. API レスポンスからテキストを抽出して result.txt / result.json に保存します
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright, Response


# ---------------------------------------------------------------------------
# テキスト抽出ヘルパー
# ---------------------------------------------------------------------------

def _collect_strings(obj: Any, results: list[str], min_len: int = 2) -> None:
    """JSON オブジェクトから再帰的に文字列を収集する。"""
    if isinstance(obj, str):
        v = obj.strip()
        if len(v) >= min_len:
            results.append(v)
    elif isinstance(obj, list):
        for item in obj:
            _collect_strings(item, results, min_len)
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect_strings(v, results, min_len)


# APIレスポンスから優先的に取り出すキー
_TEXT_KEYS = {
    "text", "body", "content", "description", "name", "title",
    "dialogue", "narration", "message", "script", "caption",
    "label", "choice", "option", "hint", "flavor",
    # uzustudio 固有（推定）
    "scenarioText", "characterName", "lineText", "talkText",
    "flavorText", "displayName",
}

_SKIP_URL_PATTERNS = re.compile(
    r"\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|css|map)(\?|$)", re.IGNORECASE
)
_API_URL_PATTERNS = re.compile(
    r"(uzu-app\.com|localhost)(.*?)(api|scenarios|characters|phases|lines|scripts)",
    re.IGNORECASE,
)


class ScenarioExtractor:
    def __init__(self, scenario_url: str):
        self.scenario_url = scenario_url
        self._captured: list[dict] = []   # (url, body)

    # ------------------------------------------------------------------
    # ブラウザ操作
    # ------------------------------------------------------------------

    def run(self) -> None:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False, slow_mo=50)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
            )
            page = context.new_page()

            # API レスポンスを傍受
            page.on("response", self._on_response)

            print(f"\n[1] ブラウザを開きます: {self.scenario_url}")
            page.goto(self.scenario_url, wait_until="domcontentloaded", timeout=60_000)

            print("[2] Discord でログインしてください。")
            print("    ログイン後、シナリオページが表示されたら Enter を押してください ...")
            input()

            # ページが安定するまで少し待つ
            page.wait_for_load_state("networkidle", timeout=30_000)

            # すべてのタブ（キャラ / セリフ / ヒント 等）を順にクリックして
            # API レスポンスを取得する
            self._click_all_nav_tabs(page)

            browser.close()

        self._save_results()

    # ------------------------------------------------------------------
    # ナビゲーションタブを全クリック
    # ------------------------------------------------------------------

    def _click_all_nav_tabs(self, page) -> None:
        """サイドバーや上部タブを全てクリックして追加データを読み込む。"""
        selectors = [
            "nav a", "nav button",
            "[role='tab']",
            "[data-testid*='tab']",
            "aside a", "aside button",
        ]
        visited = set()
        for sel in selectors:
            try:
                elements = page.query_selector_all(sel)
                for el in elements:
                    href = el.get_attribute("href") or el.inner_text()
                    if href in visited:
                        continue
                    visited.add(href)
                    el.click()
                    page.wait_for_load_state("networkidle", timeout=8_000)
            except Exception:
                pass

    # ------------------------------------------------------------------
    # レスポンス傍受
    # ------------------------------------------------------------------

    def _on_response(self, response: Response) -> None:
        url = response.url
        if _SKIP_URL_PATTERNS.search(url):
            return
        if not _API_URL_PATTERNS.search(url):
            return
        try:
            body = response.json()
            self._captured.append({"url": url, "body": body})
        except Exception:
            pass

    # ------------------------------------------------------------------
    # 結果保存
    # ------------------------------------------------------------------

    def _save_results(self) -> None:
        all_text: list[str] = []
        structured: dict[str, Any] = {}

        for item in self._captured:
            url = item["url"]
            body = item["body"]

            # 構造化データとして保存
            structured[url] = body

            # テキスト抽出
            self._extract_text_from_body(body, all_text)

        # 重複排除（順序保持）
        seen: set[str] = set()
        unique_texts: list[str] = []
        for t in all_text:
            if t not in seen:
                seen.add(t)
                unique_texts.append(t)

        # result.txt
        txt_path = Path("result.txt")
        txt_path.write_text("\n".join(unique_texts), encoding="utf-8")
        print(f"\n[完了] テキスト {len(unique_texts)} 件 -> {txt_path.resolve()}")

        # result.json（APIレスポンス全体）
        json_path = Path("result.json")
        json_path.write_text(
            json.dumps(structured, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"[完了] 生データ -> {json_path.resolve()}")

    def _extract_text_from_body(self, body: Any, out: list[str]) -> None:
        """レスポンスボディから文章を抽出する。"""
        if isinstance(body, dict):
            for key, val in body.items():
                if key.lower() in _TEXT_KEYS:
                    _collect_strings(val, out)
                else:
                    self._extract_text_from_body(val, out)
        elif isinstance(body, list):
            for item in body:
                self._extract_text_from_body(item, out)
        elif isinstance(body, str):
            v = body.strip()
            if len(v) >= 2:
                out.append(v)


# ---------------------------------------------------------------------------
# エントリーポイント
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="uzustudio シナリオから文章を自動抽出します"
    )
    parser.add_argument(
        "url",
        nargs="?",
        default=(
            "https://editor.studio.uzu-app.com"
            "/ja/scenarios/65123bdd811f99978d160e13/edit/characters"
        ),
        help="シナリオの編集ページ URL",
    )
    args = parser.parse_args()

    extractor = ScenarioExtractor(args.url)
    extractor.run()


if __name__ == "__main__":
    main()
