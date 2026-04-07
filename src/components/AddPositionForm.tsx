import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { Position, PositionType } from '@/types'
import { showToast } from '@/components/ui/toast'
import { X, Search } from 'lucide-react'
import { fetchSingleQuote } from '@/lib/marketData'

interface AddPositionFormProps {
  onAdd: (pos: Omit<Position, 'id' | 'isClosed'>) => void
  onCancel: () => void
  apiKey: string
  positions: Position[]
  prefill?: Partial<Position> | null
}

const TYPE_CONFIG: { type: PositionType; label: string; short: string }[] = [
  { type: 'sell_put', label: 'Sell Put', short: 'SP' },
  { type: 'sell_call', label: 'Sell Call', short: 'SC' },
  { type: 'leap_call', label: 'LEAP Call', short: 'LC' },
  { type: 'stock', label: 'Stock', short: 'STK' },
  { type: 'buy_call', label: 'Buy Call', short: 'BC' },
  { type: 'buy_put', label: 'Buy Put', short: 'BP' },
  { type: 'custom', label: '其他', short: '...' },
]

const isSellType = (t: PositionType) => t === 'sell_put' || t === 'sell_call'
const isOptionType = (t: PositionType) => t !== 'stock'

export function AddPositionForm({ onAdd, onCancel, apiKey, positions, prefill }: AddPositionFormProps) {
  const [type, setType] = useState<PositionType>(prefill?.type || 'sell_put')
  const [ticker, setTicker] = useState(prefill?.ticker || '')
  const [strikePrice, setStrikePrice] = useState(prefill?.strikePrice?.toString() || '')
  const [currentPrice, setCurrentPrice] = useState(prefill?.currentPrice?.toString() || '')
  const [quantity, setQuantity] = useState(prefill?.quantity?.toString() || '1')
  const [premium, setPremium] = useState(prefill?.premium?.toString() || '')
  const [costBasis, setCostBasis] = useState('')
  const [expirationDate, setExpirationDate] = useState(prefill?.expirationDate || '')
  const [currentPremium, setCurrentPremium] = useState('')
  const [notes, setNotes] = useState('')
  const [customTypeName, setCustomTypeName] = useState('')
  const [linkedPositionId, setLinkedPositionId] = useState('')
  const [fetching, setFetching] = useState(false)

  // Positions that can be linked (LEAP calls and stocks for sell_call)
  const linkablePositions = positions.filter(
    p => (p.type === 'leap_call' || p.type === 'stock') && p.ticker.toUpperCase() === ticker.toUpperCase()
  )

  const handleFetchPrice = async () => {
    if (!ticker.trim()) {
      showToast('请先输入股票代码', 'error')
      return
    }
    if (!apiKey) {
      showToast('请先在设置中配置 API Key', 'error')
      return
    }
    setFetching(true)
    try {
      const quote = await fetchSingleQuote(ticker.trim(), apiKey)
      if (quote) {
        setCurrentPrice(quote.price.toFixed(2))
        showToast(`${ticker.toUpperCase()} $${quote.price.toFixed(2)}`, 'success')
      } else {
        showToast('未找到该股票', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '查询失败', 'error')
    } finally {
      setFetching(false)
    }
  }

  const handleSubmit = () => {
    if (!ticker) {
      showToast('请输入股票代码', 'error')
      return
    }
    if (type === 'custom' && !customTypeName.trim()) {
      showToast('请输入策略名称', 'error')
      return
    }

    const pos: Omit<Position, 'id' | 'isClosed'> = {
      type,
      ticker: ticker.toUpperCase(),
      strikePrice: parseFloat(strikePrice) || 0,
      currentPrice: parseFloat(currentPrice) || 0,
      quantity: parseInt(quantity) || 1,
      premium: parseFloat(premium) || 0,
      costBasis: type === 'stock' ? parseFloat(costBasis) || 0 : undefined,
      expirationDate: expirationDate || undefined,
      openDate: new Date().toISOString(),
      currentPremium: parseFloat(currentPremium) || undefined,
      notes: notes || undefined,
      linkedPositionId: linkedPositionId || undefined,
      customTypeName: type === 'custom' ? customTypeName.trim() : undefined,
    }

    onAdd(pos)
    showToast(`${ticker.toUpperCase()} 建仓成功`, 'success')
  }

  return (
    <Card className="animate-slide-up">
      <CardHeader className="flex-row items-center justify-between pb-3">
        <CardTitle className="text-sm">新建持仓</CardTitle>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* Type selector - two rows */}
        <div className="grid grid-cols-4 gap-1.5">
          {TYPE_CONFIG.map(({ type: t, label, short }) => (
            <button
              key={t}
              className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all ${
                type === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
              onClick={() => setType(t)}
            >
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{short}</span>
            </button>
          ))}
        </div>

        {/* Custom type name */}
        {type === 'custom' && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">策略名称</label>
            <input
              className="input-field"
              placeholder="如 Bull Call Spread"
              value={customTypeName}
              onChange={e => setCustomTypeName(e.target.value)}
            />
          </div>
        )}

        {/* Ticker + quantity */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">股票代码</label>
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
                {fetching ? '...' : '查价'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">数量</label>
            <input
              type="number"
              className="input-field"
              placeholder={type === 'stock' ? '股数' : '合约数'}
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>

        {/* Strike + premium (options only) */}
        {isOptionType(type) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">行权价</label>
              <input
                type="number"
                className="input-field"
                placeholder="Strike"
                value={strikePrice}
                onChange={e => setStrikePrice(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                {isSellType(type) ? '收取权利金' : '支付权利金'} / 股
              </label>
              <input
                type="number"
                className="input-field"
                placeholder="Premium"
                value={premium}
                onChange={e => setPremium(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        )}

        {/* Cost basis (stock only) */}
        {type === 'stock' && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">成本价</label>
            <input
              type="number"
              className="input-field"
              placeholder="买入均价"
              value={costBasis}
              onChange={e => setCostBasis(e.target.value)}
              inputMode="decimal"
            />
          </div>
        )}

        {/* Current price + expiry */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">标的现价</label>
            <input
              type="number"
              className="input-field"
              placeholder="当前股价"
              value={currentPrice}
              onChange={e => setCurrentPrice(e.target.value)}
              inputMode="decimal"
            />
          </div>
          {isOptionType(type) && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">到期日</label>
              <input
                type="date"
                className="input-field"
                value={expirationDate}
                onChange={e => setExpirationDate(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* Current premium (options only) */}
        {isOptionType(type) && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">当前权利金 / 股</label>
            <input
              type="number"
              className="input-field"
              placeholder="用于计算浮盈"
              value={currentPremium}
              onChange={e => setCurrentPremium(e.target.value)}
              inputMode="decimal"
            />
          </div>
        )}

        {/* Linked position (for sell_call) */}
        {type === 'sell_call' && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">关联持仓 (用于摊薄成本)</label>
            <select
              className="input-field"
              value={linkedPositionId}
              onChange={e => setLinkedPositionId(e.target.value)}
            >
              <option value="">不关联</option>
              {linkablePositions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.type === 'leap_call' ? 'LC' : 'STK'} {p.ticker} ${p.strikePrice} ×{p.quantity}
                </option>
              ))}
              {ticker && linkablePositions.length === 0 && (
                <option disabled>无匹配的 {ticker.toUpperCase()} LEAP/正股持仓</option>
              )}
            </select>
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">备注</label>
          <input
            className="input-field"
            placeholder="可选"
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <Button onClick={handleSubmit} className="w-full mt-1">
          确认建仓
        </Button>
      </CardContent>
    </Card>
  )
}
