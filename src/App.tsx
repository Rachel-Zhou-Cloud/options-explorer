import { useState, useEffect, useRef, useCallback } from 'react'
import { CalculatorTab } from '@/components/CalculatorTab'
import { PositionsTab } from '@/components/PositionsTab'
import { PerformanceTab } from '@/components/PerformanceTab'
import { CostAnalysisTab } from '@/components/CostAnalysisTab'
import { RiskControlTab } from '@/components/RiskControlTab'
import { DecisionCenter } from '@/components/DecisionCenter'
import { ToastContainer, showToast } from '@/components/ui/toast'
import { useStore } from '@/store/useStore'
import type { Position } from '@/types'
import { Calculator, Layers, Trophy, PiggyBank, Shield, Settings, X, Wifi, Copy, LayoutDashboard } from 'lucide-react'
import { fetchStaticMarketData, getQuoteFromStaticData, matchOptionData, formatDataAge } from '@/lib/marketData'

type TabId = 'calculator' | 'positions' | 'cost' | 'performance' | 'risk'

const tabs: { id: TabId; label: string; icon: typeof Calculator }[] = [
  { id: 'calculator', label: '计算器', icon: Calculator },
  { id: 'positions', label: '持仓', icon: Layers },
  { id: 'cost', label: '成本', icon: PiggyBank },
  { id: 'performance', label: '绩效', icon: Trophy },
  { id: 'risk', label: '风控', icon: Shield },
]

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('calculator')
  const [showSettings, setShowSettings] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [prefillPosition, setPrefillPosition] = useState<Partial<Position> | null>(null)
  const store = useStore()

  // Ref to always have latest positions for async callbacks
  const positionsRef = useRef(store.positions)
  positionsRef.current = store.positions

  // Reusable auto-update: fetch Yahoo data and batch-update all positions
  const runAutoUpdate = useCallback(async (notify: boolean) => {
    const positions = positionsRef.current
    if (positions.length === 0) return
    const data = await fetchStaticMarketData()
    if (!data) return
    const updatesMap: Record<string, Partial<Position>> = {}
    const changedTickers: string[] = []
    for (const pos of positions) {
      const updates: Partial<Position> = {}
      const quote = getQuoteFromStaticData(pos.ticker, data)
      if (quote && quote.price > 0 && quote.price !== pos.currentPrice) {
        updates.currentPrice = quote.price
      }
      const optData = matchOptionData(pos, data)
      if (optData && optData.last > 0 && optData.last !== pos.currentPremium) {
        updates.currentPremium = optData.last
      }
      if (Object.keys(updates).length > 0) {
        updatesMap[pos.id] = updates
        if (!changedTickers.includes(pos.ticker)) changedTickers.push(pos.ticker)
      }
    }
    if (Object.keys(updatesMap).length > 0) {
      store.batchUpdatePositions(updatesMap)
      if (notify) {
        const age = formatDataAge(data.timestamp)
        const tickers = changedTickers.slice(0, 5).join(', ')
        const more = changedTickers.length > 5 ? `等${changedTickers.length}只` : ''
        showToast(`行情已更新: ${tickers}${more} (${age})`, 'success')
      }
    }
  }, [store.batchUpdatePositions])

  // Auto-update on app start
  useEffect(() => {
    runAutoUpdate(true)
  }, [runAutoUpdate])

  // Auto-update when new positions are added
  const positionCount = store.positions.length
  const prevCountRef = useRef(positionCount)
  useEffect(() => {
    if (positionCount > prevCountRef.current) {
      // New position added — silently match Yahoo data for it
      runAutoUpdate(false)
    }
    prevCountRef.current = positionCount
  }, [positionCount, runAutoUpdate])

  const openSettings = () => {
    setApiKeyInput(store.apiKey)
    setShowSettings(true)
  }

  const saveApiKey = () => {
    store.setApiKey(apiKeyInput.trim())
    setShowSettings(false)
  }

  const handleCreateFromCalculator = (prefill: Partial<Position>) => {
    setPrefillPosition(prefill)
    setActiveTab('positions')
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ToastContainer />

      {/* Decision Center — full-screen overlay */}
      {showDashboard && (
        <DecisionCenter
          positions={store.positions}
          cashBalance={store.cashBalance}
          getCostRecordsForPosition={store.getCostRecordsForPosition}
          onBack={() => setShowDashboard(false)}
        />
      )}

      {/* Main app (hidden when Dashboard is open) */}
      {!showDashboard && (<>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border bg-card p-5 shadow-xl animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">设置</h3>
              <button onClick={() => setShowSettings(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Twelve Data API Key</label>
                <input
                  className="input-field"
                  placeholder="输入你的 API Key"
                  value={apiKeyInput}
                  onChange={e => setApiKeyInput(e.target.value)}
                  type="password"
                />
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                  免费注册获取：twelvedata.com，每天 800 次调用。用于自动获取股票实时价格。
                </p>
              </div>
              <button
                onClick={saveApiKey}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                保存
              </button>

              {/* Yahoo Finance data info */}
              <div className="border-t pt-3 mt-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <Wifi className="h-3.5 w-3.5 text-profit" />
                  <span className="text-xs font-medium text-foreground">Yahoo Finance 数据</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                  通过 GitHub Actions 每30分钟自动抓取 Yahoo Finance 期权数据（美股交易时段），无需 API Key。
                  监控列表中的股票可自动获取报价和期权链数据（Bid/Ask、IV、成交量、未平仓量）。
                </p>
                <button
                  onClick={() => {
                    const tickers = [...new Set(store.positions.map(p => p.ticker.toUpperCase()))].sort()
                    if (tickers.length === 0) {
                      showToast('暂无持仓', 'error')
                      return
                    }
                    navigator.clipboard.writeText(JSON.stringify(tickers))
                    showToast(`已复制 ${tickers.length} 个股票代码`, 'success')
                  }}
                  className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
                >
                  <Copy className="h-3 w-3" />
                  从持仓复制 Tickers (用于更新 watchlist.json)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between h-12 px-4">
          <button
            onClick={() => setShowDashboard(true)}
            className="text-muted-foreground hover:text-primary transition-colors"
            title="Decision Center"
          >
            <LayoutDashboard className="h-4.5 w-4.5" />
          </button>
          <h1 className="text-sm font-semibold text-foreground tracking-wide">Options Explorer</h1>
          <button onClick={openSettings} className="text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-20">
        {activeTab === 'calculator' && (
          <CalculatorTab apiKey={store.apiKey} onCreatePosition={handleCreateFromCalculator} />
        )}
        {activeTab === 'positions' && (
          <PositionsTab
            positions={store.positions}
            onAdd={store.addPosition}
            onClose={store.closePosition}
            onUpdate={store.updatePosition}
            onDelete={store.deletePosition}
            apiKey={store.apiKey}
            prefill={prefillPosition}
            onClearPrefill={() => setPrefillPosition(null)}
          />
        )}
        {activeTab === 'cost' && (
          <CostAnalysisTab
            positions={store.positions}
            costRecords={store.costRecords}
            onAddRecord={store.addCostRecord}
            onDeleteRecord={store.deleteCostRecord}
            getRecordsForPosition={store.getCostRecordsForPosition}
          />
        )}
        {activeTab === 'performance' && (
          <PerformanceTab
            closedTrades={store.closedTrades}
            onDeleteTrade={store.deleteTrade}
            onAddTrade={store.addClosedTrade}
            positions={store.positions}
            cashBalance={store.cashBalance}
          />
        )}
        {activeTab === 'risk' && (
          <RiskControlTab
            positions={store.positions}
            cashBalance={store.cashBalance}
            onSetCashBalance={store.setCashBalance}
          />
        )}
      </main>

      {/* Bottom Tab Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/80 backdrop-blur-xl safe-area-bottom">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 py-2 transition-all duration-200 ${
                  isActive ? 'tab-active' : 'tab-inactive'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon className={`h-5 w-5 transition-all ${isActive ? 'scale-110' : ''}`} />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {isActive && (
                  <div className="absolute bottom-1.5 h-0.5 w-6 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      </nav>
      </>)}
    </div>
  )
}

export default App
