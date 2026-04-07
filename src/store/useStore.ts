import { useState, useEffect, useCallback } from 'react'
import type { Position, ClosedTrade, CostRecord } from '@/types'
import { generateId } from '@/lib/calculations'

const STORAGE_KEY_POSITIONS = 'options-explorer-positions'
const STORAGE_KEY_TRADES = 'options-explorer-trades'
const STORAGE_KEY_COST_RECORDS = 'options-explorer-cost-records'
const STORAGE_KEY_API_KEY = 'options-explorer-api-key'

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return fallback
}

function saveToStorage<T>(key: string, data: T) {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch { /* ignore */ }
}

export function useStore() {
  const [positions, setPositions] = useState<Position[]>(() =>
    loadFromStorage(STORAGE_KEY_POSITIONS, [])
  )
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>(() =>
    loadFromStorage(STORAGE_KEY_TRADES, [])
  )
  const [costRecords, setCostRecords] = useState<CostRecord[]>(() =>
    loadFromStorage(STORAGE_KEY_COST_RECORDS, [])
  )
  const [apiKey, setApiKeyState] = useState<string>(() => {
    try { return localStorage.getItem(STORAGE_KEY_API_KEY) || '' } catch { return '' }
  })

  useEffect(() => {
    saveToStorage(STORAGE_KEY_POSITIONS, positions)
  }, [positions])

  useEffect(() => {
    saveToStorage(STORAGE_KEY_TRADES, closedTrades)
  }, [closedTrades])

  useEffect(() => {
    saveToStorage(STORAGE_KEY_COST_RECORDS, costRecords)
  }, [costRecords])

  const addPosition = useCallback((pos: Omit<Position, 'id' | 'isClosed'>) => {
    const newPos: Position = { ...pos, id: generateId(), isClosed: false }
    setPositions(prev => [...prev, newPos])
  }, [])

  const updatePosition = useCallback((id: string, updates: Partial<Position>) => {
    setPositions(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
  }, [])

  const closePosition = useCallback((id: string, closePremium: number) => {
    setPositions(prev => {
      const pos = prev.find(p => p.id === id)
      if (!pos) return prev

      const closeDate = new Date().toISOString()
      let pnl: number
      let pnlPercent: number

      if (pos.type === 'sell_put' || pos.type === 'sell_call') {
        pnl = (pos.premium - closePremium) * pos.quantity * 100
        pnlPercent = pos.premium > 0 ? ((pos.premium - closePremium) / pos.premium) * 100 : 0
      } else if (pos.type === 'stock') {
        pnl = (closePremium - (pos.costBasis || pos.strikePrice)) * pos.quantity
        pnlPercent = pos.costBasis ? ((closePremium - pos.costBasis) / pos.costBasis) * 100 : 0
      } else {
        // buy_call, buy_put, leap_call, custom
        pnl = (closePremium - pos.premium) * pos.quantity * 100
        pnlPercent = pos.premium > 0 ? ((closePremium - pos.premium) / pos.premium) * 100 : 0
      }

      const trade: ClosedTrade = {
        id: generateId(),
        type: pos.type,
        ticker: pos.ticker,
        strikePrice: pos.strikePrice,
        premium: pos.premium,
        closePremium,
        quantity: pos.quantity,
        openDate: pos.openDate,
        closeDate,
        expirationDate: pos.expirationDate,
        pnl,
        pnlPercent,
        isWin: pnl > 0,
      }

      setClosedTrades(prevTrades => [...prevTrades, trade])

      // Auto-create cost record when closing a sell_call linked to a parent position
      if (pos.type === 'sell_call' && pos.linkedPositionId && pnl > 0) {
        const costRecord: CostRecord = {
          id: generateId(),
          parentPositionId: pos.linkedPositionId,
          description: `Sell ${pos.ticker} ${pos.strikePrice}C ${pos.expirationDate ? new Date(pos.expirationDate).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : ''}`,
          premiumCollected: pos.premium - closePremium,
          quantity: pos.quantity,
          date: closeDate,
          source: 'sell_call',
        }
        setCostRecords(prevRecords => [...prevRecords, costRecord])
      }

      return prev.filter(p => p.id !== id)
    })
  }, [])

  const deletePosition = useCallback((id: string) => {
    setPositions(prev => prev.filter(p => p.id !== id))
  }, [])

  const deleteTrade = useCallback((id: string) => {
    setClosedTrades(prev => prev.filter(t => t.id !== id))
  }, [])

  const addCostRecord = useCallback((record: Omit<CostRecord, 'id'>) => {
    const newRecord: CostRecord = { ...record, id: generateId() }
    setCostRecords(prev => [...prev, newRecord])
  }, [])

  const deleteCostRecord = useCallback((id: string) => {
    setCostRecords(prev => prev.filter(r => r.id !== id))
  }, [])

  const getCostRecordsForPosition = useCallback((positionId: string) => {
    return costRecords.filter(r => r.parentPositionId === positionId)
  }, [costRecords])

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key)
    try { localStorage.setItem(STORAGE_KEY_API_KEY, key) } catch { /* ignore */ }
  }, [])

  const openPositions = positions.filter(p => !p.isClosed)

  return {
    positions: openPositions,
    closedTrades,
    costRecords,
    apiKey,
    addPosition,
    updatePosition,
    closePosition,
    deletePosition,
    deleteTrade,
    addCostRecord,
    deleteCostRecord,
    getCostRecordsForPosition,
    setApiKey,
  }
}
