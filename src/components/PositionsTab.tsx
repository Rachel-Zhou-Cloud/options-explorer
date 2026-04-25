import { useState, useEffect } from 'react'
import type { Position, StaticMarketData, OptionContract } from '@/types'
import { daysUntilExpiry } from '@/lib/calculations'
import { PositionCard } from '@/components/PositionCard'
import { AddPositionForm } from '@/components/AddPositionForm'
import { Button } from '@/components/ui/button'
import { Plus, Layers, TrendingUp as TrendingUpIcon, BarChart3, RefreshCw, ArrowDownCircle, Upload, Wifi } from 'lucide-react'
import { fetchQuotes, fetchStaticMarketData, getQuoteFromStaticData, matchOptionData, formatDataAge, isDataFresh } from '@/lib/marketData'
import { showToast } from '@/components/ui/toast'
import { CsvImport } from '@/components/CsvImport'

interface PositionsTabProps {
  positions: Position[]
  onAdd: (pos: Omit<Position, 'id' | 'isClosed'>) => void
  onClose: (id: string, closePremium: number, closeQty?: number) => void
  onUpdate: (id: string, updates: Partial<Position>) => void
  onDelete: (id: string) => void
  apiKey: string
  prefill?: Partial<Position> | null
  onClearPrefill?: () => void
}

export function PositionsTab({ positions, onAdd, onClose, onUpdate, onDelete, apiKey, prefill, onClearPrefill }: PositionsTabProps) {
  const [showAddForm, setShowAddForm] = useState(!!prefill)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [marketData, setMarketData] = useState<StaticMarketData | null>(null)

  // Load static market data on mount (for display panels only; auto-update is in App.tsx)
  useEffect(() => {
    fetchStaticMarketData().then(data => { if (data) setMarketData(data) })
  }, [])

  // Build option data map for each position
  const optionDataMap = new Map<string, OptionContract | null>()
  if (marketData) {
    for (const pos of positions) {
      optionDataMap.set(pos.id, matchOptionData(pos, marketData))
    }
  }

  // Categorize positions
  const leapCalls = positions.filter(p => {
    if (p.type !== 'leap_call') return false
    if (!p.expirationDate) return true
    return daysUntilExpiry(p.expirationDate) > 90
  })

  const stocks = positions.filter(p => p.type === 'stock')

  const sellPuts = positions
    .filter(p => p.type === 'sell_put')
    .sort((a, b) => {
      if (!a.expirationDate) return 1
      if (!b.expirationDate) return -1
      return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime()
    })

  const sellCalls = positions
    .filter(p => p.type === 'sell_call')
    .sort((a, b) => {
      if (!a.expirationDate) return 1
      if (!b.expirationDate) return -1
      return new Date(a.expirationDate).getTime() - new Date(b.expirationDate).getTime()
    })

  // Short-term: LEAP calls with <= 90 DTE
  const shortTermCalls = positions.filter(p => {
    if (p.type !== 'leap_call') return false
    if (!p.expirationDate) return false
    return daysUntilExpiry(p.expirationDate) <= 90
  })

  // Other types: buy_call, buy_put, custom
  const otherPositions = positions.filter(p =>
    p.type === 'buy_call' || p.type === 'buy_put' || p.type === 'custom'
  )

  const totalPositions = positions.length

  const handleAdd = (pos: Omit<Position, 'id' | 'isClosed'>) => {
    onAdd(pos)
    setShowAddForm(false)
    onClearPrefill?.()
  }

  const handleCancel = () => {
    setShowAddForm(false)
    onClearPrefill?.()
  }

  const handleCsvImport = (imported: Omit<Position, 'id' | 'isClosed'>[]) => {
    imported.forEach(pos => onAdd(pos))
    setShowCsvImport(false)
  }

  const handleRefreshQuotes = async () => {
    const tickers = [...new Set(positions.map(p => p.ticker.toUpperCase()))]
    if (tickers.length === 0) {
      showToast('暂无持仓', 'error')
      return
    }
    setRefreshing(true)
    try {
      // Try static data first (no API key needed)
      const staticData = await fetchStaticMarketData()
      let updated = 0

      if (staticData && isDataFresh(staticData.timestamp)) {
        setMarketData(staticData)
        for (const pos of positions) {
          const quote = getQuoteFromStaticData(pos.ticker, staticData)
          const updates: Partial<Position> = {}
          if (quote) updates.currentPrice = quote.price
          const optData = matchOptionData(pos, staticData)
          if (optData && optData.last > 0) updates.currentPremium = optData.last
          if (Object.keys(updates).length > 0) {
            onUpdate(pos.id, updates)
            updated++
          }
        }
        const age = formatDataAge(staticData.timestamp)
        showToast(`已从 Yahoo 数据更新 ${updated} 个持仓 (${age})`, 'success')
      } else if (apiKey) {
        const quotes = await fetchQuotes(tickers, apiKey)
        for (const pos of positions) {
          const quote = quotes[pos.ticker.toUpperCase()]
          if (quote) {
            onUpdate(pos.id, { currentPrice: quote.price })
            updated++
          }
        }
        showToast(`已从 Twelve Data 更新 ${updated} 个持仓`, 'success')
      } else {
        showToast('暂无可用数据源。请等待 Yahoo 数据更新或配置 API Key', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '刷新失败', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-profit/10">
            <Layers className="h-5 w-5 text-profit" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">当前持仓</h2>
            <p className="text-xs text-muted-foreground">
              共 {totalPositions} 个活跃持仓
              {marketData && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-profit">
                  <Wifi className="h-2.5 w-2.5" />{formatDataAge(marketData.timestamp)}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {totalPositions > 0 && (
            <Button size="sm" variant="outline" onClick={handleRefreshQuotes} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? '刷新中' : '刷新'}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowCsvImport(!showCsvImport)}>
            <Upload className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}>
            <Plus className="h-4 w-4 mr-1" />
            建仓
          </Button>
        </div>
      </div>

      {/* CSV Import */}
      {showCsvImport && (
        <CsvImport onImport={handleCsvImport} onClose={() => setShowCsvImport(false)} />
      )}

      {/* Add Form */}
      {showAddForm && (
        <AddPositionForm
          onAdd={handleAdd}
          onCancel={handleCancel}
          apiKey={apiKey}
          positions={positions}
          prefill={prefill}
        />
      )}

      {/* Empty state */}
      {totalPositions === 0 && !showAddForm && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary mb-4">
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">暂无持仓</p>
          <p className="text-xs text-muted-foreground">点击右上角「建仓」添加第一个持仓</p>
        </div>
      )}

      {/* LEAP Calls Section */}
      {leapCalls.length > 0 && (
        <Section
          icon={<TrendingUpIcon className="h-4 w-4 text-profit" />}
          title="LEAP Call"
          count={leapCalls.length}
          subtitle=">90天长期看涨"
        >
          {leapCalls.map(pos => (
            <PositionCard key={pos.id} position={pos} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete} optionChainData={optionDataMap.get(pos.id)} dataTimestamp={marketData?.timestamp} />
          ))}
        </Section>
      )}

      {/* Short-term calls (former LEAPs) */}
      {shortTermCalls.length > 0 && (
        <Section
          icon={<TrendingUpIcon className="h-4 w-4 text-warning" />}
          title="Short-term Call"
          count={shortTermCalls.length}
          subtitle="原LEAP已<90天"
        >
          {shortTermCalls.map(pos => (
            <PositionCard key={pos.id} position={pos} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete} optionChainData={optionDataMap.get(pos.id)} dataTimestamp={marketData?.timestamp} />
          ))}
        </Section>
      )}

      {/* Stocks Section */}
      {stocks.length > 0 && (
        <Section
          icon={<BarChart3 className="h-4 w-4 text-primary" />}
          title="正股 Stock"
          count={stocks.length}
          subtitle="股票持仓"
        >
          {stocks.map(pos => (
            <PositionCard key={pos.id} position={pos} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete} optionChainData={optionDataMap.get(pos.id)} dataTimestamp={marketData?.timestamp} />
          ))}
        </Section>
      )}

      {/* Sell Calls Section */}
      {sellCalls.length > 0 && (
        <Section
          icon={<ArrowDownCircle className="h-4 w-4 text-warning" />}
          title="Sell Call"
          count={sellCalls.length}
          subtitle="按到期日排序"
        >
          {sellCalls.map(pos => (
            <PositionCard key={pos.id} position={pos} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete} optionChainData={optionDataMap.get(pos.id)} dataTimestamp={marketData?.timestamp} />
          ))}
        </Section>
      )}

      {/* Sell Puts Section */}
      {sellPuts.length > 0 && (
        <Section
          icon={<Layers className="h-4 w-4 text-primary" />}
          title="Sell Put"
          count={sellPuts.length}
          subtitle="按到期日排序"
        >
          {sellPuts.map(pos => (
            <PositionCard key={pos.id} position={pos} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete} optionChainData={optionDataMap.get(pos.id)} dataTimestamp={marketData?.timestamp} />
          ))}
        </Section>
      )}

      {/* Other positions */}
      {otherPositions.length > 0 && (
        <Section
          icon={<Layers className="h-4 w-4 text-muted-foreground" />}
          title="其他策略"
          count={otherPositions.length}
          subtitle="Buy/Custom"
        >
          {otherPositions.map(pos => (
            <PositionCard key={pos.id} position={pos} onClose={onClose} onUpdate={onUpdate} onDelete={onDelete} optionChainData={optionDataMap.get(pos.id)} dataTimestamp={marketData?.timestamp} />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({
  icon,
  title,
  count,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  count: number
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-1">
        {icon}
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">({count})</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{subtitle}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {children}
      </div>
    </div>
  )
}
