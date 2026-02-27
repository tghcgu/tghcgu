"""
uzustudio シナリオ文章抽出ツール（PC用）
========================================
【使い方】

  python extract_scenario.py <シナリオURL>

【例】

  python extract_scenario.py "https://editor.studio.uzu-app.com/ja/scenarios/65123bdd811f99978d160e13/edit/characters"

  ※ URL はどのセクション（characters / phases / clues など）でも OK

【手順】

  1. スクリプトを起動すると Chrome ブラウザが自動で開きます
  2. 画面の指示に従い Discord でログインしてください
  3. シナリオページが表示されたらターミナルに戻り Enter を押す
  4. 全セクションを自動で巡回してテキストを収集します（数十秒）
  5. 完了後、以下のファイルが作られます:
       result.txt  … セクション別のテキスト一覧
       result.json … APIレスポンス生データ（開発者向け）

【初回セットアップ】

  pip install playwright
  playwright install chromium

【スマホで使いたい場合】

  bookmarklet.min.js の内容をブラウザのブックマークURLに貼り付けてください。
  uzustudio のシナリオページを開いてブックマークをタップするだけで抽出できます。
"""

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright, Page, Response, Request


# ---------------------------------------------------------------------------
# uzustudio の編集セクション一覧
# ---------------------------------------------------------------------------

# URL の /edit/<section> 部分に対応する表示名
EDIT_SECTIONS = [
    ("characters",  "キャラクター"),
    ("phases",      "フェーズ"),
    ("clues",       "手がかり"),
    ("tokens",      "トークン"),
    ("rooms",       "部屋"),
    ("actions",     "アクション"),
    ("epilogues",   "エピローグ"),
    ("prologue",    "プロローグ"),
    ("scripts",     "台本"),
    ("lines",       "セリフ"),
    ("summary",     "あらすじ"),
]

# ---------------------------------------------------------------------------
# フィルタ
# ---------------------------------------------------------------------------

_SKIP_EXT = re.compile(
    r"\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|css|map|chunk\.js)(\?|$)",
    re.IGNORECASE,
)

# uzu-app.com のすべてのサブドメインを対象にする
_API_HOST = re.compile(r"uzu-app\.com", re.IGNORECASE)

# シナリオ ID を URL から取り出す正規表現
_SCENARIO_ID_RE = re.compile(
    r"/scenarios/([a-f0-9]{24})", re.IGNORECASE
)

# ---------------------------------------------------------------------------
# テキスト抽出ヘルパー
# ---------------------------------------------------------------------------

# 文章として意味のあるキー（大文字小文字無視で比較）
_TEXT_KEYS = {
    "text", "body", "content", "description", "name", "title",
    "dialogue", "narration", "message", "script", "caption",
    "label", "choice", "option", "hint", "flavor",
    # uzustudio 固有（推定）
    "scenariotext", "charactername", "linetext", "talktext",
    "flavortext", "displayname", "kana", "ruby",
    "prologue", "epilogue", "summary", "profile",
    "note", "memo", "detail", "objective", "condition",
}

# システム的な値として除外するパターン
_SKIP_VALUE_RE = re.compile(
    r"^(true|false|null|\d+|[a-f0-9]{24}|#[0-9a-f]{3,8}|https?://.*)$",
    re.IGNORECASE,
)


def _is_meaningful(s: str) -> bool:
    """保存する価値のある文字列かどうか判定する。"""
    s = s.strip()
    if len(s) < 2:
        return False
    if _SKIP_VALUE_RE.match(s):
        return False
    # ASCII のみ（英単語・ID等）は除外
    if s.isascii() and not re.search(r"[\s.,!?'\"()]", s):
        return False
    return True


def _collect_strings(obj: Any, results: list[str]) -> None:
    if isinstance(obj, str):
        if _is_meaningful(obj):
            results.append(obj.strip())
    elif isinstance(obj, list):
        for item in obj:
            _collect_strings(item, results)
    elif isinstance(obj, dict):
        for v in obj.values():
            _collect_strings(v, results)


def extract_text_from_body(body: Any, out: list[str]) -> None:
    """APIレスポンスボディから文章を抽出する。"""
    if isinstance(body, dict):
        for key, val in body.items():
            if key.lower() in _TEXT_KEYS:
                _collect_strings(val, out)
            else:
                extract_text_from_body(val, out)
    elif isinstance(body, list):
        for item in body:
            extract_text_from_body(item, out)


# ---------------------------------------------------------------------------
# メインクラス
# ---------------------------------------------------------------------------

class ScenarioExtractor:
    def __init__(self, scenario_url: str):
        self.scenario_url = scenario_url.rstrip("/")
        self.scenario_id = self._parse_scenario_id(scenario_url)
        self.base_editor_url = self._parse_base_editor(scenario_url)

        # 収集データ
        self._responses: dict[str, Any] = {}   # url -> json body
        self._auth_token: str | None = None

        print(f"  シナリオID : {self.scenario_id}")
        print(f"  ベースURL  : {self.base_editor_url}")

    # ------------------------------------------------------------------
    # URL パーサー
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_scenario_id(url: str) -> str:
        m = _SCENARIO_ID_RE.search(url)
        if not m:
            raise ValueError(
                f"シナリオ ID が URL から見つかりません: {url}\n"
                "URL 例: https://editor.studio.uzu-app.com/ja/scenarios/<ID>/edit/characters"
            )
        return m.group(1)

    @staticmethod
    def _parse_base_editor(url: str) -> str:
        """https://editor.studio.uzu-app.com/ja/scenarios/<ID>"""
        m = _SCENARIO_ID_RE.search(url)
        origin = re.match(r"(https?://[^/]+)", url)
        if not m or not origin:
            raise ValueError(f"URL のパースに失敗しました: {url}")
        # /ja/ などのロケール部分を取得
        locale_m = re.search(r"/(ja|en|zh|ko)/", url)
        locale = locale_m.group(1) if locale_m else "ja"
        return f"{origin.group(1)}/{locale}/scenarios/{m.group(1)}"

    # ------------------------------------------------------------------
    # レスポンス傍受
    # ------------------------------------------------------------------

    def _on_response(self, response: Response) -> None:
        url = response.url
        if _SKIP_EXT.search(url):
            return
        if not _API_HOST.search(url):
            return

        # 認証トークンを傍受（Authorization: Bearer <token>）
        try:
            req_headers = response.request.headers
            auth = req_headers.get("authorization", "")
            if auth.startswith("Bearer ") and not self._auth_token:
                self._auth_token = auth.split(" ", 1)[1]
                print(f"  [auth] トークン取得: {self._auth_token[:20]}...")
        except Exception:
            pass

        # JSON レスポンスを収集
        try:
            body = response.json()
            self._responses[url] = body
        except Exception:
            pass

    # ------------------------------------------------------------------
    # ページ遷移
    # ------------------------------------------------------------------

    def _goto_and_wait(self, page: Page, url: str, label: str) -> None:
        print(f"  -> {label}: {url}")
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            # networkidle まで最大 10 秒待つ（タイムアウトしても続行）
            try:
                page.wait_for_load_state("networkidle", timeout=10_000)
            except Exception:
                pass
            time.sleep(1)  # React の非同期レンダリング待ち
        except Exception as e:
            print(f"     [警告] ページ読み込みエラー: {e}")

    def _try_api_directly(self, page: Page) -> None:
        """認証トークンがあれば API を直接 fetch する。"""
        if not self._auth_token:
            return
        print("\n[直接 API 呼び出し中]")
        sid = self.scenario_id
        token = self._auth_token
        # よくある REST API パターンを試す
        candidate_paths = [
            f"/api/scenarios/{sid}",
            f"/api/v1/scenarios/{sid}",
            f"/api/scenarios/{sid}/characters",
            f"/api/scenarios/{sid}/phases",
            f"/api/scenarios/{sid}/clues",
            f"/api/scenarios/{sid}/lines",
            f"/api/scenarios/{sid}/scripts",
            f"/api/scenarios/{sid}/actions",
            f"/api/scenarios/{sid}/tokens",
            f"/api/scenarios/{sid}/rooms",
            f"/api/scenarios/{sid}/epilogues",
        ]
        origin = re.match(r"(https?://[^/]+)", self.scenario_url).group(1)
        for path in candidate_paths:
            url = origin + path
            result = page.evaluate(f"""
                async () => {{
                    try {{
                        const r = await fetch({json.dumps(url)}, {{
                            headers: {{
                                "Authorization": "Bearer {token}",
                                "Accept": "application/json"
                            }}
                        }});
                        if (!r.ok) return null;
                        return await r.json();
                    }} catch(e) {{
                        return null;
                    }}
                }}
            """)
            if result:
                self._responses[url] = result
                print(f"  [OK] {url}")

    # ------------------------------------------------------------------
    # メイン処理
    # ------------------------------------------------------------------

    def run(self) -> None:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False, slow_mo=30)
            context = browser.new_context(viewport={"width": 1280, "height": 900})
            page = context.new_page()
            page.on("response", self._on_response)

            # 最初のページを開く
            print(f"\n[ステップ 1/4] ブラウザを開いています...")
            page.goto(self.scenario_url, wait_until="domcontentloaded", timeout=60_000)

            print("\n[ステップ 2/4] Discord でログインしてください。")
            print("  ログインが完了し、シナリオページが表示されたら")
            print("  このターミナルに戻って Enter を押してください。")
            input("  ▶ Enter を押す: ")

            try:
                page.wait_for_load_state("networkidle", timeout=15_000)
            except Exception:
                pass
            time.sleep(2)

            print("\n[ステップ 3/4] データを収集中...")

            # 直接 API 呼び出しを試みる
            self._try_api_directly(page)

            # 全セクションを順に巡回
            for section, label in EDIT_SECTIONS:
                url = f"{self.base_editor_url}/edit/{section}"
                self._goto_and_wait(page, url, label)
                self._expand_list_items(page)

            # 追加の直接 API 呼び出し
            self._try_api_directly(page)

            browser.close()

        self._save_results()

    def _expand_list_items(self, page: Page) -> None:
        """リストの各アイテムをクリックして詳細データを取得する。"""
        # カード・リスト・行をクリックして展開
        click_selectors = [
            "ul li a", "ul li button",
            "[data-testid*='item']",
            "[class*='card']", "[class*='Card']",
            "[class*='list-item']", "[class*='ListItem']",
            "[class*='row']",
        ]
        visited = set()
        for sel in click_selectors:
            try:
                elements = page.query_selector_all(sel)
                if not elements:
                    continue
                for el in elements[:20]:  # 最大 20 件
                    key = el.get_attribute("href") or el.inner_text()[:30]
                    if key in visited:
                        continue
                    visited.add(key)
                    try:
                        el.click()
                        page.wait_for_load_state("networkidle", timeout=5_000)
                        time.sleep(0.5)
                    except Exception:
                        pass
            except Exception:
                pass

    # ------------------------------------------------------------------
    # 結果保存
    # ------------------------------------------------------------------

    def _save_results(self) -> None:
        print("\n[ステップ 4/4] テキストを整理して保存中...")

        # セクション別に整理
        sections_text: dict[str, list[str]] = {}
        all_texts: list[str] = []

        for url, body in self._responses.items():
            # URL からセクション名を推定
            section = self._guess_section(url)
            texts: list[str] = []
            extract_text_from_body(body, texts)
            if texts:
                if section not in sections_text:
                    sections_text[section] = []
                sections_text[section].extend(texts)
                all_texts.extend(texts)

        # 重複除去（順序保持）
        def dedup(lst: list[str]) -> list[str]:
            seen: set[str] = set()
            out: list[str] = []
            for t in lst:
                if t not in seen:
                    seen.add(t)
                    out.append(t)
            return out

        # result.txt（セクション別・整形済み）
        lines: list[str] = []
        lines.append(f"# シナリオ ID: {self.scenario_id}")
        lines.append("")
        for section, texts in sorted(sections_text.items()):
            texts = dedup(texts)
            if not texts:
                continue
            lines.append(f"## {section}")
            for t in texts:
                lines.append(t)
            lines.append("")

        # セクション分類できなかったテキストも追記
        categorized = {t for lst in sections_text.values() for t in lst}
        uncategorized = [t for t in dedup(all_texts) if t not in categorized]
        if uncategorized:
            lines.append("## その他")
            lines.extend(uncategorized)

        txt_path = Path("result.txt")
        txt_path.write_text("\n".join(lines), encoding="utf-8")
        total = len(dedup(all_texts))

        json_path = Path("result.json")
        json_path.write_text(
            json.dumps(self._responses, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        print("")
        print("=" * 50)
        print(f"  完了！  テキスト {total} 件を抽出しました")
        print("=" * 50)
        print(f"  📄 result.txt  … テキスト一覧（セクション別）")
        print(f"  📦 result.json … 生データ（開発者向け）")
        print(f"  場所: {txt_path.parent.resolve()}")
        print("=" * 50)

    @staticmethod
    def _guess_section(url: str) -> str:
        """URL からセクション名を推定する。"""
        for section, label in EDIT_SECTIONS:
            if section in url:
                return label
        if "scenario" in url.lower():
            return "シナリオ"
        return "その他"


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
        help="シナリオの編集ページ URL（どのセクションでも可）",
    )
    args = parser.parse_args()

    print("=" * 50)
    print("  uzustudio シナリオ文章抽出ツール")
    print("=" * 50)
    try:
        extractor = ScenarioExtractor(args.url)
        extractor.run()
    except ValueError as e:
        print(f"\n[エラー] {e}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
