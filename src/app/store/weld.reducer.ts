import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, FieldBatch, InspectionPlan, SyncConflict, Weld } from '../types'
import * as A from './weld.actions'
import { mergeFieldBatches, resolveConflict } from './sync-engine'
import { loadPersistedSync, persistSync } from './field-sync.storage'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  selectedId: string
  statusFilter: string
  locked: boolean
  version: number
  audit: AuditEvent[]
  /** 当前签字锁定版本；晚于此版本之后产生的现场旧结果一律失效 */
  signedVersion: number
  /** 断网暂存、待联网合并的现场批次 */
  fieldBatches: FieldBatch[]
  /** 已完成合并（幂等去重）的批次编号 */
  processedBatchIds: string[]
  /** 命中锁定快照、等待负责人选择的冲突 */
  syncConflicts: SyncConflict[]
  lastSyncAt: string
}

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

/** 演示用现场批次：01 可正常合并，02 基于旧签字版本（失效）；锁定后的晚到批次由审核页按钮模拟 */
const seedFieldBatches: FieldBatch[] = [
  {
    id: 'BATCH-SITE-01', createdAt: '09:42', inspector: '陈锋', online: true,
    records: [
      { id: 'FR-01', weldId: 'W-109', kind: '缺陷', baseVersion: 11, capturedAt: '09:36', inspector: '陈锋', defect: { position: 42, type: '未熔合', length: 9, level: 'Ⅲ级', method: 'UT', report: 'UT-SITE-0942；断网暂存，NB/T 47013.3 评定。' } },
      { id: 'FR-02', weldId: 'W-104', kind: '复检结论', baseVersion: 11, capturedAt: '09:40', inspector: '陈锋', conclusion: '合格', note: '返修部位 UT 复检合格' },
    ],
  },
  {
    id: 'BATCH-SITE-02', createdAt: '08:15', inspector: '赵岚', online: false,
    records: [
      { id: 'FR-03', weldId: 'W-107', kind: '复检结论', baseVersion: 10, capturedAt: '08:10', inspector: '赵岚', conclusion: '合格', note: '弱网下补录的旧结论，签字版本其后已更新' },
    ],
  },
]

const persisted = loadPersistedSync()

export const initialState: WeldState = {
  welds: [],
  plans: [],
  selectedId: '',
  statusFilter: '全部',
  locked: persisted?.locked ?? false,
  version: 12,
  audit,
  signedVersion: Math.max(11, persisted?.signedVersion ?? 0),
  fieldBatches: persisted?.fieldBatches ?? seedFieldBatches,
  processedBatchIds: persisted?.processedBatchIds ?? [],
  syncConflicts: persisted?.syncConflicts ?? [],
  lastSyncAt: persisted?.lastSyncAt ?? '',
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans }) => ({ ...state, welds, plans, selectedId: state.selectedId || welds[0]?.id || '' })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status }) => ({
    ...state,
    version: state.version + 1,
    welds: state.welds.map((weld) => weld.id === id ? { ...weld, status } : weld),
    audit: [{ id: `AE-${Date.now()}`, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }), actor: '当前审核人', action: '状态流转', target: id, detail: `状态变更为 ${status}` }, ...state.audit],
  })),
  on(A.createPlan, (state, { plan }) => ({ ...state, plans: [plan, ...state.plans], version: state.version + 1 })),
  on(A.lockBaseline, (state) => ({
    ...state,
    locked: true,
    signedVersion: state.version,
    audit: [{ id: `AE-${Date.now()}`, time: '刚刚', actor: '质量负责人', action: '签字锁定', target: '检测批次', detail: `焊工资质、检测比例与返修闭环已确认，形成签字版本 v${state.version}` }, ...state.audit],
  })),
  on(A.queueFieldBatch, (state, { batch }) => ({ ...state, fieldBatches: [batch, ...state.fieldBatches] })),
  on(A.syncFieldBatches, (state, { batchIds, failBatchIds }) => {
    const targets = state.fieldBatches.filter((batch) => batchIds.includes(batch.id))
    const outcome = mergeFieldBatches(state.welds, targets, {
      processedBatchIds: state.processedBatchIds,
      signedVersion: state.signedVersion,
      locked: state.locked,
      failBatchIds,
    })
    // 合并失败的批次保留在现场队列；其余（成功/失效/挂起/重复）离开队列
    const retainedIds = new Set(outcome.retained.map((batch) => batch.id))
    const doneIds = new Set([...state.processedBatchIds, ...targets.filter((batch) => !retainedIds.has(batch.id)).map((batch) => batch.id)])
    return {
      ...state,
      welds: outcome.welds,
      fieldBatches: state.fieldBatches.filter((batch) => retainedIds.has(batch.id)),
      processedBatchIds: [...doneIds],
      syncConflicts: [...state.syncConflicts, ...outcome.conflicts],
      lastSyncAt: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      audit: [...outcome.audit.reverse(), ...state.audit],
    }
  }),
  on(A.resolveSyncConflict, (state, { conflictId, choice }) => {
    const conflict = state.syncConflicts.find((item) => item.id === conflictId)
    if (!conflict || conflict.resolved) return state
    const result = resolveConflict(state.welds, conflict, choice)
    return {
      ...state,
      welds: result.welds,
      syncConflicts: state.syncConflicts.map((item) => item.id === conflictId ? result.conflict : item),
      version: state.version + result.versionDelta,
      // 采纳即从锁定快照派生并签字为新修订，基线推进；驳回则基线不变
      signedVersion: result.versionDelta ? state.version + result.versionDelta : state.signedVersion,
      audit: [result.audit, ...state.audit],
    }
  }),
)

/** 现场队列、冲突与签字版本需跨断网/刷新保留（台账本体仍以 GraphQL 主数据为准） */
export function persistWeldState(state: WeldState) {
  persistSync({
    fieldBatches: state.fieldBatches,
    processedBatchIds: state.processedBatchIds,
    syncConflicts: state.syncConflicts,
    signedVersion: state.signedVersion,
    locked: state.locked,
    lastSyncAt: state.lastSyncAt,
  })
}
