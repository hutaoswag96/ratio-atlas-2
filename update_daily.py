"""Build the daily total-return snapshot for 2.0, checked against weekly marks.

Both legs are total return indices: CSI Dividend (H00922) and ChiNext (399606),
so the daily ratio chart and the weekly signal share one basis.
"""
import datetime as dt
import json
import math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode

from update_data import fetch, csindex_daily

ROOT = Path(__file__).resolve().parent

weekly = json.loads((ROOT/'dist/weekly.js').read_text().split(' = ',1)[1].rstrip(';\n'))
official = weekly[156:]
first = official[0][0]
now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
last = (now.date() if now.hour >= 16 else now.date()-dt.timedelta(days=1)).isoformat()


def price_year(task):
    symbol, year = task
    beginning = f'{year}-01-01'
    ending = min(last, f'{year}-12-31')
    params = urlencode({'param': f'{symbol},day,{beginning},{ending},325,'})
    raw = fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?'+params)
    data = raw['data'][symbol]['day']
    return {row[0]:float(row[2]) for row in data if max(first, beginning) <= row[0] <= ending}


years = range(int(first[:4]),int(last[:4])+1)
with ThreadPoolExecutor(max_workers=6) as pool:
    dividend_task = pool.submit(csindex_daily, 'H00922', first, last)
    chunks = list(pool.map(price_year, (('sz399606', year) for year in years)))
    dividend = dividend_task.result()
growth = {}
for chunk in chunks:
    growth.update(chunk)
dates = sorted(dividend.keys() & growth.keys())
assert len(dates) >= 3000
assert all(math.isfinite(value) and value>0 for date in dates for value in (dividend[date],growth[date]))
# The exchanges were closed on 2018-06-18 for the Dragon Boat Festival.
# https://www.szse.cn/disclosure/notice/general/t20171222_502255.html
# Only one direction matters: every traded ChiNext day must exist on the dividend leg.
missing = sorted((growth.keys() - dividend.keys()) - {'2018-06-18'})
missing = [date for date in missing if date <= dates[-1]]
assert not missing, f'Missing daily quotes within common period: {missing}'
for date, weekly_dividend, weekly_growth in official:
    assert abs(dividend[date]-weekly_dividend) <= .011, (date,dividend[date],weekly_dividend)
    assert abs(growth[date]-weekly_growth) <= .011, (date,growth[date],weekly_growth)
payload = 'const dailyTotalReturns = ' + \
    json.dumps([[day,dividend[day],growth[day]] for day in dates], separators=(',',':')) + ';\n'
target = ROOT/'dist'/'daily-returns.js'
old = json.loads(target.read_text().split(' = ',1)[1].rstrip(';\n'))
assert {row[0] for row in old}.issubset({row[0] for row in dates}), 'daily-returns would discard verified days'
temp = target.with_suffix('.tmp')
temp.write_text(payload)
temp.replace(target)
# 2.0 uses one series for both the ratio chart and settlement.
(ROOT/'dist'/'daily-prices.js').write_text(
    '// 2.0: the price snapshot and the total-return snapshot are the same series.\n'
    'const dailyPriceSnapshot = dailyTotalReturns;\n')
print(len(dates), 'daily marks through', dates[-1], '; weekly marks checked', len(official))
