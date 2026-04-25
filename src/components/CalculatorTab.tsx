import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { calculateAnnualizedReturn, formatPercent, formatCurrency } from '@/lib/calculations'
import type { CalculatorResult, Position } from '@/types'
import { Calculator, TrendingUp, Shield, Info, Search, PlusCircle } from 'lucide-react'
import { fetchSingleQuote, fetchStaticMarketData, getQuoteFromStaticData } from '@/lib/marketData'
import { showToast } from '@/components/ui/toast'

interface CalculatorTabProps {
  apiKey: string
  onCreatePosition?: (prefill: Partial<Position>) => void
}

export function CalculatorTab({ apiKey, onCreatePosition }: CalculatorTabProps) {
  const [ticker, setTicker] = useState('')
  const [strikePrice, setStrikePrice] = useState('')
  const [underlyingPrice, setUnderlyingPrice] = useState('')
  const [daysToExpiry, setDaysToExpiry] = useState('')
  const [premium, setPremium] = useState('')
  const [result, setResult] = useState<CalculatorResult | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [fetching, setFetching] = useState(false)

  const handleFetchPrice = async () => {
    if (!ticker.trim()) {
      showToast('请输入股票代码', 'error')
      return
    }
    setFetching(true)
    try {
      // Try static Yahoo data first (no API key needed)
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
      // Fallback to Twelve Data API
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

  const handleReset = () => {
    setTicker('')
    setStrikePrice('')
    setUnderlyingPrice('')
    setDaysToExpiry('')
    setPremium('')
    setResult(null)
  }

  const isValid = strikePrice && underlyingPrice && daysToExpiry && premium

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 px-1">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <Calculator className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">年化收益率计算器</h2>
          <p className="text-xs text-muted-foreground">Sell Put 年化收益率双口径计算</p>
        </div>
      </div>

      {/* Input Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-muted-foreground">输入参数</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/* Ticker query row */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">股票代码 (可选，自动填充现价)</label>
            <div className="flex gap-2">
              <input
                className="input-field flex-1"
                placeholder="如 AAPL"
                value={ticker}
                onChange={e => setTicker(e.target.value)}
              />
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
            <input
              type="number"
              className="input-field"
              placeholder="如 150.00"
              value={strikePrice}
              onChange={e => setStrikePrice(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">标的现价 (Underlying Price)</label>
            <input
              type="number"
              className="input-field"
              placeholder="如 155.00"
              value={underlyingPrice}
              onChange={e => setUnderlyingPrice(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">到期剩余天数 (DTE)</label>
            <input
              type="number"
              className="input-field"
              placeholder="如 30"
              value={daysToExpiry}
              onChange={e => setDaysToExpiry(e.target.value)}
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">权利金 (Premium / 每股)</label>
            <input
              type="number"
              className="input-field"
              placeholder="如 2.50"
              value={premium}
              onChange={e => setPremium(e.target.value)}
              inputMode="decimal"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              className="flex-1"
              onClick={handleCalculate}
              disabled={!isValid}
            >
              计算收益率
            </Button>
            <Button variant="outline" onClick={handleReset}>
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <div className="flex flex-col gap-3 animate-slide-up">
          {/* Metric 1: By Strike */}
          <Card className="border-primary/20 glow-primary">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">口径一：权利金 / 行权价</span>
                  </div>
                  <div className="stat-value text-primary">
                    {formatPercent(result.annualizedByStrike)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    单次收益率 {formatPercent(result.returnByStrike)}
                  </div>
                </div>
                <div className="badge-primary">年化</div>
              </div>
            </CardContent>
          </Card>

          {/* Metric 2: By Margin */}
          <Card className="border-profit/20 glow-profit">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-profit" />
                    <span className="text-xs text-muted-foreground">口径二：权利金 / IBKR保证金</span>
                  </div>
                  <div className="stat-value text-profit">
                    {formatPercent(result.annualizedByMargin)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    单次收益率 {formatPercent(result.returnByMargin)}
                  </div>
                </div>
                <div className="badge-profit">年化</div>
              </div>
            </CardContent>
          </Card>

          {/* Margin Detail */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">IBKR 保证金占用 (每股)</span>
                <span className="text-sm font-semibold text-foreground">
                  {formatCurrency(result.marginRequired)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm text-muted-foreground">每手保证金 (×100)</span>
                <span className="text-sm font-semibold text-foreground">
                  {formatCurrency(result.marginRequired * 100)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Info Section */}
          <button
            className="flex items-center gap-2 px-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowInfo(!showInfo)}
          >
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

          {/* Create position from calculator */}
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
              }}
            >
              <PlusCircle className="h-4 w-4 mr-1.5" />
              确认建仓 Sell Put
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
