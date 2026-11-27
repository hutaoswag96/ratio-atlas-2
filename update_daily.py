"""Build the daily total-return snapshot for 2.0, checked against weekly marks.

Both legs are total return indices: CSI Dividend (H00922) and ChiNext (399606),
so the daily ratio chart and the weekly signal share one basis.

Runs as an incremental refresh: only the tail after the existing snapshot is
fetched, which keeps the index website at one small request per run.
"""
import datetime as dt
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

from update_data import fetch, csindex_daily

ROOT = Path(__file__).resolve().parent
TARGET = ROOT/'dist'/'daily-returns.js'

weekly = json.loads((ROOT/'dist/weekly.js').read_text().split(' = ',1)[1].rstrip(';\n'))
official = weekly[156:]
first_week = official[0][0]
now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
last = (now.date() if now.hour >= 16 else now.date()-dt.timedelta(days=1)).isoformat()

old = []
if TARGET.exists():
    old = json.loads(TARGET.read_text().split(' = ',1)[1].rstrip(';\n'))
# Rewind a little so the last saved days get re-verified instead of trusted.
since = (dt.date.fromisoformat(old[-1][0]) - dt.timedelta(days=10)).isoformat() if old else first_week


def price_year(task):
    symbol, year = task
    beginning = max(f'{year}-01-01', since)
    ending = min(last, f'{year}-12-31')
    params = urlencode({'param': f'{symbol},day,{beginning},{ending},325,'})
    raw = fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?'+params)
    data = raw['data'][symbol]['day']
    return symbol, {row[0]:float(row[2]) for row in data if beginning <= row[0] <= ending}


years = range(int(since[:4]),int(last[:4])+1)
with ThreadPoolExecutor(max_workers=4) as pool:
    dividend_task = pool.submit(csindex_daily, 'H00922', since, last)
    chunks = list(pool.map(price_year, (('sz399606', year) for year in years)))
    dividend = dividend_task.result()
growth = {}
for symbol, chunk in chunks:
    growth.update(chunk)
dates = sorted(dividend.keys() & growth.keys())
assert dates, 'No fresh daily marks'
assert all(math.isfinite(value) and value>0 for date in dates for value in (dividend[date],growth[date]))
# The exchanges were closed on 2018-06-18 for the Dragon Boat Festival.
# https://www.szse.cn/disclosure/notice/general/t20171222_502255.html
# Only one direction matters: every traded ChiNext day must exist on the dividend leg.
missing = sorted((growth.keys() - dividend.keys()) - {'2018-06-18'})
missing = [date for date in missing if date <= dates[-1]]
assert not missing, f'Missing daily quotes within common period: {missing}'

checked = 0
for date, weekly_dividend, weekly_growth in official:
    if date not in dividend or date not in growth:
        continue
    assert abs(dividend[date]-weekly_dividend) <= .011, (date,dividend[date],weekly_dividend)
    assert abs(growth[date]-weekly_growth) <= .011, (date,growth[date],weekly_growth)
    checked += 1
assert checked >= 4, 'Too few weekly cross-checks on the refreshed window'

merged = {row[0]: row for row in old}
for day in dates:
    merged[day] = [day, dividend[day], growth[day]]
rows = [merged[day] for day in sorted(merged)]
target = TARGET
temp = target.with_suffix('.tmp')
temp.write_text('const dailyTotalReturns = ' + json.dumps(rows, separators=(',',':')) + ';\n')
temp.replace(target)
alias = ROOT/'dist'/'daily-prices.js'
if not alias.exists() or 'dailyPriceSnapshot = dailyTotalReturns' not in alias.read_text():
    alias.write_text('// 2.0: 日线比值图与结算共用同一条全收益序列（H00922 / 399606）。\n'
                     'const dailyPriceSnapshot = dailyTotalReturns;\n')
print(len(rows), 'daily marks through', rows[-1][0], '; weekly marks cross-checked', checked)
