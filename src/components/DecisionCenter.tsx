import { useState, useEffect, useMemo } from 'react'
import type { Position, CostRecord, StaticMarketData } from '@/types'
import { Card, CardContent } from '@/components/ui/card'
import { fetchStaticMarketData, formatDataAge } from '@/lib/marketData'
import {
  formatCurrency,
  formatDate,
  calculateProfitPercent,
  calculateIBKRMargin,
} from '@/lib/calculations'
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
  THRESHOLDS,
  type EnrichedPosition,
  type Alert,
  type StatusLevel,
  type PositionMonitor,
} from '@/lib/riskCalculations'
import {
  LayoutDashboard,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Shield,
  DollarSign,
  Clock,
  Target,
  Activity,
  ArrowLeft,
  RefreshCw,
} from 'lucide-react'

// ===== Props =====

interface DecisionCenterProps {
  positions: Position[]
  cashBalance: number
  getCostRecordsForPosition: (positionId: string) => CostRecord[]
  onBack: () => void
}

// ===== Status helpers =====

const STATUS_COLOR: Record<StatusLevel, string> = {
  green: 'text-profit',
  yellow: 'text-warning',
  red: 'text-loss',
}

const STATUS_BG: Record<StatusLevel, string> = {
  green: 'bg-profit/10',
  yellow: 'bg-warning/10',
  red: 'bg-loss/10',
}

const STATUS_DOT: Record<StatusLevel, string> = {
  green: 'bg-profit',
  yellow: 'bg-warning',
  red: 'bg-loss',
}

const SIGNAL_LABEL: Record<string, { text: string; class: string }> = {
  take_profit: { text: '可止盈', class: 'badge-profit' },
  hold: { text: '持有', class: 'badge-primary' },
  stop_loss: { text: '考虑止损', class: 'badge-loss' },
}

const TYPE_LABEL: Record<string, string> = {
  sell_put: 'Sell Put',
  sell_call: 'Sell Call',
  leap_call: 'LEAP Call',
  buy_call: 'Buy Call',
  buy_put: 'Buy Put',
  stock: '正股',
  custom: '自定义',
}

// ===== Derive unified position status =====

interface PositionDecision {
  enriched: EnrichedPosition
  monitor: PositionMonitor | null
  status: StatusLevel
  reason: string
  action: string
  dte: number | null
  pnlPercent: number | null
  distancePercent: number | null
  costBasisReduction: number
  sortPriority: number // lower = more urgent
}

function deriveDecisions(
  enrichedList: EnrichedPosition[],
  monitoring: PositionMonitor[],
  alerts: Alert[],
  getCostRecordsForPosition: (id: string) => CostRecord[],
): PositionDecision[] {
  const monitorMap = new Map<string, PositionMonitor>()
  for (const m of monitoring) monitorMap.set(m.positionId, m)

  const alertsByPos = new Map<string, Alert[]>()
  for (const a of alerts) {
    if (a.positionId) {
      const list = alertsByPos.get(a.positionId) || []
      list.push(a)
      alertsByPos.set(a.positionId, list)
    }
  }

  return enrichedList.map(ep => {
    const pos = ep.position
    const mon = monitorMap.get(pos.id) || null
    const posAlerts = alertsByPos.get(pos.id) || []
    const dte = ep.dte

    // Cost basis reduction from covered calls etc.
    const records = getCostRecordsForPosition(pos.id)
    const costBasisReduction = records.reduce(
      (sum, r) => sum + r.premiumCollected * r.quantity * 100, 0
    )

    // PnL percent for sell positions
    let pnlPercent: number | null = null
    if ((pos.type === 'sell_put' || pos.type === 'sell_call') &&
      pos.currentPremium !== undefined && pos.premium > 0) {
      pnlPercent = calculateProfitPercent(pos.premium, pos.currentPremium)
    } else if (pos.type === 'stock' && pos.costBasis && pos.costBasis > 0) {
      pnlPercent = ((pos.currentPrice - pos.costBasis) / pos.costBasis) * 100
    } else if ((pos.type === 'leap_call' || pos.type === 'buy_call' || pos.type === 'buy_put') &&
      pos.currentPremium !== undefined && pos.premium > 0) {
      pnlPercent = ((pos.currentPremium - pos.premium) / pos.premium) * 100
    }

    // Distance percent (for sell positions)
    const distancePercent = mon?.distancePercent ?? (
      pos.currentPrice > 0 && pos.strikePrice > 0
        ? ((pos.currentPrice - pos.strikePrice) / pos.currentPrice) * 100
        : null
    )

    // Determine status + reason + action
    let status: StatusLevel = 'green'
    let reason = ''
    let action = ''
    let sortPriority = 100

    // Check red alerts first
    const redAlerts = posAlerts.filter(a => a.level === 'red')
    const yellowAlerts = posAlerts.filter(a => a.level === 'yellow')

    if (redAlerts.length > 0) {
      status = 'red'
      reason = redAlerts[0].message
      action = mon?.signal === 'stop_loss' ? '考虑平仓止损' : '需要立即关注'
      sortPriority = 10
    } else if (mon?.signal === 'stop_loss') {
      status = 'red'
      reason = `亏损 ${Math.abs(pnlPercent ?? 0).toFixed(0)}%`
      action = '考虑平仓止损'
      sortPriority = 10
    } else if (yellowAlerts.length > 0) {
      status = 'yellow'
      reason = yellowAlerts[0].message
      action = '需要关注'
      sortPriority = 30
    } else if (dte !== null && dte <= 7 && dte > 0) {
      status = 'yellow'
      reason = `${dte}天后到期`
      action = '准备平仓或展期'
      sortPriority = 25
    } else if (mon?.signal === 'take_profit') {
      status = 'green'
      reason = `盈利 ${(pnlPercent ?? 0).toFixed(0)}%`
      action = '可考虑止盈平仓'
      sortPriority = 40
    } else if (dte !== null && dte <= 0) {
      status = 'red'
      reason = '已到期'
      action = '清理到期合约'
      sortPriority = 5
    } else {
      // Normal hold
      status = 'green'
      reason = pos.type === 'stock'
        ? `持股 ${pos.quantity} 股`
        : dte !== null ? `${dte}天到期` : '正常持有'
      action = '继续持有'
      sortPriority = 80
    }

    return {
      enriched: ep,
      monitor: mon,
      status,
      reason,
      action,
      dte,
      pnlPercent,
      distancePercent,
      costBasisReduction,
      sortPriority,
    }
  }).sort((a, b) => a.sortPriority - b.sortPriority)
}

// ===== Component =====

export function DecisionCenter({
  positions,
  cashBalance,
  getCostRecordsForPosition,
  onBack,
}: DecisionCenterProps) {
  const [marketData, setMarketData] = useState<StaticMarketData | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    fetchStaticMarketData().then(setMarketData)
  }, [])

  const handleRefresh = async () => {
    setRefreshing(true)
    const data = await fetchStaticMarketData()
    setMarketData(data)
    setRefreshing(false)
  }

  // === Full computation pipeline (same as RiskControlTab) ===
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
    () => computeStressTest(enriched, cashBalance, 20),
    [enriched, cashBalance],
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

  // === Derive per-position decisions ===
  const decisions = useMemo(
    () => deriveDecisions(enriched, monitoring, alerts, getCostRecordsForPosition),
    [enriched, monitoring, alerts, getCostRecordsForPosition],
  )

  // === Counts ===
  const redCount = alerts.filter(a => a.level === 'red').length
  const yellowCount = alerts.filter(a => a.level === 'yellow').length
  const urgentDecisions = decisions.filter(d => d.status === 'red')
  const watchDecisions = decisions.filter(d => d.status === 'yellow')

  // Account status
  const cashStatus = statusLowerBetter(account.cashRatio, THRESHOLDS.cashRatio.healthy, THRESHOLDS.cashRatio.warning)
  const bprStatus = statusHigherWorse(account.bprUtilization, THRESHOLDS.bprUtilization.healthy, THRESHOLDS.bprUtilization.warning)

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between h-12 px-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs">返回</span>
          </button>
          <div className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Decision Center</h1>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
              LAB
            </span>
          </div>
          <button
            onClick={handleRefresh}
            className="text-muted-foreground hover:text-foreground transition-colors"
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-8">
        <div className="flex flex-col gap-4 animate-fade-in">

          {/* ===== Section 1: Account Summary ===== */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="card-elevated">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">NAV</span>
                </div>
                <p className="text-lg font-bold text-foreground">
                  {formatCompactCurrency(account.nav)}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] ${STATUS_COLOR[cashStatus]}`}>
                    现金 {(account.cashRatio * 100).toFixed(0)}%
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">风险</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className={`text-lg font-bold ${STATUS_COLOR[bprStatus]}`}>
                    {(account.bprUtilization * 100).toFixed(0)}%
                  </p>
                  <span className="text-[10px] text-muted-foreground">BPR</span>
                </div>
                {stressTest.assignmentObligation > 0 && (
                  <div className="flex items-center gap-1 mt-1">
                    <span className="text-[10px] text-muted-foreground">Safety</span>
                    <span className={`text-[10px] font-medium ${
                      stressTest.safetyRatio >= 1.0 ? 'text-profit' :
                      stressTest.safetyRatio >= 0.6 ? 'text-warning' : 'text-loss'
                    }`}>
                      {stressTest.safetyRatio === Infinity ? '>10' : stressTest.safetyRatio.toFixed(2)}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Theta/日</span>
                </div>
                <p className={`text-lg font-bold ${greeks.netTheta >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {greeks.netTheta >= 0 ? '+' : ''}{formatCompactCurrency(greeks.netTheta)}
                </p>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">持仓</span>
                </div>
                <p className="text-lg font-bold text-foreground">{positions.length}</p>
                <div className="flex items-center gap-2 mt-1">
                  {redCount > 0 && <span className="text-[10px] text-loss">{redCount} 危险</span>}
                  {yellowCount > 0 && <span className="text-[10px] text-warning">{yellowCount} 关注</span>}
                  {redCount === 0 && yellowCount === 0 && (
                    <span className="text-[10px] text-profit">全部正常</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Data freshness */}
          {marketData && (
            <div className="text-center">
              <span className="text-[10px] text-muted-foreground">
                行情数据 {formatDataAge(marketData.timestamp)}
              </span>
            </div>
          )}

          {/* ===== Section 2: Priority Actions ===== */}
          {(urgentDecisions.length > 0 || watchDecisions.length > 0) && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-1">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h2 className="text-sm font-semibold text-foreground">待处理</h2>
              </div>

              <div className="flex flex-col gap-2">
                {urgentDecisions.map(d => (
                  <PriorityCard key={d.enriched.position.id} decision={d} onTap={() =>
                    setExpandedId(expandedId === d.enriched.position.id ? null : d.enriched.position.id)
                  } />
                ))}
                {watchDecisions.map(d => (
                  <PriorityCard key={d.enriched.position.id} decision={d} onTap={() =>
                    setExpandedId(expandedId === d.enriched.position.id ? null : d.enriched.position.id)
                  } />
                ))}
              </div>
            </div>
          )}

          {/* ===== Section 3: All Positions ===== */}
          <div>
            <div className="flex items-center gap-2 mb-2 px-1">
              <Target className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">全部持仓</h2>
              <span className="text-[10px] text-muted-foreground">({decisions.length})</span>
            </div>

            {decisions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <LayoutDashboard className="h-10 w-10 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">暂无持仓数据</p>
                <p className="text-xs text-muted-foreground/60 mt-1">在持仓页面添加后这里会自动显示</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {decisions.map(d => (
                  <PositionRow
                    key={d.enriched.position.id}
                    decision={d}
                    isExpanded={expandedId === d.enriched.position.id}
                    onToggle={() =>
                      setExpandedId(expandedId === d.enriched.position.id ? null : d.enriched.position.id)
                    }
                    alerts={alerts}
                    getCostRecordsForPosition={getCostRecordsForPosition}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ===== Account-level alerts summary ===== */}
          {alerts.filter(a => !a.positionId).length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 px-1">
                <Shield className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">账户级提醒</h2>
              </div>
              <Card className="card-elevated">
                <CardContent className="p-3">
                  <div className="flex flex-col gap-2">
                    {alerts.filter(a => !a.positionId).map((a, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[a.level]}`} />
                        <span className={`text-xs ${STATUS_COLOR[a.level]}`}>{a.message}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

        </div>
      </main>
    </div>
  )
}

// ===== Sub-components =====

function PriorityCard({ decision: d, onTap }: { decision: PositionDecision; onTap: () => void }) {
  const pos = d.enriched.position
  return (
    <button
      onClick={onTap}
      className={`w-full text-left rounded-lg border p-3 transition-all active:scale-[0.98] ${STATUS_BG[d.status]}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[d.status]}`} />
          <span className="text-sm font-semibold text-foreground">{pos.ticker}</span>
          <span className="text-[10px] text-muted-foreground">{TYPE_LABEL[pos.type] || pos.type}</span>
          {pos.strikePrice > 0 && pos.type !== 'stock' && (
            <span className="text-[10px] text-muted-foreground">${pos.strikePrice}</span>
          )}
        </div>
        {d.monitor && (
          <span className={SIGNAL_LABEL[d.monitor.signal]?.class || 'badge-primary'}>
            {SIGNAL_LABEL[d.monitor.signal]?.text || d.monitor.signal}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-xs ${STATUS_COLOR[d.status]}`}>{d.reason}</span>
        <span className="text-xs text-muted-foreground">{d.action}</span>
      </div>
    </button>
  )
}

function PositionRow({
  decision: d,
  isExpanded,
  onToggle,
  alerts,
  getCostRecordsForPosition,
}: {
  decision: PositionDecision
  isExpanded: boolean
  onToggle: () => void
  alerts: Alert[]
  getCostRecordsForPosition: (id: string) => CostRecord[]
}) {
  const pos = d.enriched.position
  const greeks = d.enriched.greeks
  const contract = d.enriched.optionContract

  return (
    <Card className="card-elevated overflow-hidden">
      {/* Summary row */}
      <button
        onClick={onToggle}
        className="w-full text-left p-3 transition-colors hover:bg-secondary/30 active:bg-secondary/50"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`h-2 w-2 rounded-full shrink-0 ${STATUS_DOT[d.status]}`} />
            <span className="text-sm font-semibold text-foreground truncate">{pos.ticker}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              {TYPE_LABEL[pos.type] || pos.type}
            </span>
            {pos.strikePrice > 0 && pos.type !== 'stock' && (
              <span className="text-[10px] text-muted-foreground shrink-0">${pos.strikePrice}</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {d.pnlPercent !== null && (
              <span className={`text-xs font-medium ${d.pnlPercent >= 0 ? 'text-profit' : 'text-loss'}`}>
                {d.pnlPercent >= 0 ? '+' : ''}{d.pnlPercent.toFixed(1)}%
              </span>
            )}
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1">
          <span className={`text-[10px] ${STATUS_COLOR[d.status]}`}>{d.reason}</span>
          <span className="text-[10px] text-muted-foreground/60">|</span>
          <span className="text-[10px] text-muted-foreground">{d.action}</span>
          {d.dte !== null && d.dte > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground/60">|</span>
              <span className={`text-[10px] ${d.dte <= 7 ? 'text-warning' : 'text-muted-foreground'}`}>
                {d.dte}d
              </span>
            </>
          )}
        </div>
      </button>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div className="border-t px-3 py-3 bg-secondary/10 animate-slide-up">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {/* Price info */}
            <DetailItem label="现价" value={`$${pos.currentPrice.toFixed(2)}`} />
            {pos.type !== 'stock' && (
              <DetailItem label="行权价" value={`$${pos.strikePrice.toFixed(2)}`} />
            )}
            {pos.type === 'stock' && pos.costBasis && (
              <DetailItem label="成本价" value={`$${pos.costBasis.toFixed(2)}`} />
            )}
            <DetailItem
              label="数量"
              value={pos.type === 'stock' ? `${pos.quantity} 股` : `${pos.quantity} 合约`}
            />

            {/* Premium for options */}
            {pos.type !== 'stock' && (
              <>
                <DetailItem label="开仓权利金" value={`$${pos.premium.toFixed(2)}`} />
                <DetailItem
                  label="当前权利金"
                  value={pos.currentPremium !== undefined ? `$${pos.currentPremium.toFixed(2)}` : '--'}
                />
              </>
            )}

            {/* Distance for sell positions */}
            {d.distancePercent !== null && (pos.type === 'sell_put' || pos.type === 'sell_call') && (
              <DetailItem
                label="距行权价"
                value={`${d.distancePercent.toFixed(1)}%`}
                valueColor={d.distancePercent < 0 ? 'text-loss' : d.distancePercent < 5 ? 'text-warning' : 'text-profit'}
              />
            )}

            {/* DTE */}
            {d.dte !== null && d.dte > 0 && pos.expirationDate && (
              <DetailItem
                label="到期"
                value={`${formatDate(pos.expirationDate)} (${d.dte}d)`}
                valueColor={d.dte <= 7 ? 'text-warning' : undefined}
              />
            )}

            {/* Greeks */}
            {greeks && (
              <>
                <DetailItem label="Delta" value={greeks.delta.toFixed(3)} />
                <DetailItem
                  label="Theta"
                  value={`$${greeks.theta.toFixed(3)}/天`}
                  valueColor={greeks.theta >= 0 ? 'text-profit' : 'text-loss'}
                />
                {contract?.iv !== undefined && (
                  <DetailItem label="IV" value={`${(contract.iv * 100).toFixed(1)}%`} />
                )}
              </>
            )}

            {/* Market data from Yahoo */}
            {contract && (
              <>
                <DetailItem label="Bid / Ask" value={`$${contract.bid.toFixed(2)} / $${contract.ask.toFixed(2)}`} />
                <DetailItem label="成交量 / OI" value={`${contract.volume.toLocaleString()} / ${contract.oi.toLocaleString()}`} />
              </>
            )}

            {/* Margin for sell puts */}
            {pos.type === 'sell_put' && (
              <DetailItem
                label="保证金/合约"
                value={formatCurrency(calculateIBKRMargin(pos.currentPrice, pos.strikePrice, pos.premium) * 100)}
              />
            )}

            {/* Cost basis reduction */}
            {d.costBasisReduction > 0 && (
              <DetailItem
                label="已摊薄成本"
                value={formatCompactCurrency(d.costBasisReduction)}
                valueColor="text-profit"
              />
            )}

            {/* Expiry risk score for monitored positions */}
            {d.monitor && (
              <DetailItem
                label="到期风险分"
                value={`${d.monitor.expiryRiskScore}/100`}
                valueColor={d.monitor.expiryRiskScore > 60 ? 'text-loss' : d.monitor.expiryRiskScore > 30 ? 'text-warning' : 'text-profit'}
              />
            )}
          </div>

          {/* Position-specific alerts */}
          {(() => {
            const posAlerts = alerts.filter(a => a.positionId === pos.id)
            if (posAlerts.length === 0) return null
            return (
              <div className="mt-3 pt-2 border-t border-border/50">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">风控提醒</span>
                <div className="flex flex-col gap-1 mt-1">
                  {posAlerts.map((a, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <div className={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[a.level]}`} />
                      <span className={`text-[11px] ${STATUS_COLOR[a.level]}`}>{a.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Cost records for long positions */}
          {(pos.type === 'leap_call' || pos.type === 'stock') && (() => {
            const records = getCostRecordsForPosition(pos.id)
            if (records.length === 0) return null
            return (
              <div className="mt-3 pt-2 border-t border-border/50">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">成本摊薄记录</span>
                <div className="flex flex-col gap-1 mt-1">
                  {records.slice(-3).map(r => (
                    <div key={r.id} className="flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground truncate mr-2">{r.description}</span>
                      <span className="text-[11px] text-profit shrink-0">
                        +${(r.premiumCollected * r.quantity * 100).toFixed(0)}
                      </span>
                    </div>
                  ))}
                  {records.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">...还有 {records.length - 3} 条</span>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </Card>
  )
}

function DetailItem({
  label,
  value,
  valueColor,
}: {
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={`text-xs font-medium ${valueColor || 'text-foreground'}`}>{value}</span>
    </div>
  )
}
