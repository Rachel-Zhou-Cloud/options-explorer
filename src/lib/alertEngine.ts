/**
 * alertEngine.ts — 独立预警引擎
 * 零项目依赖，零修改现有文件。
 * 输入：Position[] + 现金余额 + CostRecord 查询函数
 * 输出：结构化预警数组 [{ level, target, message, priority }]
 *
 * 四级预警：red（紧急）> orange（警戒）> yellow（关注）> green（健康/建议）
 * 三级优先：P1（立即处理）> P2（今日关注）> P3（周度复盘）
 */

// ===== 外部类型定义（不依赖项目内模块） =====

export type AlertLevel = 'red' | 'orange' | 'yellow' | 'green'

export interface AlertPosition {
  id: string
  type: string
  ticker: string
  strikePrice: number
  currentPrice: number
  quantity: number
  premium: number
  currentPremium?: number
  costBasis?: number
  expirationDate?: string
  openDate: string
  linkedPositionId?: string
  /** 可选预计算 Greeks — 优先使用，缺失时内嵌 BS 估算 */
  delta?: number
  theta?: number
}

export interface Alert {
  level: AlertLevel
  /** '账户' 或具体持仓 id */
  target: string
  message: string
  /** 1 = 立即处理, 2 = 今日关注, 3 = 周度复盘 */
  priority: 1 | 2 | 3
}

export interface CostRecord {
  premiumCollected: number
  quantity: number
}

// ===== 数学函数：正态分布 =====

function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + p * Math.abs(x))
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2)
  return 0.5 * (1 + sign * y)
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

// ===== 内嵌 Black-Scholes (零项目依赖) =====

function bsPrice(
  side: 'call' | 'put',
  S: number, K: number, T: number, r: number, sigma: number,
): number {
  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT
  if (side === 'call') {
    return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
  }
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1)
}

/** 二分法估算隐含波动率 */
function estimateIV(
  side: 'call' | 'put',
  S: number, K: number, T: number, r: number, marketPrice: number,
): number {
  if (marketPrice <= 0) return 0.30
  let lo = 0.01, hi = 3.0
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    const price = bsPrice(side, S, K, T, r, mid)
    if (price > marketPrice) hi = mid
    else lo = mid
    if (Math.abs(price - marketPrice) < 0.001) break
  }
  return (lo + hi) / 2
}

/** 计算 Delta + Theta（均为期权持有方视角，即 long 方） */
function computeGreeks(
  side: 'call' | 'put',
  S: number, K: number, T: number, optionPrice: number,
  r = 0.045,
): { delta: number; theta: number } | null {
  if (S <= 0 || K <= 0 || T <= 0) return null

  const sigma = estimateIV(side, S, K, T, r, optionPrice)
  if (sigma <= 0) return null

  const sqrtT = Math.sqrt(T)
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT)
  const d2 = d1 - sigma * sqrtT

  const delta = side === 'call' ? normCdf(d1) : normCdf(d1) - 1

  const npd1 = normPdf(d1)
  const thetaComp = -(S * npd1 * sigma) / (2 * sqrtT)
  const theta = side === 'call'
    ? (thetaComp - r * K * Math.exp(-r * T) * normCdf(d2)) / 365
    : (thetaComp + r * K * Math.exp(-r * T) * normCdf(-d2)) / 365

  return { delta, theta }
}

// ===== 内部辅助函数 =====

function daysUntilExpiry(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function ibkrMargin(S: number, K: number, premium: number): number {
  const otm = Math.max(0, S - K)
  return Math.max(0.25 * S - otm + premium, 0.10 * K + premium, 2.50)
}

const isOptionType = (t: string) => t !== 'stock'

function optionSide(type: string): 'call' | 'put' {
  return (type === 'sell_put' || type === 'buy_put') ? 'put' : 'call'
}

// ----- 获取单个仓位的 Delta（优先预计算字段 → 回退 BS） -----

function getDelta(pos: AlertPosition): number | null {
  if (pos.delta !== undefined) return pos.delta
  if (!isOptionType(pos.type) || !pos.expirationDate) return null
  const T = daysUntilExpiry(pos.expirationDate) / 365
  const optPrice = pos.currentPremium ?? pos.premium
  if (T <= 0 || optPrice <= 0) return null
  return computeGreeks(optionSide(pos.type), pos.currentPrice, pos.strikePrice, T, optPrice)?.delta ?? null
}

// ----- 获取单个仓位的持有方 Theta（prefer 预计算字段 → 回退 BS） -----

function getBSTheta(pos: AlertPosition): number | null {
  if (pos.theta !== undefined) return pos.theta
  if (!isOptionType(pos.type) || !pos.expirationDate) return null
  const T = daysUntilExpiry(pos.expirationDate) / 365
  const optPrice = pos.currentPremium ?? pos.premium
  if (T <= 0 || optPrice <= 0) return null
  return computeGreeks(optionSide(pos.type), pos.currentPrice, pos.strikePrice, T, optPrice)?.theta ?? null
}

// ----- sell_put 距离行权价百分比 -----

function moneynessDist(pos: AlertPosition): number | null {
  if (pos.currentPrice <= 0) return null
  return ((pos.currentPrice - pos.strikePrice) / pos.currentPrice) * 100
  // >0 = OTM, <0 = ITM (for puts)
}

// ----- sell 仓位浮盈百分比 -----

function pnlProgress(pos: AlertPosition): number | null {
  if (pos.currentPremium === undefined || pos.premium <= 0) return null
  return ((pos.premium - pos.currentPremium) / pos.premium) * 100
  // >0 = 盈利, <0 = 亏损
}

// ----- Long 仓位成本摊薄进度 -----

function dilutionPercent(
  pos: AlertPosition,
  getCostRecords: (id: string) => CostRecord[],
): number | null {
  if (pos.type !== 'leap_call' && pos.type !== 'stock') return null

  const records = getCostRecords(pos.id)
  const totalCollected = records.reduce(
    (sum, r) => sum + r.premiumCollected * r.quantity * 100, 0,
  )

  const initialCostPerShare =
    pos.type === 'stock' ? (pos.costBasis ?? pos.strikePrice) : pos.premium
  const mult = pos.type === 'stock' ? 1 : 100
  const totalInitialCost = initialCostPerShare * pos.quantity * mult

  return totalInitialCost > 0 ? (totalCollected / totalInitialCost) * 100 : null
}

// ===== 账户级指标计算 =====

function computeAccountMetrics(positions: AlertPosition[], cashBalance: number) {
  let stockValue = 0
  let optionsValue = 0
  let totalMargin = 0

  for (const pos of positions) {
    if (pos.type === 'stock') {
      stockValue += pos.currentPrice * pos.quantity
    } else if (pos.currentPremium !== undefined) {
      const val = pos.currentPremium * pos.quantity * 100
      if (pos.type === 'sell_put' || pos.type === 'sell_call') {
        optionsValue -= val
      } else {
        optionsValue += val
      }
    }
    if (pos.type === 'sell_put') {
      totalMargin += ibkrMargin(pos.currentPrice, pos.strikePrice, pos.premium) * pos.quantity * 100
    }
  }

  const nav = cashBalance + stockValue + optionsValue
  return {
    nav,
    stockValue,
    optionsValue,
    totalMargin,
    cashRatio: nav > 0 ? cashBalance / nav : 0,
    bprUtilization: nav > 0 ? totalMargin / nav : 0,
  }
}

// ===== 净 Theta（汇总所有期权持仓，含 Long Call 的负 Theta） =====

function computeNetTheta(positions: AlertPosition[]): number {
  let net = 0
  for (const pos of positions) {
    if (!isOptionType(pos.type)) continue
    const bsTheta = getBSTheta(pos)
    if (bsTheta === null) continue
    const sign = (pos.type === 'sell_put' || pos.type === 'sell_call') ? -1 : 1
    net += bsTheta * sign * pos.quantity * 100
  }
  return net
}

// ===== 主入口 =====

/**
 * 根据持仓和账户数据生成结构化预警数组。
 *
 * @param positions  当前持仓列表（股票 + 期权，已平仓的由调用方过滤）
 * @param cashBalance  账户现金余额
 * @param getCostRecords  (positionId) => CostRecord[] — 查询该仓位的成本摊薄记录
 * @returns 按 level→priority 排序的预警数组
 */
export function generateAlerts(
  positions: AlertPosition[],
  cashBalance: number,
  getCostRecords: (id: string) => CostRecord[],
): Alert[] {
  const alerts: Alert[] = []
  if (positions.length === 0) return alerts

  // 过滤已平仓
  const active = positions // 调用方传入前已过滤 isClosed

  // --- 账户级指标 ---
  const { nav, cashRatio, bprUtilization } = computeAccountMetrics(active, cashBalance)
  const netTheta = computeNetTheta(active)

  // ---- 现金比例 (target: '账户') ----
  if (nav > 0) {
    if (cashRatio >= 0.40) {
      alerts.push({
        level: 'green', target: '账户',
        message: `现金比例 ${(cashRatio * 100).toFixed(0)}%，流动性充裕`,
        priority: 3,
      })
    } else if (cashRatio >= 0.20) {
      const p = cashRatio < 0.15 ? 1 : 2
      alerts.push({
        level: 'yellow', target: '账户',
        message: `现金比例 ${(cashRatio * 100).toFixed(0)}%，偏低，注意流动性`,
        priority: p as 1 | 2,
      })
    } else {
      const p = cashRatio < 0.15 ? 1 : 2
      alerts.push({
        level: 'red', target: '账户',
        message: `现金比例仅 ${(cashRatio * 100).toFixed(0)}%，严重不足`,
        priority: p as 1 | 2,
      })
    }
  }

  // ---- BPR 占用率 (target: '账户') ----
  if (nav > 0) {
    if (bprUtilization < 0.30) {
      alerts.push({
        level: 'green', target: '账户',
        message: `BPR占用率 ${(bprUtilization * 100).toFixed(0)}%，保证金充裕`,
        priority: 3,
      })
    } else if (bprUtilization <= 0.50) {
      alerts.push({
        level: 'yellow', target: '账户',
        message: `BPR占用率 ${(bprUtilization * 100).toFixed(0)}%，适度使用中`,
        priority: 2,
      })
    } else {
      alerts.push({
        level: 'red', target: '账户',
        message: `BPR占用率 ${(bprUtilization * 100).toFixed(0)}%，过高，考虑降低仓位`,
        priority: 1,
      })
    }
  }

  // ---- 净 Theta (target: '账户') ----
  {
    const t = netTheta
    if (t > 0) {
      alerts.push({
        level: 'green', target: '账户',
        message: `净Theta +$${t.toFixed(0)}/天，时间价值收益健康`,
        priority: 3,
      })
    } else if (t >= -30) {
      alerts.push({
        level: 'yellow', target: '账户',
        message: `净Theta $${t.toFixed(0)}/天，时间价值偏低`,
        priority: 3,
      })
    } else {
      alerts.push({
        level: 'red', target: '账户',
        message: `净Theta $${t.toFixed(0)}/天，时间损耗过重`,
        priority: 3,
      })
    }
  }

  // ===== 逐笔仓位预警 =====

  for (const pos of active) {
    // ======== Sell Put ========
    if (pos.type === 'sell_put') {
      const dte = pos.expirationDate ? daysUntilExpiry(pos.expirationDate) : null
      const distPct = moneynessDist(pos)

      // --- Moneyness ---
      if (distPct !== null) {
        if (distPct < 0) {
          // ITM → red, P1
          alerts.push({
            level: 'red', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 已进入实值，行权风险高，立即决策`,
            priority: 1,
          })
        } else if (distPct <= 2) {
          // ATM / OTM 0-2% → orange, P2
          alerts.push({
            level: 'orange', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 已贴近行权价(${distPct.toFixed(1)}%OTM)，建议评估Roll或接股策略`,
            priority: 2,
          })
        } else if (distPct <= 5) {
          // OTM 2-5% → yellow, P3
          alerts.push({
            level: 'yellow', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 距行权价${distPct.toFixed(1)}%，开始关注标的走势`,
            priority: 3,
          })
        } else {
          // OTM > 5% → green
          alerts.push({
            level: 'green', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 距行权价安全(${distPct.toFixed(1)}%OTM)，时间价值衰减中`,
            priority: 3,
          })
        }
      }

      // --- DTE ---
      if (dte !== null && dte > 0) {
        const isOtm = distPct !== null && distPct >= 0
        if (dte < 7 && isOtm) {
          // Pin Risk → red
          alerts.push({
            level: 'red', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 仅剩${dte}天到期且OTM，Pin Risk！强烈建议立即平仓`,
            priority: 2, // P2: DTE<21 规则
          })
        } else if (dte < 21) {
          alerts.push({
            level: 'yellow', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P ${dte}天到期，即将到期，建议评估平仓或展期`,
            priority: 2,
          })
        } else if (dte <= 45) {
          alerts.push({
            level: 'yellow', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P ${dte}天到期，进入Theta加速衰减阶段，可开始关注`,
            priority: 3,
          })
        } else {
          alerts.push({
            level: 'green', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P ${dte}天到期，处于最佳Theta区间`,
            priority: 3,
          })
        }
      }

      // --- 浮盈/浮亏 ---
      const pnlPct = pnlProgress(pos)
      if (pnlPct !== null) {
        if (pnlPct <= -200) {
          alerts.push({
            level: 'red', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 浮亏超200%权利金(${pnlPct.toFixed(0)}%)，建议止损决策`,
            priority: 1,
          })
        } else if (pnlPct <= -100) {
          alerts.push({
            level: 'orange', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 浮亏超过权利金(${pnlPct.toFixed(0)}%)，进入防守区`,
            priority: 2,
          })
        } else if (pnlPct >= 75) {
          alerts.push({
            level: 'yellow', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 已盈利${pnlPct.toFixed(0)}%，建议平仓释放BPR`,
            priority: 3,
          })
        } else if (pnlPct >= 50) {
          alerts.push({
            level: 'green', target: pos.id,
            message: `${pos.ticker} $${pos.strikePrice}P 已盈利${pnlPct.toFixed(0)}%，可考虑平仓锁利`,
            priority: 3,
          })
        }
      }
    }

    // ======== Long Call / PMCC (leap_call, buy_call) ========
    if (pos.type === 'leap_call' || pos.type === 'buy_call') {
      // --- Delta ---
      const delta = getDelta(pos)
      if (delta !== null) {
        const absDelta = Math.abs(delta)
        let level: AlertLevel, msg: string
        let pri: 1 | 2 | 3 = 2 // Delta 异常 → P2

        if (absDelta > 0.9) {
          level = 'yellow'
          msg = `${pos.ticker} Delta ${delta.toFixed(2)}，深度实值，时间价值极低，考虑换月`
        } else if (absDelta < 0.6) {
          level = 'yellow'
          msg = `${pos.ticker} Delta ${delta.toFixed(2)}，偏低，正股替代效果减弱`
        } else {
          level = 'green'
          msg = `${pos.ticker} Delta ${delta.toFixed(2)}，健康，正股替代效果良好`
          pri = 3
        }
        alerts.push({ level, target: pos.id, message: msg, priority: pri })
      }
    }

    // ======== Cost Dilution (leap_call, stock) ========
    if (pos.type === 'leap_call' || pos.type === 'stock') {
      // 摊薄进度为 0% 且持仓超过 14 天
      const dilPct = dilutionPercent(pos, getCostRecords)
      const heldDays = daysSince(pos.openDate)

      if (dilPct !== null && dilPct <= 0 && heldDays > 14) {
        alerts.push({
          level: 'yellow', target: pos.id,
          message: `${pos.ticker} 建仓超${heldDays}天尚未摊薄成本，可考虑卖出Covered Call`,
          priority: 3,
        })
      }
    }
  }

  // ===== 排序：level 严重度 → priority =====
  const levelOrder: Record<AlertLevel, number> = { red: 0, orange: 1, yellow: 2, green: 3 }
  return alerts.sort((a, b) => {
    const la = levelOrder[a.level], lb = levelOrder[b.level]
    if (la !== lb) return la - lb
    return a.priority - b.priority
  })
}
