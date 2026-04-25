import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import type { Position } from '@/types'
import type { StaticMarketData } from '@/types'
import { Shield, Info, X, AlertTriangle } from 'lucide-react'
import { fetchStaticMarketData } from '@/lib/marketData'
import { showToast } from '@/components/ui/toast'
import {
  enrichPositionsWithGreeks,
  computeAccountMetrics,
  computeSellPutRisk,
  computeStressTest,
  computePortfolioGreeks,
  computePositionMonitoring,
  generateAlerts,
  formatCompactCurrency,
  statusLowerBetter,
  statusHigherWorse,
  statusInRange,
  THRESHOLDS,
  type StatusLevel,
  type Alert,
} from '@/lib/riskCalculations'

interface RiskControlTabProps {
  positions: Position[]
  cashBalance: number
  onSetCashBalance: (value: number) => void
}

// === Metric tooltips — shown as bottom sheet on tap ===

const METRIC_INFO: Record<string, { title: string; desc: string }> = {
  cashRatio: {
    title: '现金比例',
    desc: '现金占账户净值(NAV)的比例。建议保持≥40%，确保有足够现金应对 Sell Put 被行权。低于25%时，你可能无法同时接盘多个被行权的 Put，面临被迫平仓风险。',
  },
  bpr: {
    title: 'BPR占用率 (Buying Power Reduction)',
    desc: '卖 Put 占用的保证金(按 IBKR Reg-T 标准估算) ÷ 账户净值。低于50%为健康水平，超过70%显著增加保证金追缴(margin call)风险。极端行情中券商可能临时提高保证金要求。',
  },
  notional: {
    title: '名义敞口率',
    desc: '所有 Sell Put 的(行权价 × 100 × 合约数) ÷ NAV。代表"如果所有 Put 同时被行权，你需要支付的总金额占比"。通常>100%是常见的(杠杆交易)，但需要配合 Safety Ratio 评估实际风险。',
  },
  theta: {
    title: '净Theta / 日',
    desc: '时间流逝每天为你赚取(正值)或损失(负值)的金额。Sell Put/Call 获得正 Theta，Buy Call/Put 损失 Theta。+$10~$50/天是中小账户 Sell Put 策略的健康范围。如果为负，说明买方头寸的时间损耗超过了卖方收入。',
  },
  vega: {
    title: '净Vega敏感度',
    desc: 'VIX 每上涨1点，你的组合市值变化金额。卖方通常为负值——当市场恐慌、波动率飙升时，你的卖方头寸会浮亏。中小账户超过 -$300 需要警惕。可通过买入远期 Put 来对冲 Vega 风险。',
  },
  safetyRatio: {
    title: 'Safety Ratio',
    desc: '压力测试下"可调动资金 ÷ 行权义务"。>1.0 = 即使全部 Put 被行权也能覆盖；0.6~1.0 = 需要关注，考虑减仓；<0.6 = 严重不足，建议立即缩减 Sell Put 仓位或补充现金。这是你账户抗风险能力的核心指标。',
  },
  exposure: {
    title: '有效敞口',
    desc: '行权价 × |Delta| × 合约数 × 100。经 Delta 加权后的实际风险敞口——Delta 0.15 的深虚值 Put 被行权概率远低于 Delta 0.40 的平值 Put。单笔有效敞口占 NAV 超过20%需注意集中度，超过30%为高风险。',
  },
  distance: {
    title: '距行权价',
    desc: '(当前股价 - 行权价) / 当前股价 × 100%。正值 = 虚值(安全缓冲)，负值 = 实值(危险)。<5%需要重点关注，<0%意味着 Put 已有内在价值、被行权概率大幅增加。',
  },
  funds: {
    title: '可调动资金',
    desc: '现金 + 正股残值(下跌后市值) + LEAP残值(按 Delta 衰减估算)。代表在假设的下跌情景下，你能调动来应对行权义务的总资金。',
  },
  obligation: {
    title: '行权义务',
    desc: '所有 Sell Put 同时被行权需要支付的总金额(∑ 行权价 × 100 × 合约数)。这是绝对最坏情况——实际中不太可能全部同时被行权，但用来衡量极端风险。',
  },
  shortfall: {
    title: '资金缺口',
    desc: '行权义务 - 可调动资金。代表在压力情景下你还差多少资金。有缺口意味着券商会追加保证金，你可能被迫以不利价格平仓或面临强制清算。',
  },
}

const STATUS_DOT: Record<StatusLevel, string> = {
  green: 'bg-profit',
  yellow: 'bg-warning',
  red: 'bg-loss',
}

const STATUS_TEXT: Record<StatusLevel, string> = {
  green: 'text-profit',
  yellow: 'text-warning',
  red: 'text-loss',
}

const STATUS_BG: Record<StatusLevel, string> = {
  green: 'bg-profit/10',
  yellow: 'bg-warning/10',
  red: 'bg-loss/10',
}

export function RiskControlTab({ positions, cashBalance, onSetCashBalance }: RiskControlTabProps) {
  const [marketData, setMarketData] = useState<StaticMarketData | null>(null)
  const [stressDropPercent, setStressDropPercent] = useState(20)
  const [cashInput, setCashInput] = useState(cashBalance > 0 ? cashBalance.toString() : '')
  const [tooltipKey, setTooltipKey] = useState<string | null>(null)

  useEffect(() => {
    fetchStaticMarketData().then(setMarketData)
  }, [])

  // === Computation pipeline ===
  const enriched = useMemo(
    () => enrichPositionsWithGreeks(positions, marketData),
    [positions, marketData],
  )
  const account = useMemo(
    () => computeAccountMetrics(enriched, cashBalance),
    [enriched, cashBalance],
  )
  const sellPutRisk = useMemo(
    () => computeSellPutRisk(enriched, account.nav),
    [enriched, account.nav],
  )
  const stressTest = useMemo(
    () => computeStressTest(enriched, cashBalance, stressDropPercent),
    [enriched, cashBalance, stressDropPercent],
  )
  const greeks = useMemo(
    () => computePortfolioGreeks(enriched),
    [enriched],
  )
  const monitoring = useMemo(
    () => computePositionMonitoring(enriched),
    [enriched],
  )
  const alerts = useMemo(
    () => generateAlerts(account, sellPutRisk, greeks, monitoring, stressTest),
    [account, sellPutRisk, greeks, monitoring, stressTest],
  )

  // Monitoring lookup by positionId
  const monitorMap = useMemo(() => {
    const map: Record<string, (typeof monitoring)[0]> = {}
    for (const m of monitoring) map[m.positionId] = m
    return map
  }, [monitoring])

  // === Status computations ===
  const cashRatioStatus = statusLowerBetter(account.cashRatio, THRESHOLDS.cashRatio.healthy, THRESHOLDS.cashRatio.warning)
  const bprStatus = statusHigherWorse(account.bprUtilization, THRESHOLDS.bprUtilization.healthy, THRESHOLDS.bprUtilization.warning)
  const notionalStatus = statusHigherWorse(sellPutRisk.notionalRatio, THRESHOLDS.notionalRatio.healthy, THRESHOLDS.notionalRatio.warning)
  const thetaStatus = statusInRange(greeks.netTheta, THRESHOLDS.netTheta.idealLow, THRESHOLDS.netTheta.idealHigh, THRESHOLDS.netTheta.criticalNeg)
  const vegaStatus: StatusLevel = greeks.netVega < THRESHOLDS.netVega.warning ? 'red'
    : greeks.netVega < THRESHOLDS.netVega.warning * 0.8 ? 'yellow'
    : 'green'
  const safetyStatus: StatusLevel = stressTest.assignmentObligation > 0
    ? statusLowerBetter(stressTest.safetyRatio, THRESHOLDS.safetyRatio.healthy, THRESHOLDS.safetyRatio.critical)
    : 'green'

  const handleSaveCash = () => {
    const val = parseFloat(cashInput)
    if (!isNaN(val) && val >= 0) {
      onSetCashBalance(val)
      showToast(`现金余额已保存: ${formatCompactCurrency(val)}`, 'success')
    } else if (cashInput.trim() === '') {
      onSetCashBalance(0)
      setCashInput('')
      showToast('现金余额已清零', 'success')
    } else {
      showToast('请输入有效的金额', 'error')
    }
  }

  const getPositionStatus = (p: (typeof sellPutRisk.positions)[0]): StatusLevel => {
    const mon = monitorMap[p.positionId]
    if (mon && mon.distancePercent < 0) return 'red'
    if (p.exposurePercent > THRESHOLDS.singleExposure.warning * 100) return 'red'
    if (mon && mon.signal === 'stop_loss') return 'red'
    if (mon && mon.distancePercent < THRESHOLDS.nearStrikePct) return 'yellow'
    if (p.exposurePercent > THRESHOLDS.singleExposure.target * 100) return 'yellow'
    if (mon && mon.dte <= THRESHOLDS.nearExpiryDTE) return 'yellow'
    return 'green'
  }

  // Empty state
  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
        <Shield className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">暂无持仓，请先在持仓页面添加持仓</p>
      </div>
    )
  }

  const redYellowAlerts = alerts.filter(a => a.level !== 'green')
  const shortfall = stressTest.assignmentObligation > stressTest.availableFunds
    ? stressTest.assignmentObligation - stressTest.availableFunds
    : 0

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Tooltip Bottom Sheet */}
      {tooltipKey && METRIC_INFO[tooltipKey] && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          onClick={() => setTooltipKey(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-card p-5 pb-8 shadow-xl animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground">
                {METRIC_INFO[tooltipKey].title}
              </h3>
              <button
                onClick={() => setTooltipKey(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {METRIC_INFO[tooltipKey].desc}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-foreground">风控中心</h2>
          <p className="text-xs text-muted-foreground">NAV {formatCompactCurrency(account.nav)}</p>
        </div>
      </div>

      {/* Cash Balance Input — always visible at top */}
      <div className="flex gap-2 items-center">
        <label className="text-xs text-muted-foreground whitespace-nowrap shrink-0">现金</label>
        <input
          type="number"
          className="input-field flex-1 text-sm"
          placeholder="输入现金余额"
          value={cashInput}
          onChange={e => setCashInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              handleSaveCash()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          inputMode="decimal"
        />
        <button
          onClick={handleSaveCash}
          className="rounded-lg bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground shrink-0"
        >
          保存
        </button>
      </div>

      {/* ═══ Section 1: Account Health Dashboard ═══ */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-2.5 border-b">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              账户健康仪表盘
            </h3>
          </div>
          <div className="divide-y">
            <DashboardRow label="现金比例" value={`${(account.cashRatio * 100).toFixed(0)}%`} status={cashRatioStatus} infoKey="cashRatio" onInfo={setTooltipKey} />
            <DashboardRow label="BPR占用率" value={`${(account.bprUtilization * 100).toFixed(0)}%`} status={bprStatus} infoKey="bpr" onInfo={setTooltipKey} />
            <DashboardRow label="名义敞口率" value={`${(sellPutRisk.notionalRatio * 100).toFixed(0)}%`} status={notionalStatus} infoKey="notional" onInfo={setTooltipKey} />
            <DashboardRow label="净Theta" value={`${greeks.netTheta >= 0 ? '+' : ''}$${greeks.netTheta.toFixed(0)}/天`} status={thetaStatus} infoKey="theta" onInfo={setTooltipKey} />
            <DashboardRow label="净Vega敏感度" value={`$${greeks.netVega.toFixed(0)}/VIX点`} status={vegaStatus} infoKey="vega" onInfo={setTooltipKey} />
          </div>
        </CardContent>
      </Card>

      {/* Alerts (red/yellow only) */}
      {redYellowAlerts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {redYellowAlerts.slice(0, 5).map((alert, i) => (
            <AlertBadge key={i} alert={alert} />
          ))}
          {redYellowAlerts.length > 5 && (
            <p className="text-[10px] text-muted-foreground text-center">
              +{redYellowAlerts.length - 5} 条更多
            </p>
          )}
        </div>
      )}

      {/* ═══ Section 2: Sell Put Per-Position Risk ═══ */}
      {sellPutRisk.positions.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-2.5 border-b flex items-center justify-between">
              <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Sell Put 逐笔风险
              </h3>
              <button onClick={() => setTooltipKey('exposure')} className="text-muted-foreground/50">
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="divide-y">
              {sellPutRisk.positions.map(p => {
                const mon = monitorMap[p.positionId]
                const status = getPositionStatus(p)
                return (
                  <div key={p.positionId} className="px-4 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-foreground">
                        {p.ticker} ${p.strikePrice} ×{p.quantity}
                      </span>
                      <div className="flex items-center gap-2">
                        {mon && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            mon.signal === 'take_profit' ? 'bg-profit/10 text-profit' :
                            mon.signal === 'stop_loss' ? 'bg-loss/10 text-loss' :
                            'bg-secondary text-secondary-foreground'
                          }`}>
                            {mon.signal === 'take_profit' ? '止盈' : mon.signal === 'stop_loss' ? '止损' : '持有'}
                          </span>
                        )}
                        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span>
                        有效敞口
                        <span className={`ml-0.5 font-medium ${STATUS_TEXT[
                          p.exposurePercent > THRESHOLDS.singleExposure.warning * 100 ? 'red'
                          : p.exposurePercent > THRESHOLDS.singleExposure.target * 100 ? 'yellow'
                          : 'green'
                        ]}`}>
                          {formatCompactCurrency(p.effectiveExposure)}({p.exposurePercent.toFixed(1)}%)
                        </span>
                      </span>
                      {mon && (
                        <>
                          <span>
                            距行权价
                            <span className={`ml-0.5 font-medium ${
                              mon.distancePercent < 0 ? 'text-loss' :
                              mon.distancePercent < 5 ? 'text-warning' : 'text-profit'
                            }`}>
                              {mon.distancePercent >= 0 ? '+' : ''}{mon.distancePercent.toFixed(1)}%
                            </span>
                          </span>
                          <span>DTE <span className="font-medium text-foreground">{mon.dte}</span></span>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══ Section 3: Stress Test (Interactive) ═══ */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              压力测试
            </h3>
            <span className="text-xs font-bold text-foreground">
              市场下跌 {stressDropPercent}%
            </span>
          </div>

          <input
            type="range"
            min={10}
            max={50}
            step={5}
            value={stressDropPercent}
            onChange={e => setStressDropPercent(parseInt(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none bg-secondary cursor-pointer mb-1
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
              [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mb-4">
            <span>10%</span><span>20%</span><span>30%</span><span>40%</span><span>50%</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <StressMetric
              label="可调动资金"
              value={formatCompactCurrency(stressTest.availableFunds)}
              sublabel={`现金${formatCompactCurrency(cashBalance)} + 残值${formatCompactCurrency(stressTest.stockResidual + stressTest.leapResidual)}`}
              infoKey="funds"
              onInfo={setTooltipKey}
            />
            <StressMetric
              label="行权义务"
              value={formatCompactCurrency(stressTest.assignmentObligation)}
              sublabel="全部Sell Put行权"
              infoKey="obligation"
              onInfo={setTooltipKey}
            />
          </div>

          {/* Safety Ratio — large display */}
          <div className={`rounded-xl p-4 text-center ${STATUS_BG[safetyStatus]}`}>
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <span className="text-[10px] text-muted-foreground">Safety Ratio</span>
              <button onClick={() => setTooltipKey('safetyRatio')} className="text-muted-foreground/50">
                <Info className="h-3 w-3" />
              </button>
            </div>
            <div className={`text-3xl font-bold ${STATUS_TEXT[safetyStatus]}`}>
              {stressTest.assignmentObligation > 0
                ? stressTest.safetyRatio.toFixed(2)
                : '∞'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {safetyStatus === 'green' ? '覆盖充足'
                : safetyStatus === 'yellow' ? '需要关注'
                : '严重不足'}
            </div>
          </div>

          {/* Shortfall warning */}
          {shortfall > 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-loss/10 border border-loss/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-loss" />
                <span className="text-xs text-loss">缺口</span>
                <button onClick={() => setTooltipKey('shortfall')} className="text-loss/50">
                  <Info className="h-3 w-3" />
                </button>
              </div>
              <span className="text-sm font-bold text-loss">
                {formatCompactCurrency(shortfall)}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ===== Sub-components =====

function DashboardRow({ label, value, status, infoKey, onInfo }: {
  label: string
  value: string
  status: StatusLevel
  infoKey: string
  onInfo: (key: string) => void
}) {
  return (
    <div className="flex items-center px-4 py-2.5">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-xs text-foreground">{label}</span>
        <button
          onClick={(e) => { e.stopPropagation(); onInfo(infoKey) }}
          className="text-muted-foreground/40 shrink-0"
        >
          <Info className="h-3 w-3" />
        </button>
      </div>
      <span className={`text-xs font-semibold tabular-nums mr-3 ${STATUS_TEXT[status]}`}>
        {value}
      </span>
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
    </div>
  )
}

function StressMetric({ label, value, sublabel, infoKey, onInfo }: {
  label: string
  value: string
  sublabel: string
  infoKey: string
  onInfo: (key: string) => void
}) {
  return (
    <div className="rounded-lg bg-secondary/50 p-3">
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <button onClick={() => onInfo(infoKey)} className="text-muted-foreground/40">
          <Info className="h-2.5 w-2.5" />
        </button>
      </div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{sublabel}</div>
    </div>
  )
}

function AlertBadge({ alert }: { alert: Alert }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
      alert.level === 'red'
        ? 'text-loss bg-loss/10 border-loss/20'
        : 'text-warning bg-warning/10 border-warning/20'
    }`}>
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{alert.message}</span>
    </div>
  )
}
