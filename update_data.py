"""Rebuild weekly closes for the 2.0 pair: both legs on total return.

Columns: [date, CSI Dividend total return (H00922), ChiNext total return (399606)]

Ratio shown on the site = dividend / growth, same direction as 1.0, but both
legs now include dividends so the ratio is a true total-return ratio.
"""
import bisect
import datetime as dt
import json
import math
import subprocess
import time
from pathlib import Path
from urllib.parse import urlencode

TARGET = Path(__file__).parent / 'dist' / 'weekly.js'
START = '2011-01-01'
DIVIDEND = 'H00922'
GROWTH = 'sz399606'


def fetch(url, tries=3):
    last = None
    for _ in range(tries):
        try:
            raw = subprocess.check_output(['curl', '--fail', '--silent', '--show-error',
                                           '--location', '--max-time', '40', url])
            return json.loads(raw)
        except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
            last = exc
            time.sleep(1)
    raise last


def tencent(code, end):
    query = urlencode({'param': f'{code},week,{START},{end},1600,qfq'})
    bars = fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?' + query)
    return {b[0]: float(b[2]) for b in bars['data'][code]['week'] if b[0] <= end}


def csindex_daily(code, first, end):
    out = {}
    for year in range(int(first[:4]), int(end[:4]) + 1):
        query = urlencode({'indexCode': code,
                           'startDate': max(f'{year}0101', first.replace('-', '')),
                           'endDate': min(f'{year}1231', end.replace('-', ''))})
        try:
            raw = fetch('https://www.csindex.com.cn/csindex-home/perf/index-perf?' + query)
        except Exception:
            continue
        for row in raw.get('data') or []:
            if row.get('close'):
                day = dt.datetime.strptime(row['tradeDate'], '%Y%m%d').date().isoformat()
                out[day] = float(row['close'])
    return out


def weekly_last(daily, growth_dates):
    """Last trading day of each natural week, aligned with the growth weekly bars."""
    days = sorted(daily)
    out = {}
    for day in growth_dates:
        index = bisect.bisect_right(days, day) - 1
        if index < 0:
            continue
        candidate = days[index]
        if dt.date.fromisoformat(candidate).isocalendar()[:2] != \
                dt.date.fromisoformat(day).isocalendar()[:2]:
            continue
        out[day] = daily[candidate]
    return out


def snapshot(end):
    dividend_daily = csindex_daily(DIVIDEND, START, end)
    growth = tencent(GROWTH, end)
    dividend = weekly_last(dividend_daily, sorted(growth))
    rows = []
    for date in sorted(set(dividend) & set(growth)):
        values = [dividend[date], growth[date]]
        if all(v and math.isfinite(v) and v > 0 for v in values):
            rows.append([date, *values])
    return rows


if __name__ == '__main__':
    # Use Friday's final data starting on Saturday (Shanghai time).
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
    end = today - dt.timedelta(days=(today.weekday()-5) % 7 + 1)
    rows = snapshot(end.isoformat())
    if len(rows) < 750 or (end - dt.date.fromisoformat(rows[-1][0])).days > 14:
        raise ValueError('Incomplete weekly series')
    if TARGET.exists():
        old = json.loads(TARGET.read_text().split(' = ', 1)[1].rstrip(';\n'))
        if not {r[0] for r in old}.issubset({r[0] for r in rows}):
            raise ValueError('Refresh would discard previously verified weeks')
    tmp = TARGET.with_suffix('.tmp')
    tmp.write_text('const weeklyData = ' + json.dumps(rows, separators=(',', ':')) + ';\n')
    tmp.replace(TARGET)
    print(f'{len(rows)} common observations, {rows[0][0]} to {rows[-1][0]}')
