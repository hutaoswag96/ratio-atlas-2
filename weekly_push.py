"""红创比 2.0 · 每周邮件推送内容生成。

从「当前空仓」起点复现网站 engine.js 的单边五笔轮动信号，判断本周是否
出现买入/卖出/持仓变化，生成邮件标题与正文到 push_mail.json。
本脚本不发送邮件，只产出内容；发信由定时任务调用邮箱工具完成。

用法：python3 weekly_push.py
"""
import datetime as dt
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
STATE_FILE = ROOT / 'push_state.json'
OUT_FILE = ROOT / 'push_mail.json'

START_BARS = 156          # 用来定观察线的历史周线数量（与网站一致）
FEE = 0.001               # 买卖单边费用
CAPITAL = 10000           # 追踪账户初始资金
ASSETS = ['中证红利', '创业板指']
ZONE_LOW, ZONE_HIGH, ZONE_MID = '低位', '高位', '中间'


def load_array(path, name):
    text = Path(path).read_text()
    body = text.split(' = ', 1)[1].rstrip().rstrip(';')
    return json.loads(body)


def quantile(sorted_values, p):
    n = (len(sorted_values) - 1) * p
    j = math.floor(n)
    return sorted_values[j] + (n - j) * (sorted_values[min(j + 1, len(sorted_values) - 1)] - sorted_values[j])


def build_bars(rows):
    """复现 engine.js market()：每年用截至上年底的全部周比值定 20%/80% 观察线。"""
    ratios = [row[1] / row[2] for row in rows]
    bars = [None] * len(rows)
    year = None
    low = high = 0.0
    for i, row in enumerate(rows):
        if i < START_BARS:
            continue
        if row[0][:4] != year:
            year = row[0][:4]
            history = sorted(ratios[:i])
            low = quantile(history, 0.2)
            high = quantile(history, 0.8)
        r = ratios[i]
        avg = sum(ratios[i - 12:i + 1]) / 13
        zone = 0 if r <= low else 1 if r >= high else None
        bars[i] = {'r': r, 'avg': avg, 'low': low, 'high': high, 'zone': zone}
    return bars


def days_between(a, b):
    return (dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days


def simulate(rows, bars, start, capital=CAPITAL):
    """复现 engine.js simulate() 的持仓与指令推进（跟随网站规则）。"""
    cash, side, units, budget = capital, None, 0.0, capital
    regime, touch, watch, committed, last_buy, count = None, -100, None, None, None, 0
    orders, rounds, trades = [], [], []
    for i in range(start, len(rows)):
        row, bar = rows[i], bars[i]
        for order in orders:
            asset, price = order['asset'], row[3 + asset]
            if order['kind'] == 'buy':
                if side is None:
                    side, budget, count = asset, cash, 0
                    rounds.append({'asset': asset, 'lots': [], 'sales': [], 'start': i})
                cost = min(cash, budget / 5)
                qty = cost / (1 + FEE) / price
                cash -= cost
                units += qty
                count += 1
                last_buy = i
                rounds[-1]['lots'].append({'i': i, 'cost': cost, 'qty': qty, 'remaining': qty, 'proceeds': 0})
            else:
                rnd = rounds[-1]
                for lot in rnd['lots']:
                    qty = lot['remaining'] * order['part']
                    lot['remaining'] -= qty
                    lot['proceeds'] += qty * price * (1 - FEE)
                rnd['sales'].append(i)
                cash += units * order['part'] * price * (1 - FEE)
                units *= 1 - order['part']
                if order['part'] == 1:
                    side, rnd['end'], count = None, i, 0
            trades.append({**order, 'i': i})
        orders = []
        if committed is not None:
            orders = [{'kind': 'sell', 'asset': side, 'part': 1}, {'kind': 'buy', 'asset': committed}]
            committed = None
            continue
        if bar['zone'] is not None:
            watch, touch = bar['zone'], i
        if i - touch < 13 and ((watch == 0 and bar['r'] > bar['avg']) or (watch == 1 and bar['r'] < bar['avg'])):
            regime = watch
        if regime is None:
            continue
        if side is not None and side != regime:
            orders = [{'kind': 'sell', 'asset': side, 'part': 0.5}]
            committed = regime
        elif side is None or (count < 5 and days_between(row[0], rows[last_buy][0]) >= 28):
            orders = [{'kind': 'buy', 'asset': regime}]
    return {
        'side': side, 'regime': regime, 'watch': watch, 'touch': touch,
        'last_buy': last_buy, 'count': count, 'orders': orders,
        'rounds': rounds, 'trades': trades, 'budget': budget,
    }


def projection(rows, bars, sim):
    """复现网站 renderProjection：区间距离 + 按近 60 日波动估算时间。"""
    daily = load_array(DIST / 'daily-returns.js', 'dailyTotalReturns')
    if len(daily) < 61:
        return None
    last = daily[-1]
    ratio = last[1] / last[2]
    bar = bars[-1]
    moves = [abs(math.log(cur[1] / cur[2]) - math.log(prev[1] / prev[2]))
             for prev, cur in zip(daily[-61:-1], daily[-60:])]
    daily_move = sum(moves) / len(moves) if moves else 0
    lower = 0 if ratio <= bar['low'] else 1 - bar['low'] / ratio
    upper = 0 if ratio >= bar['high'] else bar['high'] / ratio - 1
    next_asset = None if sim['side'] is None else 1 - sim['side']
    side = next_asset if next_asset is not None else (0 if abs(ratio - bar['low']) <= abs(bar['high'] - ratio) else 1)
    boundary = bar['low'] if side == 0 else bar['high']
    touch = abs(math.log(boundary / ratio))
    confirm = abs(math.log(bar['avg'] / boundary))
    sessions = math.ceil((touch + confirm) / daily_move) if daily_move else 0
    low_days = max(1, math.floor(sessions * 0.65))
    high_days = max(low_days, math.ceil(sessions * 1.6))
    return {
        'daily_date': last[0], 'ratio': ratio, 'bar': bar,
        'lower': lower, 'upper': upper, 'candidate': side,
        'low_days': low_days, 'high_days': high_days,
        'low_weeks': max(1, math.ceil(low_days / 5)),
        'high_weeks': max(1, math.ceil(high_days / 5)),
        'boundary': boundary, 'sessions': sessions,
    }


def fmt_pct(value):
    return f'{value * 100:.2f}%'


def fmt_money(value):
    return f'{value:,.0f}'


def holding_text(sim):
    """当前持仓状态的简短描述，用于常规周报标题。"""
    if sim['side'] is None:
        return '空仓'
    return f"持有{ASSETS[sim['side']]}（已买 {sim['count']}/5 笔）"


def build_subject(sim, new_trades, new_orders):
    """仅实际发生建仓/卖出/换仓时用「极其重要」XXXX；常规周报标题显示当前持仓状态。"""
    if new_trades:
        kinds = {t['kind'] for t in new_trades}
        buys = [t for t in new_trades if t['kind'] == 'buy']
        sells = [t for t in new_trades if t['kind'] == 'sell']
        if buys and sells:
            topic = f"换仓：卖出{ASSETS[sells[0]['asset']]}·买入{ASSETS[buys[-1]['asset']]}"
        elif sells:
            part = sells[0]['part']
            act = '卖清' if part == 1 else '卖一半'
            topic = f"{act}{ASSETS[sells[0]['asset']]}"
        else:
            asset = buys[-1]['asset']
            # 第几笔：按该轮已买笔数
            round_lots = [r for r in sim['rounds'] if r['asset'] == asset]
            n = len(round_lots[-1]['lots']) if round_lots else 1
            topic = f"买入{ASSETS[asset]}第{n}笔"
        return f'「极其重要」{topic}'
    # 仅有待执行指令、尚无真实成交：普通标题，正文红色横幅提示
    if new_orders:
        order = new_orders[0]
        if order['kind'] == 'sell':
            act = '卖清' if order['part'] == 1 else '卖一半'
            return f"红创比 2.0 周报：准备{act}{ASSETS[order['asset']]}"
        return f"红创比 2.0 周报：准备买入{ASSETS[order['asset']]}"
    return f"红创比 2.0 周报：{holding_text(sim)}"


def zone_text(ratio, bar):
    if ratio <= bar['low']:
        return ZONE_LOW, '红利候选建仓区'
    if ratio >= bar['high']:
        return ZONE_HIGH, '创业板候选建仓区'
    return ZONE_MID, '两线之间，保持现有状态'


def build_body(sim, proj, rows, new_trades, new_orders, start_date):
    bar = proj['bar']
    ratio = proj['ratio']
    zname, zdesc = zone_text(ratio, bar)
    week = rows[-1][0]
    changed = bool(new_trades or new_orders)

    # 醒目横幅
    if changed:
        lines = []
        for t in new_trades:
            act = '买入' if t['kind'] == 'buy' else ('卖清' if t['part'] == 1 else '卖一半')
            lines.append(f"{rows[t['i']][0]} · {act}{ASSETS[t['asset']]}")
        for o in new_orders:
            act = '买入' if o['kind'] == 'buy' else ('卖清' if o['part'] == 1 else '卖一半')
            lines.append(f"本周待执行 · {act}{ASSETS[o['asset']]}")
        banner = ('<div style="background:#b42318;color:#fff;padding:16px;font-size:18px;font-weight:700;">'
                  '持仓变化提醒 · ' + '；'.join(lines) + '</div>')
    else:
        banner = ('<div style="background:#eff8f4;color:#175c46;padding:14px;font-size:15px;">'
                  '本周无买入或卖出建议，持仓状态不变。以下为当前比值区间与情景推演。</div>')

    holding = '空仓' if sim['side'] is None else f"{ASSETS[sim['side']]}（本轮已买 {sim['count']}/5 笔）"
    action_map = {
        'buy': lambda o: f"本周买入{ASSETS[o['asset']]}第 {sim['count'] + 1} 笔",
        'sell': lambda o: ('卖清剩余' if o['part'] == 1 else '卖出一半') + ASSETS[o['asset']],
    }
    if sim['orders']:
        nxt = action_map[sim['orders'][0]['kind']](sim['orders'][0])
    elif sim['side'] is None:
        nxt = '空仓等待，继续观察比值是否进入极端区并转强'
    elif sim['count'] >= 5:
        nxt = '本轮五笔已买完，等待对侧极端区出现后换仓'
    else:
        nxt = '继续持有，等待下一笔加仓或对侧换仓信号'

    cand = ASSETS[proj['candidate']]
    row = lambda k, v: f'<tr><td style="padding:8px 10px;border-bottom:1px solid #e4e8ef;color:#667085;">{k}</td><td style="padding:8px 10px;border-bottom:1px solid #e4e8ef;text-align:right;font-weight:600;">{v}</td></tr>'
    table = ('<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">'
             + row('周线判断依据', week)
             + row('最新日收盘比值', f"{ratio:.3f}（{proj['daily_date']}）")
             + row('红利观察线 / 创业板观察线', f"{bar['low']:.3f} / {bar['high']:.3f}")
             + row('当前所处区间', f'{zname} · {zdesc}')
             + row('追踪持仓起点', start_date + ' 空仓')
             + row('当前模拟持仓', holding)
             + '</table>')

    proj_table = ('<table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0;">'
                  + row(f'距红利线还需下降', fmt_pct(proj['lower']))
                  + row('距创业板线还需上升', fmt_pct(proj['upper']))
                  + row('较近候选方向', cand)
                  + row('按近 60 日波动估算', f"约 {proj['low_weeks']}–{proj['high_weeks']} 周（{proj['low_days']}–{proj['high_days']} 个交易日）")
                  + '</table>')

    return f'''<div style="font-family:-apple-system,PingFang SC,Arial,sans-serif;color:#17212f;line-height:1.6;max-width:640px;">
{banner}
<h2 style="font-size:20px;margin:20px 0 4px;">红创比 2.0 · 每周跟踪</h2>
<p style="color:#667085;font-size:13px;margin:0 0 12px;">中证红利全收益 H00922 / 创业板全收益 399606 · 单边五笔轮动</p>
<h3 style="font-size:16px;margin:16px 0 4px;">本周状态</h3>
{table}
<h3 style="font-size:16px;margin:16px 0 4px;">情景推演</h3>
{proj_table}
<h3 style="font-size:16px;margin:16px 0 4px;">下一步</h3>
<p style="margin:0 0 12px;">{nxt}</p>
<p style="color:#8b949e;font-size:12px;border-top:1px solid #e4e8ef;padding-top:10px;">推演按近 60 个交易日波动估算，仅供心理预期，不构成准确预测。信号以周收盘为准；邮件数据截至 {week} 周收盘、{proj['daily_date']} 日收盘。模拟按含分红指数计算，单边费用 0.10%，未计基金管理费与跟踪误差。</p>
</div>'''


def main():
    rows = load_array(DIST / 'weekly.js', 'weeklyData')
    bars = build_bars(rows)
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}

    start_date = state.get('start')
    if start_date not in {row[0] for row in rows}:
        start_date = rows[-1][0]  # 首次运行：以当前最新周、空仓为追踪起点
    start = next(i for i, row in enumerate(rows) if row[0] == start_date)

    sim = simulate(rows, bars, start, CAPITAL)
    proj = projection(rows, bars, sim)
    if proj is None:
        raise SystemExit('日线数据不足，无法生成推演')

    # 与上次快照对比，找出本周新增的成交与指令
    prev_trades = state.get('trades_count', 0)
    prev_orders = state.get('orders_sig', '')
    new_trades = sim['trades'][prev_trades:]
    orders_sig = json.dumps(sim['orders'], sort_keys=True)
    new_orders = sim['orders'] if orders_sig != prev_orders and not new_trades else []

    subject = build_subject(sim, new_trades, new_orders)
    body = build_body(sim, proj, rows, new_trades, new_orders, start_date)
    changed = bool(new_trades or new_orders)

    payload = {
        'subject': subject,
        'body_html': body,
        'has_change': changed,
        'week': rows[-1][0],
        'daily_date': proj['daily_date'],
        'ratio': round(proj['ratio'], 3),
        'zone': zone_text(proj['ratio'], proj['bar'])[0],
        'holding': '空仓' if sim['side'] is None else ASSETS[sim['side']],
    }
    OUT_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    STATE_FILE.write_text(json.dumps({
        'start': start_date,
        'trades_count': len(sim['trades']),
        'orders_sig': orders_sig,
        'last_push': dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds'),
        'last_subject': subject,
    }, ensure_ascii=False, indent=2))
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == '__main__':
    main()
