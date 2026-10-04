import { createReducer, on } from '@ngrx/store'
import type { AuditEvent, FieldBatch, InspectionPlan, MergeConflict, Weld } from '../types'
import { applyItemToWelds, evaluateMerge, nowStamp } from '../services/field-batch.service'
import * as A from './weld.actions'

export interface WeldState {
  welds: Weld[]
  plans: InspectionPlan[]
  selectedId: string
  statusFilter: string
  locked: boolean
  /** 当前工作版本；签字锁定时固化为 signedVersion 并自增 */
  version: number
  /** 最近一次签字锁定时的版本号，用于判定晚到批次是否失效 */
  signedVersion: number
  audit: AuditEvent[]
  /** 现场离线批次队列 */
  fieldBatches: FieldBatch[]
  /** 锁定快照冲突，列审核页等待负责人裁决 */
  conflicts: MergeConflict[]
  /** 已处理批次号，同一批次重复导入只处理一次 */
  processedBatchIds: string[]
}

const audit: AuditEvent[] = [
  { id: 'AE-1', time: '16:38', actor: '赵岚', action: '提交复检', target: 'W-104', detail: '返修后 UT 复检合格，等待审核签字' },
  { id: 'AE-2', time: '15:12', actor: '陈锋', action: '录入缺陷', target: 'W-107', detail: '翼缘板端部夹渣，长度 12mm，Ⅱ级' },
  { id: 'AE-3', time: '14:20', actor: '系统', action: '资质预警', target: 'W-109', detail: '焊工证书 2026-10-01 到期，不得列入后续检测计划' },
]

export const initialState: WeldState = {
  welds: [], plans: [], selectedId: '', statusFilter: '全部',
  locked: false, version: 12, signedVersion: 0,
  audit, fieldBatches: [], conflicts: [], processedBatchIds: [],
}

function auditEvent(actor: string, action: string, target: string, detail: string): AuditEvent {
  return { id: `AE-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, time: nowStamp(), actor, action, target, detail }
}

/** 执行批次合并：已合并 / 冲突 / 已失效 / 失败 四态流转，失败保留批次可重试 */
function runMerge(state: WeldState, id: string): WeldState {
  const batch = state.fieldBatches.find((b) => b.id === id)
  if (!batch || batch.status === '已合并') return state
  const outcome = evaluateMerge(state, batch)
  const time = nowStamp()

  if (outcome.status === '已失效') {
    return {
      ...state,
      fieldBatches: state.fieldBatches.map((b) => b.id === id ? { ...b, status: '已失效', failureReason: outcome.failureReason } : b),
      audit: [auditEvent('系统', '晚到结果失效', batch.id, outcome.failureReason!), ...state.audit],
    }
  }
  if (outcome.status === '失败') {
    return {
      ...state,
      fieldBatches: state.fieldBatches.map((b) => b.id === id ? { ...b, status: '失败', failureReason: outcome.failureReason } : b),
      audit: [auditEvent('系统', '合并失败，批次保留待重试', batch.id, outcome.failureReason!), ...state.audit],
    }
  }
  if (outcome.status === '冲突') {
    return {
      ...state,
      fieldBatches: state.fieldBatches.map((b) => b.id === id ? { ...b, status: '冲突' } : b),
      conflicts: [...outcome.conflicts, ...state.conflicts],
      audit: [auditEvent('系统', '锁定快照冲突待裁决', batch.id, `${outcome.conflicts.length} 项冲突已列审核页，由负责人选择采用现场值或保留台账值`), ...state.audit],
    }
  }

  // 已合并：仅写入缺陷记录与复检结论，检测比例与返修次数暂不更新
  let welds = state.welds
  for (const item of batch.items) welds = applyItemToWelds(welds, item)
  return {
    ...state,
    welds,
    fieldBatches: state.fieldBatches.map((b) => b.id === id ? { ...b, status: '已合并', mergedAt: time, failureReason: undefined } : b),
    processedBatchIds: [...state.processedBatchIds, batch.id],
    audit: [auditEvent('系统', '现场批次已合并', batch.id, `${batch.items.length} 项缺陷/复检结论已写入主台账；检测比例与返修次数暂不更新`), ...state.audit],
  }
}

export const weldReducer = createReducer(
  initialState,
  on(A.loadWeldsSuccess, (state, { welds, plans }) => ({ ...state, welds, plans, selectedId: state.selectedId || welds[0]?.id || '' })),
  on(A.selectWeld, (state, { id }) => ({ ...state, selectedId: id })),
  on(A.filterStatus, (state, { status }) => ({ ...state, statusFilter: status })),
  on(A.advanceWeld, (state, { id, status }) => ({ ...state, version: state.version + 1, welds: state.welds.map((weld) => weld.id === id ? { ...weld, status } : weld), audit: [auditEvent('当前审核人', '状态流转', id, `状态变更为 ${status}`), ...state.audit] })),
  on(A.createPlan, (state, { plan }) => ({ ...state, plans: [plan, ...state.plans], version: state.version + 1 })),
  on(A.lockBaseline, (state) => ({
    ...state,
    locked: true,
    signedVersion: state.version,
    version: state.version + 1,
    audit: [auditEvent('质量负责人', '签字锁定', '检测批次', `版本 v${state.version} 已签字为快照版本 v${state.version}；后续现场批次按版本/锁定规则裁决，不能覆盖已签字版本`), ...state.audit],
  })),

  // —— 现场离线批次：导入、合并、重试、清理 ——
  on(A.importFieldBatch, (state, { batch }) => {
    if (state.fieldBatches.some((b) => b.id === batch.id)) {
      return { ...state, audit: [auditEvent('系统', '重复导入已忽略', batch.id, '同一批次仅处理一次，不重复写入主台账'), ...state.audit] }
    }
    return {
      ...state,
      fieldBatches: [batch, ...state.fieldBatches],
      audit: [auditEvent(batch.inspector, '导入现场离线批次', batch.id, `${batch.items.length} 项结果 · 采集于台账 v${batch.baseVersion} · 状态待合并`), ...state.audit],
    }
  }),
  on(A.mergeFieldBatch, (state, { id }) => runMerge(state, id)),
  on(A.retryFieldBatch, (state, { id }) => {
    const batch = state.fieldBatches.find((b) => b.id === id)
    if (!batch) return state
    const retried: FieldBatch = { ...batch, status: '待合并', retryCount: batch.retryCount + 1, failureReason: undefined }
    return runMerge({ ...state, fieldBatches: state.fieldBatches.map((b) => b.id === id ? retried : b) }, id)
  }),
  on(A.dismissFieldBatch, (state, { id }) => {
    const batch = state.fieldBatches.find((b) => b.id === id)
    if (!batch || batch.status === '待合并' || batch.status === '冲突') return state
    return { ...state, fieldBatches: state.fieldBatches.filter((b) => b.id !== id), audit: [auditEvent('系统', '清理现场批次', id, `已移除${batch.status}批次记录`), ...state.audit] }
  }),

  // —— 锁定快照冲突裁决：采用现场值 / 保留台账值 ——
  on(A.resolveConflict, (state, { conflictId, resolution, actor }) => {
    const conflict = state.conflicts.find((c) => c.id === conflictId)
    if (!conflict || conflict.resolution !== '待处理') return state
    const time = nowStamp()
    let welds = state.welds
    if (resolution === '采用现场值') welds = applyItemToWelds(welds, conflict.item)
    const conflicts: MergeConflict[] = state.conflicts.map((c) => c.id === conflictId ? { ...c, resolution, decidedBy: actor, decidedAt: time } : c)
    let fieldBatches = state.fieldBatches
    let processedBatchIds = state.processedBatchIds
    const batch = state.fieldBatches.find((b) => b.id === conflict.batchId)
    if (batch && batch.status === '冲突' && !conflicts.some((c) => c.batchId === batch.id && c.resolution === '待处理')) {
      fieldBatches = fieldBatches.map((b) => b.id === batch.id ? { ...b, status: '已合并', mergedAt: time } : b)
      processedBatchIds = [...processedBatchIds, batch.id]
    }
    return {
      ...state,
      welds,
      conflicts,
      fieldBatches,
      processedBatchIds,
      audit: [auditEvent(actor, resolution === '采用现场值' ? '冲突裁决：采用现场值' : '冲突裁决：保留台账值', conflict.weldId, `${conflict.fieldLabel} · ${conflict.fieldValue}；检测比例与返修次数不更新`), ...state.audit],
    }
  }),
)
