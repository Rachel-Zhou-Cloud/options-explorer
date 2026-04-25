import { useState, useEffect, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import type { Position } from '@/types'
import {
  Shield, ChevronDown, ChevronUp, AlertTriangle, AlertCircle,
  CheckCircle, DollarSign, TrendingDown, Activity,
} from 'lucide-react'
import { fetchStaticMarketData } from '@/lib/marketData'
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
  type AlertLevel,
  type StatusLevel,
  type Alert,
} from '@/lib/riskCalculations'
import type { StaticMarketData } from '@/types'

interface RiskControlTabProps {
  positions: Position[]
  cashBalance: number
  onSetCashBalance: (value: number) => void
  apiKey: string
}

const STATUS_COLORS: Record<StatusLevel, string> = {
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

const ALERT_ICONS: Record<AlertLevel, typeof AlertTriangle> = {
  red: AlertTriangle,
  yellow: AlertCircle,
  green: CheckCircle,
}

const ALERT_COLORS: Record<AlertLevel, string> = {
  red: 'text-loss bg-loss/10 border-loss/20',
  yellow: 'text-warning bg-warning/10 border-warning/20',
  green: 'text-profit bg-profit/10 border-profit/20',
}

function StatusDot({ status }: { status: StatusLevel }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
}

export function RiskControlTab({ positions, cashBalance, onSetCashBalance }: RiskControlTabProps) {
  const [marketData, setMarketData] = useState<StaticMarketData | null>(null)
  const [stressDropPercent, setStressDropPercent] = useState(20)
  const [cashInput, setCashInput] = useState(cashBalance > 0 ? cashBalance.toString() : '')
  const [editingCash, setEditingCash] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    account: true,
    sellput: false,
    greeks: false,
    monitoring: false,
  })

  useEffect(() => {
    fetchStaticMarketData().then(setMarketData)
  }, [])

  useEffect(() => {
    if (!editingCash) {
      setCashInput(cashBalance > 0 ? cashBalance.toString() : '')
    }
  }, [cashBalance, editingCash])

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

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleSaveCash = () => {
    const val = parseFloat(cashInput)
    if (!isNaN(val) && val >= 0) {
      onSetCashBalance(val)
    }
    setEditingCash(false)
  }

  // Status computations for hero metrics
  const exposureStatus = statusHigherWorse(
    sellPutRisk.exposureRate,
    THRESHOLDS.totalExposure.target,
    THRESHOLDS.totalExposure.warning,
  )
  const safetyStatus = stressTest.assignmentObligation > 0
    ? statusLowerBetter(stressTest.safetyRatio, THRESHOLDS.safetyRatio.healthy, THRESHOLDS.safetyRatio.critical)
    : 'green' as StatusLevel
  const thetaStatus = statusInRange(
    greeks.netTheta,
    THRESHOLDS.netTheta.idealLow,
    THRESHOLDS.netTheta.idealHigh,
    THRESHOLDS.netTheta.criticalNeg,
  )
  const vegaStatus = greeks.netVega < THRESHOLDS.netVega.warning ? 'red' as StatusLevel
    : greeks.netVega < THRESHOLDS.netVega.warning * 0.8 ? 'yellow' as StatusLevel
    : 'green' as StatusLevel

  if (positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 animate-fade-in">
        <Shield className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">暂无持仓，请先在持仓页面添加持仓</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">风控中心</h2>
          <p className="text-xs text-muted-foreground">账户风险综合监控</p>
        </div>
      </div>

      {/* Hero Metrics Card */}
      <Card className="border-primary/20">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <HeroMetric
              label="有效敞口率"
              value={`${(sellPutRisk.exposureRate * 100).toFixed(1)}%`}
              status={exposureStatus}
            />
            <HeroMetric
              label="Safety Ratio"
              value={stressTest.assignmentObligation > 0 ? stressTest.safetyRatio.toFixed(2) : 'N/A'}
              status={safetyStatus}
              sublabel={`跌${stressDropPercent}%`}
            />
            <HeroMetric
              label="净Theta/日"
              value={`${greeks.netTheta >= 0 ? '+' : ''}$${greeks.netTheta.toFixed(0)}`}
              status={thetaStatus}
            />
            <HeroMetric
              label="净Vega"
              value={`$${greeks.netVega.toFixed(0)}`}
              status={vegaStatus}
              sublabel="/VIX点"
            />
          </div>
        </CardContent>
      </Card>

      {/* System Alerts */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {alerts.slice(0, 8).map((alert, i) => (
            <AlertRow key={i} alert={alert} />
          ))}
          {alerts.length > 8 && (
            <p className="text-[10px] text-muted-foreground text-center">
              +{alerts.length - 8} 条更多警报
            </p>
          )}
        </div>
      )}

      {/* Account Level */}
      <CollapsibleSection
        title="账户总览"
        icon={DollarSign}
        expanded={expandedSections.account}
        onToggle={() => toggleSection('account')}
      >
        {/* Cash input */}
        <div className="mb-3">
          <label className="text-[10px] text-muted-foreground mb-1 block">现金余额</label>
          <div className="flex gap-2">
            <input
              type="number"
              className="input-field flex-1 text-sm"
              placeholder="输入现金余额"
              value={cashInput}
              onChange={e => { setCashInput(e.target.value); setEditingCash(true) }}
              onKeyDown={e => e.key === 'Enter' && handleSaveCash()}
              inputMode="decimal"
            />
            <button
              onClick={handleSaveCash}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              保存
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <MetricBox
            label="NAV"
            value={formatCompactCurrency(account.nav)}
            status={account.nav > 0 ? 'green' : 'red'}
          />
          <MetricBox
            label="现金比例"
            value={`${(account.cashRatio * 100).toFixed(0)}%`}
            status={statusLowerBetter(account.cashRatio, THRESHOLDS.cashRatio.healthy, THRESHOLDS.cashRatio.warning)}
          />
          <MetricBox
            label="BPR占用"
            value={`${(account.bprUtilization * 100).toFixed(0)}%`}
            status={statusHigherWorse(account.bprUtilization, THRESHOLDS.bprUtilization.healthy, THRESHOLDS.bprUtilization.warning)}
          />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">正股市值</span>
            <span className="text-foreground">{formatCompactCurrency(account.stockMarketValue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">期权市值</span>
            <span className="text-foreground">{formatCompactCurrency(account.optionsMarketValue)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">保证金占用</span>
            <span className="text-foreground">{formatCompactCurrency(account.totalSellPutMargin)}</span>
          </div>
        </div>
      </CollapsibleSection>

      {/* Sell Put Risk + Stress Test */}
      <CollapsibleSection
        title="Sell Put 风险"
        icon={TrendingDown}
        expanded={expandedSections.sellput}
        onToggle={() => toggleSection('sellput')}
        badge={sellPutRisk.positions.length > 0 ? `${sellPutRisk.positions.length}笔` : undefined}
      >
        {sellPutRisk.positions.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无 Sell Put 持仓</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-center mb-3">
              <MetricBox
                label="名义敞口/NAV"
                value={`${(sellPutRisk.notionalRatio * 100).toFixed(0)}%`}
                status={statusHigherWorse(sellPutRisk.notionalRatio, THRESHOLDS.notionalRatio.healthy, THRESHOLDS.notionalRatio.warning)}
              />
              <MetricBox
                label="有效敞口/NAV"
                value={`${(sellPutRisk.exposureRate * 100).toFixed(0)}%`}
                status={exposureStatus}
              />
            </div>

            {/* Per-position concentration */}
            <div className="space-y-1.5 mb-3">
              {sellPutRisk.positions.map(p => (
                <div key={p.positionId} className="flex items-center justify-between text-xs">
                  <span className="text-foreground font-medium">{p.ticker} {p.strikePrice}P x{p.quantity}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground">{formatCompactCurrency(p.notional)}</span>
                    <span className={STATUS_COLORS[
                      p.exposurePercent > THRESHOLDS.singleExposure.warning * 100 ? 'red'
                      : p.exposurePercent > THRESHOLDS.singleExposure.target * 100 ? 'yellow'
                      : 'green'
                    ]}>
                      {p.exposurePercent.toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {/* Stress Test */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-foreground">压力测试</span>
                <span className="text-xs font-bold text-foreground">跌幅 {stressDropPercent}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                step={5}
                value={stressDropPercent}
                onChange={e => setStressDropPercent(parseInt(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none bg-secondary cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                  [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5 mb-2">
                <span>10%</span><span>30%</span><span>50%</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground">可调动资金</div>
                  <div className="font-semibold text-foreground">{formatCompactCurrency(stressTest.availableFunds)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    现金 {formatCompactCurrency(cashBalance)} + 残值 {formatCompactCurrency(stressTest.stockResidual + stressTest.leapResidual)}
                  </div>
                </div>
                <div className="rounded-lg bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground">行权义务</div>
                  <div className="font-semibold text-foreground">{formatCompactCurrency(stressTest.assignmentObligation)}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">全部行权所需</div>
                </div>
              </div>

              <div className={`mt-2 rounded-lg p-3 text-center ${STATUS_BG[safetyStatus]}`}>
                <div className="text-[10px] text-muted-foreground">Safety Ratio</div>
                <div className={`text-2xl font-bold ${STATUS_COLORS[safetyStatus]}`}>
                  {stressTest.assignmentObligation > 0 ? stressTest.safetyRatio.toFixed(2) : '∞'}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {safetyStatus === 'green' ? '覆盖充足' : safetyStatus === 'yellow' ? '需要关注' : '严重不足'}
                </div>
              </div>
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* Portfolio Greeks */}
      <CollapsibleSection
        title="组合 Greeks"
        icon={Activity}
        expanded={expandedSections.greeks}
        onToggle={() => toggleSection('greeks')}
      >
        <div className="grid grid-cols-2 gap-2 text-center mb-2">
          <MetricBox
            label="Net Delta"
            value={greeks.netDelta.toFixed(0)}
            sublabel={`$Delta ${formatCompactCurrency(greeks.dollarDelta)}`}
            status={account.nav > 0
              ? statusInRange(Math.abs(greeks.dollarDelta) / account.nav, THRESHOLDS.dollarDeltaPct.low, THRESHOLDS.dollarDeltaPct.warning)
              : 'yellow'}
          />
          <MetricBox
            label="Net Theta/日"
            value={`${greeks.netTheta >= 0 ? '+' : ''}$${greeks.netTheta.toFixed(1)}`}
            status={thetaStatus}
          />
          <MetricBox
            label="Net Vega/VIX点"
            value={`$${greeks.netVega.toFixed(0)}`}
            status={vegaStatus}
          />
          <MetricBox
            label="Net Gamma"
            value={greeks.netGamma.toFixed(1)}
            status={greeks.netGamma < 0 ? 'yellow' : 'green'}
          />
        </div>
        {account.nav > 0 && (
          <div className="text-[10px] text-muted-foreground text-center">
            Dollar Delta 占 NAV {((Math.abs(greeks.dollarDelta) / account.nav) * 100).toFixed(0)}%
            {' '}|{' '}
            市场涨1%约 {greeks.dollarDelta >= 0 ? '+' : ''}{formatCompactCurrency(greeks.dollarDelta * 0.01)}
          </div>
        )}
      </CollapsibleSection>

      {/* Position Monitoring */}
      <CollapsibleSection
        title="持仓监控"
        icon={AlertTriangle}
        expanded={expandedSections.monitoring}
        onToggle={() => toggleSection('monitoring')}
        badge={monitoring.length > 0 ? `${monitoring.length}笔` : undefined}
      >
        {monitoring.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无卖方持仓需要监控</p>
        ) : (
          <div className="space-y-2">
            {monitoring.map(m => (
              <div key={m.positionId} className="rounded-lg bg-secondary/30 p-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-foreground">
                    {m.ticker} {m.strikePrice}{m.type === 'sell_put' ? 'P' : 'C'} x{m.quantity}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    m.signal === 'take_profit' ? 'badge-profit' :
                    m.signal === 'stop_loss' ? 'badge-loss' : 'bg-secondary text-secondary-foreground'
                  }`}>
                    {m.signal === 'take_profit' ? '止盈' : m.signal === 'stop_loss' ? '止损' : '持有'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        m.pnlProgress >= 50 ? 'bg-profit' :
                        m.pnlProgress < -50 ? 'bg-loss' : 'bg-primary'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, m.pnlProgress))}%` }}
                    />
                  </div>
                  <span className={`text-[10px] font-medium min-w-[36px] text-right ${
                    m.pnlProgress >= 50 ? 'text-profit' :
                    m.pnlProgress < -50 ? 'text-loss' : 'text-foreground'
                  }`}>
                    {m.pnlProgress.toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>距行权价 {m.distancePercent.toFixed(1)}%</span>
                  <span>{m.dte}天到期</span>
                  <span>风险 {m.expiryRiskScore}/100</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}

// ===== Sub-components =====

function HeroMetric({ label, value, status, sublabel }: {
  label: string; value: string; status: StatusLevel; sublabel?: string
}) {
  return (
    <div className={`rounded-lg p-2.5 ${STATUS_BG[status]}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <StatusDot status={status} />
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <div className={`text-lg font-bold ${STATUS_COLORS[status]}`}>
        {value}
        {sublabel && <span className="text-[10px] font-normal text-muted-foreground ml-1">{sublabel}</span>}
      </div>
    </div>
  )
}

function MetricBox({ label, value, status, sublabel }: {
  label: string; value: string; status: StatusLevel; sublabel?: string
}) {
  return (
    <div className="rounded-lg bg-secondary/50 p-2">
      <div className="text-[10px] text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${STATUS_COLORS[status]}`}>{value}</div>
      {sublabel && <div className="text-[10px] text-muted-foreground">{sublabel}</div>}
    </div>
  )
}

function AlertRow({ alert }: { alert: Alert }) {
  const Icon = ALERT_ICONS[alert.level]
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${ALERT_COLORS[alert.level]}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>{alert.message}</span>
    </div>
  )
}

function CollapsibleSection({ title, icon: Icon, expanded, onToggle, children, badge }: {
  title: string
  icon: typeof Shield
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
  badge?: string
}) {
  return (
    <Card>
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        onClick={onToggle}
      >
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1">{title}</span>
        {badge && <span className="text-[10px] text-muted-foreground">{badge}</span>}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {expanded && (
        <CardContent className="px-4 pb-4 pt-0 animate-fade-in">
          {children}
        </CardContent>
      )}
    </Card>
  )
}
