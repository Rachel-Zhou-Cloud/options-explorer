import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { calculateAnnualizedReturn, formatPercent, formatCurrency } from '@/lib/calculations'
import type { CalculatorResult, Position } from '@/types'
import { Calculator, TrendingUp, Shield, Info, Search, PlusCircle, RefreshCw } from 'lucide-react'
import { fetchSingleQuote, fetchStaticMarketData, getQuoteFromStaticData } from '@/lib/marketData'
import { showToast } from '@/components/ui/toast'

/** 从 PositionCard 跳转时带过来的 Roll 上下文 */
export interface RollContext {
  positionId: string
  ticker: string
  oldStrike: number
  oldExpirationDate: string
  oldPremium: number
  currentPremium: number
  currentPrice: number
  quantity: number
}

export interface CalculatorPrefill {
  ticker?: string
  strikePrice?: number
  underlyingPrice?: number
  daysToExpiry?: number
  premium?: number
  /** 仅 Roll 模式：原仓上下文 */
  rollFrom?: RollContext
}

interface CalculatorTabProps {
  apiKey: string
  onCreatePosition?: (prefill: Partial<Position>) => void
  prefill?: CalculatorPrefill | null
  onClearPrefill?: () => void
}

export function CalculatorTab({ apiKey, onCreatePosition, prefill, onClearPrefill }: CalculatorTabProps) {
  // ---- 普通模式 ----
  const [ticker, setTicker] = useState('')
  const [strikePrice, setStrikePrice] = useState('')
  const [underlyingPrice, setUnderlyingPrice] = useState('')
  const [daysToExpiry, setDaysToExpiry] = useState('')
  const [premium, setPremium] = useState('')
  const [result, setResult] = useState<CalculatorResult | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [fetching, setFetching] = useState(false)

  // ---- Roll 模式额外字段 ----
  const [rollMode, setRollMode] = useState(false)
  const [rollContext, setRollContext] = useState<RollContext | null>(null)
  const [newStrike, setNewStrike] = useState('')
  const [newExpDate, setNewExpDate] = useState('')
  const [newPremium, setNewPremium] = useState('')

  // ---- Roll 模式计算结果 ----
  const [rollResult, setRollResult] = useState<{
    oldAnnualized: CalculatorResult
    newAnnualized: CalculatorResult
    rollCostPerShare: number
    rollTotal: number
    isCredit: boolean
  } | null>(null)

  // ===== 处理 prefill（普通 or Roll） =====
  useEffect(() => {
    if (!prefill) return
    if (prefill.rollFrom) {
      // --- 进入 Roll 分析模式 ---
      const ctx = prefill.rollFrom
      setRollMode(true)
      setRollContext(ctx)
      // 锁定原仓参数
      setTicker(ctx.ticker)
      setUnderlyingPrice(ctx.currentPrice.toString())
      // 新仓默认值 = 原仓值（用户可覆盖）
      setNewStrike(ctx.oldStrike.toString())
      setNewExpDate('')
      setNewPremium(ctx.oldPremium.toFixed(2))
      setResult(null)
      setRollResult(null)
    } else {
      // --- 普通模式 ---
      setRollMode(false)
      setRollContext(null)
      if (prefill.ticker) setTicker(prefill.ticker)
      if (prefill.strikePrice !== undefined) setStrikePrice(prefill.strikePrice.toString())
      if (prefill.underlyingPrice !== undefined) setUnderlyingPrice(prefill.underlyingPrice.toString())
      if (prefill.daysToExpiry !== undefined) setDaysToExpiry(prefill.daysToExpiry.toString())
      if (prefill.premium !== undefined) setPremium(prefill.premium.toString())
      setResult(null)
    }
    onClearPrefill?.()
  }, [prefill, onClearPrefill])

  const handleFetchPrice = async () => {
    if (!ticker.trim()) {
      showToast('请输入股票代码', 'error')
      return
    }
    setFetching(true)
    try {
      const staticData = await fetchStaticMarketData()
      if (staticData) {
        const quote = getQuoteFromStaticData(ticker.trim(), staticData)
        if (quote) {
          setUnderlyingPrice(quote.price.toFixed(2))
          showToast(`${ticker.toUpperCase()} $${quote.price.toFixed(2)} (Yahoo)`, 'success')
          setFetching(false)
          return
        }
      }
      if (!apiKey) {
        showToast('该股票不在监控列表中，需要 API Key 查询', 'error')
        setFetching(false)
        return
      }
      const quote = await fetchSingleQuote(ticker.trim(), apiKey)
      if (quote) {
        setUnderlyingPrice(quote.price.toFixed(2))
        showToast(`${ticker.toUpperCase()} $${quote.price.toFixed(2)} (API)`, 'success')
      } else {
        showToast('未找到该股票', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '查询失败', 'error')
    } finally {
      setFetching(false)
    }
  }

  // ===== 普通模式计算 =====
  const handleCalculate = () => {
    const s = parseFloat(strikePrice)
    const u = parseFloat(underlyingPrice)
    const d = parseInt(daysToExpiry)
    const p = parseFloat(premium)

    if (isNaN(s) || isNaN(u) || isNaN(d) || isNaN(p) || s <= 0 || u <= 0 || d <= 0 || p <= 0) {
      return
    }

    const res = calculateAnnualizedReturn({
      strikePrice: s,
      underlyingPrice: u,
      daysToExpiry: d,
      premium: p,
    })
    setResult(res)
  }

  // ===== Roll 模式计算 =====
  const handleRollCalculate = () => {
    if (!rollContext) return
    const ns = parseFloat(newStrike)
    const nd = newExpDate
      ? Math.ceil((new Date(newExpDate).getTime() - Date.now()) / 86400000)
      : NaN
    const np = parseFloat(newPremium)
    const u = parseFloat(underlyingPrice)

    if (isNaN(ns) || ns <= 0 || isNaN(nd) || nd <= 0 || isNaN(np) || np < 0 || isNaN(u) || u <= 0) return

    // 原仓年化
    const oldDTE = rollContext.oldExpirationDate
      ? Math.max(1, Math.ceil((new Date(rollContext.oldExpirationDate).getTime() - Date.now()) / 86400000))
      : 1
    const oldAnnualized = calculateAnnualizedReturn({
      strikePrice: rollContext.oldStrike,
      underlyingPrice: u,
      daysToExpiry: oldDTE,
      premium: rollContext.oldPremium,
    })

    // 新仓年化
    const newAnnualized = calculateAnnualizedReturn({
      strikePrice: ns,
      underlyingPrice: u,
      daysToExpiry: nd,
      premium: np,
    })

    // Roll 成本：收新权利金 - 回购旧权利金（每股）
    const rollCostPerShare = np - rollContext.currentPremium
    // 正数 = 净收入 (credit), 负数 = 净支出 (debit)
    const rollTotal = rollCostPerShare * rollContext.quantity * 100

    setRollResult({
      oldAnnualized,
      newAnnualized,
      rollCostPerShare,
      rollTotal,
      isCredit: rollCostPerShare >= 0,
    })
  }

  const handleReset = () => {
    setTicker('')
    setStrikePrice('')
    setUnderlyingPrice('')
    setDaysToExpiry('')
    setPremium('')
    setResult(null)
    setRollMode(false)
    setRollContext(null)
    setNewStrike('')
    setNewExpDate('')
    setNewPremium('')
    setRollResult(null)
  }

  const isValid = strikePrice && underlyingPrice && daysToExpiry && premium
  const rollValid = rollContext && newStrike && newExpDate && newPremium && underlyingPrice

  // 从 rollContext 推导原仓描述
  const oldDescription = rollContext
    ? `${rollContext.ticker} $${rollContext.oldStrike}P · ${new Date(rollContext.oldExpirationDate).toLocaleDateString('zh-CN')}`
    : ''

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${rollMode ? 'bg-orange-500/10' : 'bg-primary/10'}`}>
          {rollMode
            ? <RefreshCw className="h-5 w-5 text-orange-400" />
            : <Calculator className="h-5 w-5 text-primary" />}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {rollMode ? 'Roll 分析' : '年化收益率计算器'}
          </h2>
          <p className="text-xs text-muted-foreground">
            {rollMode ? '到期前展期对比计算' : 'Sell Put 年化收益率双口径计算'}
          </p>
        </div>
        {rollMode && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-xs"
            onClick={() => {
              setRollMode(false)
              setRollContext(null)
              setRollResult(null)
              setStrikePrice(newStrike)
              setDaysToExpiry(newExpDate ? Math.ceil((new Date(newExpDate).getTime() - Date.now()) / 86400000).toString() : '')
              setPremium(newPremium)
            }}
          >
            切换到普通模式
          </Button>
        )}
      </div>

      {/* ============ Roll 模式 ============ */}
      {rollMode && rollContext && (
        <>
          {/* 原仓只读摘要 */}
          <Card className="border-muted">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">原仓</div>
                <span className="text-xs font-medium text-foreground">{oldDescription}</span>
              </div>
              <div className="grid grid-cols-4 gap-x-3 gap-y-1 text-xs">
                <div>
                  <span className="text-muted-foreground">权利金</span>
                  <div className="font-medium text-foreground">{formatCurrency(rollContext.oldPremium)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">当前市价</span>
                  <div className="font-medium text-foreground">{formatCurrency(rollContext.currentPremium)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">标的现价</span>
                  <div className="font-medium text-foreground">{formatCurrency(rollContext.currentPrice)}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">数量</span>
                  <div className="font-medium text-foreground">×{rollContext.quantity}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 新仓参数输入 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">
                <div className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-400 inline-block mb-1">新仓</div>
                <span className="block">展期目标参数</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* 标的现价 (共用) */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">标的现价</label>
                <div className="flex gap-2">
                  <input type="number" className="input-field flex-1" value={underlyingPrice}
                    onChange={e => setUnderlyingPrice(e.target.value)} inputMode="decimal" />
                  <button
                    onClick={handleFetchPrice}
                    disabled={fetching || !ticker.trim()}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
                  >
                    <Search className={`h-3.5 w-3.5 ${fetching ? 'animate-pulse' : ''}`} />
                    {fetching ? '查询中' : '查询'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">新行权价</label>
                <input type="number" className="input-field" placeholder={`原行权价 $${rollContext.oldStrike}`}
                  value={newStrike} onChange={e => setNewStrike(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">新到期日</label>
                <input type="date" className="input-field" value={newExpDate}
                  onChange={e => setNewExpDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">预估新权利金 (每股)</label>
                <input type="number" className="input-field" placeholder={`原权利金 $${rollContext.oldPremium.toFixed(2)}`}
                  value={newPremium} onChange={e => setNewPremium(e.target.value)} inputMode="decimal" />
              </div>

              <div className="flex gap-3 pt-1">
                <Button className="flex-1" onClick={handleRollCalculate} disabled={!rollValid}>
                  计算 Roll
                </Button>
                <Button variant="outline" onClick={handleReset}>重置</Button>
              </div>
            </CardContent>
          </Card>

          {/* Roll 结果 */}
          {rollResult && (
            <div className="flex flex-col gap-3 animate-slide-up">
              {/* Roll 成本 */}
              <Card className={rollResult.isCredit ? 'border-profit/30' : 'border-loss/30'}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Roll 净收支</div>
                      <div className={`text-lg font-bold ${rollResult.isCredit ? 'text-profit' : 'text-loss'}`}>
                        {rollResult.isCredit ? '+' : '-'}{formatCurrency(Math.abs(rollResult.rollTotal))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        每股 {rollResult.isCredit ? '收入' : '支出'} {formatCurrency(Math.abs(rollResult.rollCostPerShare))}
                      </div>
                    </div>
                    <div className={`rounded-full px-3 py-1 text-xs font-bold ${rollResult.isCredit ? 'bg-profit/15 text-profit' : 'bg-loss/15 text-loss'}`}>
                      {rollResult.isCredit ? 'CREDIT' : 'DEBIT'}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* 对比：保证金口径 */}
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-3">年化收益率对比 — 保证金口径</div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">原仓 (权利金/保证金)</div>
                      <div className="text-base font-bold text-primary">
                        {formatPercent(rollResult.oldAnnualized.annualizedByMargin)}
                      </div>
                    </div>
                    <div className="flex items-center justify-center text-muted-foreground text-lg">→</div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">新仓 (权利金/保证金)</div>
                      <div className={`text-base font-bold ${rollResult.newAnnualized.annualizedByMargin >= rollResult.oldAnnualized.annualizedByMargin ? 'text-profit' : 'text-loss'}`}>
                        {formatPercent(rollResult.newAnnualized.annualizedByMargin)}
                      </div>
                    </div>
                  </div>
                  <TableRow
                    oldLabel={`权利金 ${formatCurrency(rollResult.oldAnnualized.marginRequired)} → ${formatPercent(rollResult.oldAnnualized.returnByMargin)} 单次`}
                    newLabel={`权利金 ${formatCurrency(rollResult.newAnnualized.marginRequired)} → ${formatPercent(rollResult.newAnnualized.returnByMargin)} 单次`}
                    improved={rollResult.newAnnualized.annualizedByMargin >= rollResult.oldAnnualized.annualizedByMargin}
                  />
                </CardContent>
              </Card>

              {/* 对比：接股口径 */}
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground mb-3">年化收益率对比 — 接股口径</div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">原仓 (权利金/行权价)</div>
                      <div className="text-base font-bold text-primary">
                        {formatPercent(rollResult.oldAnnualized.annualizedByStrike)}
                      </div>
                    </div>
                    <div className="flex items-center justify-center text-muted-foreground text-lg">→</div>
                    <div>
                      <div className="text-[10px] text-muted-foreground mb-0.5">新仓 (权利金/行权价)</div>
                      <div className={`text-base font-bold ${rollResult.newAnnualized.annualizedByStrike >= rollResult.oldAnnualized.annualizedByStrike ? 'text-profit' : 'text-loss'}`}>
                        {formatPercent(rollResult.newAnnualized.annualizedByStrike)}
                      </div>
                    </div>
                  </div>
                  <TableRow
                    oldLabel={`权利金 ${formatCurrency(rollContext.oldPremium)} / 行权价 $${rollContext.oldStrike} → ${formatPercent(rollResult.oldAnnualized.returnByStrike)} 单次`}
                    newLabel={`权利金 ${formatCurrency(parseFloat(newPremium) || 0)} / 行权价 $${parseFloat(newStrike) || 0} → ${formatPercent(rollResult.newAnnualized.returnByStrike)} 单次`}
                    improved={rollResult.newAnnualized.annualizedByStrike >= rollResult.oldAnnualized.annualizedByStrike}
                  />
                </CardContent>
              </Card>

              {/* 保证金详情 */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">新仓 IBKR 保证金 (每股)</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(rollResult.newAnnualized.marginRequired)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-muted-foreground">新仓每手保证金 (×100)</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(rollResult.newAnnualized.marginRequired * 100)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-muted-foreground">总保证金占用 (×{rollContext.quantity})</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(rollResult.newAnnualized.marginRequired * 100 * rollContext.quantity)}</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* ============ 普通模式 (仅非 Roll 模式显示) ============ */}
      {!rollMode && (
        <>
          {/* Input Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-muted-foreground">输入参数</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">股票代码 (可选，自动填充现价)</label>
                <div className="flex gap-2">
                  <input className="input-field flex-1" placeholder="如 AAPL" value={ticker}
                    onChange={e => setTicker(e.target.value)} />
                  <button
                    onClick={handleFetchPrice}
                    disabled={fetching || !ticker.trim()}
                    className="flex items-center gap-1 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
                  >
                    <Search className={`h-3.5 w-3.5 ${fetching ? 'animate-pulse' : ''}`} />
                    {fetching ? '查询中' : '查询'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">行权价 (Strike Price)</label>
                <input type="number" className="input-field" placeholder="如 150.00" value={strikePrice}
                  onChange={e => setStrikePrice(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">标的现价 (Underlying Price)</label>
                <input type="number" className="input-field" placeholder="如 155.00" value={underlyingPrice}
                  onChange={e => setUnderlyingPrice(e.target.value)} inputMode="decimal" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">到期剩余天数 (DTE)</label>
                <input type="number" className="input-field" placeholder="如 30" value={daysToExpiry}
                  onChange={e => setDaysToExpiry(e.target.value)} inputMode="numeric" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">权利金 (Premium / 每股)</label>
                <input type="number" className="input-field" placeholder="如 2.50" value={premium}
                  onChange={e => setPremium(e.target.value)} inputMode="decimal" />
              </div>

              <div className="flex gap-3 pt-1">
                <Button className="flex-1" onClick={handleCalculate} disabled={!isValid}>
                  计算收益率
                </Button>
                <Button variant="outline" onClick={handleReset}>重置</Button>
              </div>
            </CardContent>
          </Card>

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-3 animate-slide-up">
              <Card className="border-primary/20 glow-primary">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">口径一：权利金 / 行权价</span>
                      </div>
                      <div className="stat-value text-primary">{formatPercent(result.annualizedByStrike)}</div>
                      <div className="text-xs text-muted-foreground mt-1">单次收益率 {formatPercent(result.returnByStrike)}</div>
                    </div>
                    <div className="badge-primary">年化</div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-profit/20 glow-profit">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="h-4 w-4 text-profit" />
                        <span className="text-xs text-muted-foreground">口径二：权利金 / IBKR保证金</span>
                      </div>
                      <div className="stat-value text-profit">{formatPercent(result.annualizedByMargin)}</div>
                      <div className="text-xs text-muted-foreground mt-1">单次收益率 {formatPercent(result.returnByMargin)}</div>
                    </div>
                    <div className="badge-profit">年化</div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">IBKR 保证金占用 (每股)</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(result.marginRequired)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-muted-foreground">每手保证金 (×100)</span>
                    <span className="text-sm font-semibold text-foreground">{formatCurrency(result.marginRequired * 100)}</span>
                  </div>
                </CardContent>
              </Card>

              <button
                className="flex items-center gap-2 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowInfo(!showInfo)}>
                <Info className="h-3.5 w-3.5" />
                {showInfo ? '收起' : '查看'} IBKR 保证金计算规则
              </button>

              {showInfo && (
                <Card className="animate-fade-in">
                  <CardContent className="p-4 text-xs text-muted-foreground leading-relaxed">
                    <p className="font-medium text-foreground mb-2">IBKR Reg T 裸卖看跌期权保证金：</p>
                    <p className="mb-1">取以下两者的较大值：</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>25% × 标的现价 - 虚值金额 + 权利金</li>
                      <li>10% × 行权价 + 权利金</li>
                    </ul>
                    <p className="mt-2">虚值金额 (OTM) = max(0, 标的现价 - 行权价)</p>
                    <p className="mt-1">最低每股 $2.50</p>
                  </CardContent>
                </Card>
              )}

              {onCreatePosition && (
                <Button
                  variant="outline"
                  className="w-full border-profit/30 text-profit hover:bg-profit/10"
                  onClick={() => {
                    const d = parseInt(daysToExpiry)
                    const expDate = !isNaN(d) && d > 0
                      ? new Date(Date.now() + d * 86400000).toISOString().slice(0, 10)
                      : undefined
                    onCreatePosition({
                      type: 'sell_put',
                      ticker: ticker.toUpperCase() || undefined,
                      strikePrice: parseFloat(strikePrice) || 0,
                      currentPrice: parseFloat(underlyingPrice) || 0,
                      premium: parseFloat(premium) || 0,
                      expirationDate: expDate,
                    })
                  }}>
                  <PlusCircle className="h-4 w-4 mr-1.5" />
                  确认建仓 Sell Put
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 小对比行 */
function TableRow({ oldLabel, newLabel, improved }: { oldLabel: string; newLabel: string; improved: boolean }) {
  return (
    <div className="mt-2.5 pt-2.5 border-t border-dashed text-[10px] text-muted-foreground grid grid-cols-2 gap-x-3">
      <div>{oldLabel}</div>
      <div className={improved ? 'text-profit' : 'text-muted-foreground'}>{newLabel}</div>
    </div>
  )
}
