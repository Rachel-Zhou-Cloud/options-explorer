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
}

export function AddPositionForm({ onAdd, onCancel, apiKey }: AddPositionFormProps) {
  const [type, setType] = useState<PositionType>('sell_put')
  const [ticker, setTicker] = useState('')
  const [strikePrice, setStrikePrice] = useState('')
  const [currentPrice, setCurrentPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [premium, setPremium] = useState('')
  const [costBasis, setCostBasis] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [currentPremium, setCurrentPremium] = useState('')
  const [notes, setNotes] = useState('')
  const [fetching, setFetching] = useState(false)

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
    }

    onAdd(pos)
    showToast(`${ticker.toUpperCase()} 建仓成功`, 'success')
  }

  const typeLabels: Record<PositionType, string> = {
    sell_put: 'Sell Put',
    leap_call: 'LEAP Call',
    stock: '正股 Stock',
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
        {/* Type selector */}
        <div className="flex gap-2">
          {(Object.keys(typeLabels) as PositionType[]).map(t => (
            <button
              key={t}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                type === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
              onClick={() => setType(t)}
            >
              {typeLabels[t]}
            </button>
          ))}
        </div>

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

        {type !== 'stock' && (
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
                {type === 'sell_put' ? '收取权利金' : '支付权利金'} / 股
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
          {type !== 'stock' && (
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

        {type !== 'stock' && (
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
