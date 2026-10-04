import type { FieldBatch, SyncConflict } from '../types'

const STORAGE_KEY = 'weld-field-sync-v1'

export interface PersistedSync {
  fieldBatches: FieldBatch[]
  processedBatchIds: string[]
  syncConflicts: SyncConflict[]
  signedVersion: number
  locked: boolean
  lastSyncAt: string
}

export function loadPersistedSync(): PersistedSync | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as PersistedSync : null
  } catch {
    return null
  }
}

export function persistSync(data: PersistedSync): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 存储不可用时仅影响跨刷新保留，不阻断本次合并
  }
}
