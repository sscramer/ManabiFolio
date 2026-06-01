#!/usr/bin/env python3
"""
ManabiFolio 負荷テストスクリプト (load_test.py)

デプロイされたManabiFolio WebアプリのURLに対して、
複数スレッドから同時にリクエストを送信し、システム負荷をテストします。

使用方法:
  1. --url でデプロイURLを指定
  2. python load_test.py を実行

必要なライブラリ:
  pip install requests
"""

import requests
import time
import json
import random
import string
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import List, Optional
import argparse

# ================================================
# 設定
# ================================================

# デプロイされたWebアプリのURL（末尾に /exec がない場合は追加）
WEB_APP_URL = ""

# テスト用ユーザー情報（実際のGoogleアカウントでは認証が必要なため、
# この負荷テストは主にAPI応答時間の計測に使用します）
TEST_EMAIL = "loadtest@demo.manabifolio.local"

# ================================================
# データクラス
# ================================================

@dataclass
class TestResult:
    """テスト結果を格納するクラス"""
    test_name: str
    success: bool
    duration_ms: float
    status_code: Optional[int] = None
    error: Optional[str] = None


# ================================================
# テスト関数
# ================================================

def generate_random_string(length: int = 8) -> str:
    """ランダム文字列を生成"""
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))


def test_get_form_config(session: requests.Session) -> TestResult:
    """getFormConfig相当のエンドポイントをテスト"""
    test_name = "getFormConfig"
    start_time = time.time()
    
    try:
        # GASのdoGet経由でアクセス（認証なしでアクセス可能な部分のみ）
        # allow_redirects=True でリダイレクトを追跡
        response = session.get(WEB_APP_URL, timeout=30, allow_redirects=True)
        duration_ms = (time.time() - start_time) * 1000
        
        return TestResult(
            test_name=test_name,
            success=response.status_code == 200,
            duration_ms=duration_ms,
            status_code=response.status_code
        )
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        return TestResult(
            test_name=test_name,
            success=False,
            duration_ms=duration_ms,
            error=str(e)
        )


def test_heavy_read(session: requests.Session, request_id: int) -> TestResult:
    """複数API呼び出しをシミュレートする負荷テスト"""
    test_name = f"FullSession_{request_id}"
    start_time = time.time()
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json,text/html,*/*;q=0.8',
        }
        
        # 負荷テスト用URL（?loadtest=true を追加）
        test_url = WEB_APP_URL + ('&' if '?' in WEB_APP_URL else '?') + 'loadtest=true'
        
        response = session.get(
            test_url, 
            timeout=120,  # フルテストは時間がかかるため延長
            allow_redirects=True,
            headers=headers
        )
        duration_ms = (time.time() - start_time) * 1000
        
        # JSONレスポンスをパース
        try:
            data = response.json()
            is_success = data.get('success', False)
            server_duration = data.get('total_duration_ms', 0)
            api_durations = data.get('api_durations', {})
            counts = data.get('counts', {})
            error_msg = data.get('error') if not is_success else None
            
            # 詳細情報を追加
            if is_success and api_durations:
                # API別の詳細時間を表示用に整形
                detail_parts = [f"{k}:{v}ms" for k, v in api_durations.items()]
                error_msg = f"ServerTime:{server_duration}ms | " + " ".join(detail_parts[:3])
        except:
            is_success = False
            server_duration = 0
            content_preview = response.text[:200] if response.text else 'Empty'
            error_msg = f"Non-JSON: {content_preview}"
        
        return TestResult(
            test_name=test_name,
            success=is_success,
            duration_ms=duration_ms,
            status_code=response.status_code,
            error=error_msg
        )
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        return TestResult(
            test_name=test_name,
            success=False,
            duration_ms=duration_ms,
            error=str(e)
        )


def test_shard_write(session: requests.Session, request_id: int, write_type: str = 'response', batch_id: str = None) -> TestResult:
    """シャードキューへの書き込みテスト"""
    test_name = f"ShardWrite_{write_type}_{request_id}"
    start_time = time.time()
    
    try:
        # 書き込みテスト用URL（バッチIDと連番を付与）
        params = {
            'loadtest': 'write',
            'type': write_type,
            'batchId': batch_id or f'batch_{int(time.time())}',
            'testIndex': request_id
        }
        test_url = WEB_APP_URL + ('&' if '?' in WEB_APP_URL else '?') + '&'.join(f'{k}={v}' for k, v in params.items())
        
        response = session.get(
            test_url,
            timeout=120,
            allow_redirects=True
        )
        duration_ms = (time.time() - start_time) * 1000
        
        try:
            data = response.json()
            is_success = data.get('success', False)
            result = data.get('result', {})
            slot = result.get('slot', 'N/A')
            queued = result.get('queued', False)
            test_id = data.get('testId', 'N/A')
            
            # スロット情報を含めて表示
            if is_success:
                if result.get('fallback'):
                    error_msg = f"FALLBACK → 本テーブル直書き"
                else:
                    error_msg = f"Slot:{slot} queued:{queued}"
            else:
                error_msg = data.get('error', 'Unknown error')
                
        except:
            is_success = False
            error_msg = f"Non-JSON: {response.text[:100]}"
        
        return TestResult(
            test_name=test_name,
            success=is_success,
            duration_ms=duration_ms,
            status_code=response.status_code,
            error=error_msg
        )
    except Exception as e:
        duration_ms = (time.time() - start_time) * 1000
        return TestResult(
            test_name=test_name,
            success=False,
            duration_ms=duration_ms,
            error=str(e)
        )


def verify_data_integrity(batch_id: str, expected_count: int, write_type: str = 'response', wait_seconds: int = 10) -> dict:
    """
    データ整合性を検証する
    
    Args:
        batch_id: テストバッチID
        expected_count: 期待するレコード数
        write_type: 'response' or 'reading'
        wait_seconds: 検証前の待機時間（キュー処理待ち）
    
    Returns:
        検証結果の辞書
    """
    print(f"\n  ⏳ キュー処理待機中... ({wait_seconds}秒)")
    time.sleep(wait_seconds)
    
    print(f"  🔍 データ整合性を検証中...")
    
    try:
        params = {
            'loadtest': 'verify',
            'batchId': batch_id,
            'expectedCount': expected_count,
            'type': write_type
        }
        verify_url = WEB_APP_URL + ('&' if '?' in WEB_APP_URL else '?') + '&'.join(f'{k}={v}' for k, v in params.items())
        
        session = requests.Session()
        response = session.get(verify_url, timeout=120, allow_redirects=True)
        
        data = response.json()
        return data
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }


def run_shard_write_test(num_requests: int, num_workers: int, write_type: str = 'response', verify_wait: int = 15) -> List[TestResult]:
    """
    シャード書き込み負荷テストを実行（データ整合性検証付き）
    
    Args:
        num_requests: 書き込み回数
        num_workers: 同時スレッド数
        write_type: 'response' or 'reading'
        verify_wait: 検証前の待機時間（秒）
    """
    results = []
    shard_distribution = {}  # シャード分散を追跡
    
    # バッチIDを生成（このテスト全体で共通）
    batch_id = f"batch_{int(time.time())}_{generate_random_string(4)}"
    
    print(f"\n{'='*60}")
    print(f"シャード書き込みテスト開始 (type: {write_type})")
    print(f"  バッチID: {batch_id}")
    print(f"  リクエスト数: {num_requests}")
    print(f"  同時スレッド数: {num_workers}")
    print(f"{'='*60}\n")
    
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        futures = []
        for i in range(num_requests):
            session = requests.Session()
            future = executor.submit(test_shard_write, session, i, write_type, batch_id)
            futures.append(future)
        
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            
            # スロット分散を追跡
            if result.error and 'Slot:' in result.error:
                slot_num = result.error.split('Slot:')[1].split()[0]
                shard_distribution[slot_num] = shard_distribution.get(slot_num, 0) + 1
            elif result.error and 'FALLBACK' in result.error:
                shard_distribution['FALLBACK'] = shard_distribution.get('FALLBACK', 0) + 1
            
            status = "✅" if result.success else "❌"
            print(f"  {status} {result.test_name}: {result.duration_ms:.1f}ms | {result.error or ''}")
    
    # スロット分散サマリー
    if shard_distribution:
        print(f"\n  【スロット分散】")
        for slot, count in sorted(shard_distribution.items()):
            pct = count / num_requests * 100
            print(f"    Slot {slot}: {count}件 ({pct:.1f}%)")
    
    # 成功した書き込み数をカウント
    success_count = sum(1 for r in results if r.success)
    
    # データ整合性検証
    if success_count > 0:
        print(f"\n{'='*60}")
        print(f"データ整合性検証")
        print(f"{'='*60}")
        
        verify_result = verify_data_integrity(
            batch_id=batch_id,
            expected_count=success_count,
            write_type=write_type,
            wait_seconds=verify_wait
        )
        
        if verify_result.get('success'):
            found = verify_result.get('foundCount', 0)
            expected = verify_result.get('expectedCount', 0)
            match = verify_result.get('match', False)
            missing = verify_result.get('missing', 0)
            duplicate = verify_result.get('duplicate', 0)
            missing_indices = verify_result.get('missingIndices', [])
            
            if match:
                print(f"\n  ✅ データ整合性OK: {found}/{expected} 件すべて確認")
            else:
                print(f"\n  ⚠️ データ整合性に問題あり!")
                print(f"     期待: {expected} 件")
                print(f"     実際: {found} 件")
                if missing > 0:
                    print(f"     消失: {missing} 件")
                if duplicate > 0:
                    print(f"     重複: {duplicate} 件")
            
            # 消失したindexを詳細表示
            if missing_indices:
                print(f"\n  【消失したリクエスト番号】")
                print(f"    {missing_indices[:30]}")
                if len(missing_indices) > 30:
                    print(f"    ... 他 {len(missing_indices) - 30} 件")
            
            # records詳細（最初の5件）
            records = verify_result.get('records', [])
            if records:
                print(f"\n  【検出レコード（先頭5件）】")
                for rec in records[:5]:
                    if 'slot' in rec:
                        print(f"    - {rec.get('sessionId', rec.get('bookTitle', 'N/A'))} [Queue Slot:{rec['slot']}]")
                    else:
                        print(f"    - {rec.get('sessionId', rec.get('bookTitle', 'N/A'))} [DB]")
        else:
            print(f"\n  ❌ 検証失敗: {verify_result.get('error', 'Unknown error')}")
    
    return results


def run_concurrent_test(num_requests: int, num_workers: int) -> List[TestResult]:
    """
    並列リクエストテストを実行
    
    Args:
        num_requests: 送信するリクエスト総数
        num_workers: 同時実行スレッド数
    """
    results = []
    
    print(f"\n{'='*60}")
    print(f"並列負荷テスト開始")
    print(f"  リクエスト数: {num_requests}")
    print(f"  同時スレッド数: {num_workers}")
    print(f"  ターゲットURL: {WEB_APP_URL[:50]}...")
    print(f"{'='*60}\n")
    
    # セッションプール（コネクション再利用）
    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        # 各スレッドにセッションを渡してリクエスト
        futures = []
        for i in range(num_requests):
            session = requests.Session()
            future = executor.submit(test_heavy_read, session, i)
            futures.append(future)
        
        # 結果を収集
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            
            # リアルタイム進捗表示
            status = "✅" if result.success else "❌"
            detail = f" | {result.error}" if result.error else ""
            print(f"  {status} {result.test_name}: {result.duration_ms:.1f}ms{detail}")
    
    return results


def run_sequential_baseline(num_requests: int) -> List[TestResult]:
    """
    シーケンシャル（非並列）のベースラインテスト
    """
    results = []
    print(f"\n{'='*60}")
    print(f"シーケンシャルベースラインテスト（{num_requests}回）")
    print(f"{'='*60}\n")
    
    session = requests.Session()
    for i in range(num_requests):
        result = test_heavy_read(session, i)
        results.append(result)
        status = "✅" if result.success else "❌"
        print(f"  {status} {result.test_name}: {result.duration_ms:.1f}ms")
    
    return results


def test_connection():
    """
    接続テスト（デバッグ用）
    URLへのアクセスを1回行い、詳細情報を表示
    """
    print("\n" + "="*60)
    print("接続テスト（デバッグモード）")
    print("="*60)
    print(f"  URL: {WEB_APP_URL}")
    
    session = requests.Session()
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
    }
    
    try:
        print("\n  リクエスト送信中...")
        start_time = time.time()
        
        response = session.get(
            WEB_APP_URL,
            timeout=60,
            allow_redirects=True,
            headers=headers
        )
        
        duration_ms = (time.time() - start_time) * 1000
        
        print(f"\n  【レスポンス情報】")
        print(f"    ステータスコード: {response.status_code}")
        print(f"    応答時間: {duration_ms:.1f}ms")
        print(f"    最終URL: {response.url}")
        print(f"    リダイレクト回数: {len(response.history)}")
        print(f"    コンテンツ長: {len(response.text)} bytes")
        print(f"    Content-Type: {response.headers.get('Content-Type', 'N/A')}")
        
        # リダイレクト履歴
        if response.history:
            print(f"\n  【リダイレクト履歴】")
            for i, r in enumerate(response.history):
                print(f"    {i+1}. {r.status_code} -> {r.url[:60]}...")
        
        # コンテンツプレビュー
        print(f"\n  【コンテンツプレビュー（先頭500文字）】")
        preview = response.text[:500].replace('\n', '\n    ')
        print(f"    {preview}")
        
        # エラーページ判定
        is_error = any([
            'ファイルを開くことができません' in response.text,
            'drive.google.com/start' in response.text,
            '現在、ファイル' in response.text,
            'Error' in response.text and len(response.text) < 1000,
        ])
        
        if is_error:
            print(f"\n  ⚠️ 警告: エラーページが返されている可能性があります")
            print(f"    GASのデプロイ設定を確認してください:")
            print(f"    1. 「次のユーザーとして実行」→「自分」")
            print(f"    2. 「アクセスできるユーザー」→「全員」")
            print(f"    3. 新しいデプロイIDでURLを再取得")
        else:
            print(f"\n  ✅ 接続成功: 正常なレスポンスを受信しました")
            
    except requests.exceptions.Timeout:
        print(f"\n  ❌ タイムアウト: 60秒以内に応答がありませんでした")
    except requests.exceptions.ConnectionError as e:
        print(f"\n  ❌ 接続エラー: {e}")
    except Exception as e:
        print(f"\n  ❌ エラー: {e}")
    
    print("\n" + "="*60 + "\n")


def print_summary(results: List[TestResult], test_type: str):
    """テスト結果のサマリーを表示"""
    total = len(results)
    success = sum(1 for r in results if r.success)
    failed = total - success
    
    durations = [r.duration_ms for r in results if r.success]
    
    print(f"\n{'='*60}")
    print(f"【{test_type}】結果サマリー")
    print(f"{'='*60}")
    print(f"  成功: {success}/{total} ({success/total*100:.1f}%)")
    print(f"  失敗: {failed}/{total}")
    
    if durations:
        avg = sum(durations) / len(durations)
        min_d = min(durations)
        max_d = max(durations)
        print(f"\n  レスポンス時間:")
        print(f"    平均: {avg:.1f}ms")
        print(f"    最小: {min_d:.1f}ms")
        print(f"    最大: {max_d:.1f}ms")
    
    # エラー詳細
    errors = [r for r in results if not r.success]
    if errors:
        print(f"\n  エラー詳細:")
        for r in errors[:5]:  # 最初の5件のみ表示
            print(f"    - {r.test_name}: {r.error or f'HTTP {r.status_code}'}")
        if len(errors) > 5:
            print(f"    ... 他 {len(errors) - 5} 件")


def main():
    parser = argparse.ArgumentParser(description='ManabiFolio 負荷テストスクリプト')
    parser.add_argument('-n', '--requests', type=int, default=10,
                        help='リクエスト総数 (デフォルト: 10)')
    parser.add_argument('-w', '--workers', type=int, default=5,
                        help='同時スレッド数 (デフォルト: 5)')
    parser.add_argument('--url', type=str, default=None,
                        help='WebアプリのURL（未指定時はスクリプト内のURLを使用）')
    parser.add_argument('--baseline', action='store_true',
                        help='シーケンシャルベースラインも実行')
    parser.add_argument('--debug', action='store_true',
                        help='接続テストのみ実行（デバッグモード）')
    parser.add_argument('--mode', type=str, default='read', choices=['read', 'write'],
                        help='テストモード: read=読み込み（デフォルト）, write=シャード書き込み')
    parser.add_argument('--type', type=str, default='response', choices=['response', 'reading'],
                        help='書き込みテストタイプ: response（デフォルト）, reading')
    parser.add_argument('--verify-wait', type=int, default=15,
                        help='データ整合性検証前の待機時間（秒） (デフォルト: 15)')
    
    args = parser.parse_args()
    
    global WEB_APP_URL
    if args.url:
        WEB_APP_URL = args.url
    
    if not WEB_APP_URL:
        print("❌ エラー: --url でWebアプリURLを指定してください")
        print("   例: python load_test.py --url '<WEB_APP_URL>'")
        return
    
    print("\n" + "="*60)
    print("ManabiFolio 負荷テストツール")
    print("="*60)
    
    # デバッグモード
    if args.debug:
        test_connection()
        return
    
    # 書き込みテストモード
    if args.mode == 'write':
        write_results = run_shard_write_test(args.requests, args.workers, args.type, getattr(args, 'verify_wait', 15))
        print_summary(write_results, f"シャード書き込み ({args.type})")
        print("\n" + "="*60)
        print("テスト完了")
        print("="*60 + "\n")
        return
    
    # ベースラインテスト（オプション）
    if args.baseline:
        baseline_results = run_sequential_baseline(min(args.requests, 5))
        print_summary(baseline_results, "シーケンシャル（ベースライン）")
    
    # 並列テスト
    concurrent_results = run_concurrent_test(args.requests, args.workers)
    print_summary(concurrent_results, f"並列（{args.workers}スレッド）")
    
    print("\n" + "="*60)
    print("テスト完了")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
