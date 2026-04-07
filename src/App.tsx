import { useState } from 'react'
import { CalculatorTab } from '@/components/CalculatorTab'
import { PositionsTab } from '@/components/PositionsTab'
import { PerformanceTab } from '@/components/PerformanceTab'
import { CostAnalysisTab } from '@/components/CostAnalysisTab'
import { ToastContainer } from '@/components/ui/toast'
import { useStore } from '@/store/useStore'
import { Calculator, Layers, Trophy, PiggyBank, Settings, X } from 'lucide-react'

type TabId = 'calculator' | 'positions' | 'cost' | 'performance'

const tabs: { id: TabId; label: string; icon: typeof Calculator }[] = [
  { id: 'calculator', label: '计算器', icon: Calculator },
  { id: 'positions', label: '持仓', icon: Layers },
  { id: 'cost', label: '成本', icon: PiggyBank },
  { id: 'performance', label: '绩效', icon: Trophy },
]

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('calculator')
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const store = useStore()

  const openSettings = () => {
    setApiKeyInput(store.apiKey)
    setShowSettings(true)
  }

  const saveApiKey = () => {
    store.setApiKey(apiKeyInput.trim())
    setShowSettings(false)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <ToastContainer />

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
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="flex items-center justify-between h-12 px-4">
          <div className="w-8" />
          <h1 className="text-sm font-semibold text-foreground tracking-wide">Options Explorer</h1>
          <button onClick={openSettings} className="text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-4 pt-4 pb-20">
        {activeTab === 'calculator' && <CalculatorTab apiKey={store.apiKey} />}
        {activeTab === 'positions' && (
          <PositionsTab
            positions={store.positions}
            onAdd={store.addPosition}
            onClose={store.closePosition}
            onUpdate={store.updatePosition}
            onDelete={store.deletePosition}
            apiKey={store.apiKey}
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
                className={`flex flex-col items-center justify-center gap-0.5 px-4 py-2 transition-all duration-200 ${
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
    </div>
  )
}

export default App
