#!/usr/bin/env python3
"""
Googleカレンダーの予定をCSVに出力するスクリプト。
フリカレ（フリーカレンダー）への手動入力用データを生成します。
"""

import argparse
import csv
import datetime
import os
import sys

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Google Calendar API のスコープ（読み取り専用）
SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

# 認証情報ファイルのパス
CREDENTIALS_FILE = "credentials.json"
TOKEN_FILE = "token.json"


def authenticate():
    """Google Calendar API の認証を行い、サービスオブジェクトを返す。"""
    creds = None

    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                print(f"エラー: {CREDENTIALS_FILE} が見つかりません。")
                print("Google Cloud Console から OAuth 2.0 クライアント ID を")
                print("ダウンロードして credentials.json として保存してください。")
                print()
                print("手順:")
                print("  1. https://console.cloud.google.com/ にアクセス")
                print("  2. 「APIとサービス」→「認証情報」を開く")
                print("  3. 「認証情報を作成」→「OAuth クライアント ID」を選択")
                print("  4. アプリケーションの種類を「デスクトップアプリ」に設定")
                print("  5. JSONをダウンロードし credentials.json として保存")
                sys.exit(1)

            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_FILE, SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "w") as token:
            token.write(creds.to_json())

    return build("calendar", "v3", credentials=creds)


def fetch_events(service, calendar_id, start_date, end_date):
    """指定期間のイベントを取得する。"""
    time_min = (
        datetime.datetime.combine(start_date, datetime.time.min)
        .isoformat() + "Z"
    )
    time_max = (
        datetime.datetime.combine(end_date, datetime.time.max)
        .isoformat() + "Z"
    )

    events = []
    page_token = None

    while True:
        result = (
            service.events()
            .list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime",
                pageToken=page_token,
            )
            .execute()
        )

        events.extend(result.get("items", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    return events


def parse_event(event):
    """イベントからCSV用のデータを抽出する。"""
    start = event.get("start", {})
    end = event.get("end", {})

    # 終日イベントかどうかの判定
    is_all_day = "date" in start

    if is_all_day:
        start_date = start.get("date", "")
        start_time = ""
        end_date = end.get("date", "")
        end_time = ""
    else:
        start_dt = start.get("dateTime", "")
        end_dt = end.get("dateTime", "")
        if start_dt:
            dt = datetime.datetime.fromisoformat(start_dt)
            start_date = dt.strftime("%Y-%m-%d")
            start_time = dt.strftime("%H:%M")
        else:
            start_date = ""
            start_time = ""
        if end_dt:
            dt = datetime.datetime.fromisoformat(end_dt)
            end_date = dt.strftime("%Y-%m-%d")
            end_time = dt.strftime("%H:%M")
        else:
            end_date = ""
            end_time = ""

    return {
        "日付": start_date,
        "開始時刻": start_time,
        "終了日": end_date,
        "終了時刻": end_time,
        "終日": "○" if is_all_day else "",
        "タイトル": event.get("summary", "(タイトルなし)"),
        "場所": event.get("location", ""),
        "説明": event.get("description", "").replace("\n", " "),
    }


def list_calendars(service):
    """利用可能なカレンダー一覧を表示する。"""
    calendars = service.calendarList().list().execute()
    print("利用可能なカレンダー:")
    print("-" * 60)
    for cal in calendars.get("items", []):
        primary = " (プライマリ)" if cal.get("primary") else ""
        print(f"  ID: {cal['id']}")
        print(f"  名前: {cal.get('summary', '(名前なし)')}{primary}")
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Googleカレンダーの予定をCSVに出力（フリカレ用）"
    )
    parser.add_argument(
        "--start",
        type=str,
        default=None,
        help="開始日 (YYYY-MM-DD)。省略時は今月1日",
    )
    parser.add_argument(
        "--end",
        type=str,
        default=None,
        help="終了日 (YYYY-MM-DD)。省略時は今月末日",
    )
    parser.add_argument(
        "--calendar",
        type=str,
        default="primary",
        help="カレンダーID（デフォルト: primary）",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="出力ファイル名（省略時: gcal_YYYY-MM.csv）",
    )
    parser.add_argument(
        "--list-calendars",
        action="store_true",
        help="利用可能なカレンダー一覧を表示",
    )

    args = parser.parse_args()

    service = authenticate()

    if args.list_calendars:
        list_calendars(service)
        return

    # 日付のデフォルト値を設定
    today = datetime.date.today()
    if args.start:
        start_date = datetime.date.fromisoformat(args.start)
    else:
        start_date = today.replace(day=1)

    if args.end:
        end_date = datetime.date.fromisoformat(args.end)
    else:
        # 月末日を計算
        if today.month == 12:
            end_date = today.replace(year=today.year + 1, month=1, day=1)
        else:
            end_date = today.replace(month=today.month + 1, day=1)
        end_date -= datetime.timedelta(days=1)

    # 出力ファイル名
    if args.output:
        output_file = args.output
    else:
        output_file = f"gcal_{start_date.strftime('%Y-%m')}.csv"

    print(f"期間: {start_date} ～ {end_date}")
    print(f"カレンダー: {args.calendar}")

    events = fetch_events(service, args.calendar, start_date, end_date)

    if not events:
        print("指定期間にイベントが見つかりませんでした。")
        return

    # CSV出力
    fieldnames = [
        "日付", "開始時刻", "終了日", "終了時刻",
        "終日", "タイトル", "場所", "説明",
    ]

    with open(output_file, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for event in events:
            row = parse_event(event)
            writer.writerow(row)

    print(f"{len(events)} 件のイベントを {output_file} に出力しました。")


if __name__ == "__main__":
    main()
