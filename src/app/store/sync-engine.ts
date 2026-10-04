import type { AuditEvent, FieldBatch, FieldRecord, SyncConflict, Weld } from '../types'

/** 合并结果：reducer 据此一次性更新台账、队列与审计 */
export interface MergeOutcome {
  welds: Weld[]
  /** 合并失败需保留重试的批次（不离开现场队列） */
  retained: FieldBatch[]
  /** 已幂等跳过的批次编号（此前已处理，同一批次只处理一次） */
  duplicateBatchIds: string[]
  /** 晚到旧结果对应记录：签字版本已更新，结果失效、不覆盖 */
  staleRecords: Array<{ batchId: string; record: FieldRecord; signedVersion: number }>
  /** 进入锁定快照而挂起、等待负责人选择的冲突 */
  conflicts: SyncConflict[]
  audit: AuditEvent[]
}

let auditSeq = 100
export function nextAuditId() {
  auditSeq += 1
  return `AE-SYNC-${auditSeq}`
}

export function nowLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function auditEvent(action: string, target: string, detail: string, actor = '同步服务'): AuditEvent {
  return { id: nextAuditId(), time: nowLabel(), actor, action, target, detail }
}

/**
 * 应用一条现场结果到焊缝台账：
 * 仅写入缺陷/复检结论与状态流转；检测比例、返修次数由返修闭环另行维护，合并阶段不更新。
 */
export function applyFieldRecord(welds: Weld[], record: FieldRecord): Weld[] {
  return welds.map((weld) => {
    if (weld.id !== record.weldId) return weld
    if (record.kind === '缺陷' && record.defect) {
      const defect = { ...record.defect, id: record.id.replace('FR-', 'D-SYNC-') }
      return { ...weld, defects: [...weld.defects, defect], status: '返修中' as const }
    }
    return { ...weld, status: record.conclusion ?? weld.status }
  })
}

/**
 * 把联网后的现场批次合并进主台账。
 * - 合并失败（failBatchIds，如网络/服务端错误）：整批保留在现场队列，等待重试
 * - 已处理批次：只做幂等跳过
 * - 记录基于的签字版本低于当前签字版本：旧结果失效，不覆盖已签字版本
 * - 目标焊缝在已锁定快照中：列入审核冲突，等待负责人选择
 * - 检测比例与返修次数在此阶段不更新
 */
export function mergeFieldBatches(
  welds: Weld[],
  batches: FieldBatch[],
  params: { processedBatchIds: string[]; signedVersion: number; locked: boolean; failBatchIds?: string[]; lockedWeldIds?: string[] },
): MergeOutcome {
  const { processedBatchIds, signedVersion, locked, failBatchIds = [], lockedWeldIds = [] } = params
  const outcome: MergeOutcome = {
    welds,
    retained: [],
    duplicateBatchIds: [],
    staleRecords: [],
    conflicts: [],
    audit: [],
  }

  let working = welds
  let applied = 0

  for (const batch of batches) {
    // 规则一：合并失败保留现场批次，等待重试
    if (failBatchIds.includes(batch.id)) {
      outcome.retained.push(batch)
      outcome.audit.push(auditEvent('合并失败', batch.id, `网络或服务端错误，${batch.records.length} 条现场结果保留在现场队列，等待重试`))
      continue
    }
    // 规则二：同一批次幂等，只处理一次
    if (processedBatchIds.includes(batch.id)) {
      outcome.duplicateBatchIds.push(batch.id)
      outcome.audit.push(auditEvent('重复导入跳过', batch.id, '该批次此前已完成合并，本次未重复处理'))
      continue
    }

    const accepted: FieldRecord[] = []
    for (const record of batch.records) {
      // 规则三：晚到的旧结果遇到签字版本更新后失效，不能覆盖
      if (record.baseVersion < signedVersion) {
        outcome.staleRecords.push({ batchId: batch.id, record, signedVersion })
        outcome.audit.push(
          auditEvent('旧结果失效', record.weldId,
            `记录基于签字 v${record.baseVersion}，当前已签字 v${signedVersion}，${record.kind}作废，未覆盖已签字版本`, batch.inspector),
        )
        continue
      }
      // 规则四：焊缝已进入锁定快照，冲突挂起到审核页等待负责人选择
      if (locked || lockedWeldIds.includes(record.weldId)) {
        outcome.conflicts.push({
          id: `CF-${record.id}`,
          batchId: batch.id,
          weldId: record.weldId,
          recordId: record.id,
          kind: record.kind,
          record,
          lockedVersion: signedVersion,
          raisedAt: nowLabel(),
          resolved: false,
        })
        outcome.audit.push(
          auditEvent('锁定冲突挂起', record.weldId,
            `${batch.id} 的${record.kind}命中已锁定快照 v${signedVersion}，已列入审核页等待负责人选择`, batch.inspector),
        )
        continue
      }
      accepted.push(record)
    }

    accepted.forEach((record) => { working = applyFieldRecord(working, record) })
    if (accepted.length) {
      applied += accepted.length
      outcome.audit.push(
        auditEvent('现场批次合并', batch.id,
          `合并 ${accepted.length} 条结果${outcome.staleRecords.some((s) => s.batchId === batch.id) ? '，另有旧结果失效' : ''}；检测比例与返修次数暂不更新`, batch.inspector),
      )
    }
  }

  outcome.welds = working
  return outcome
}

/** 负责人在审核页对锁定冲突做出选择 */
export interface ConflictResolution {
  welds: Weld[]
  conflict: SyncConflict
  audit: AuditEvent
  versionDelta: number
}

export function resolveConflict(welds: Weld[], conflict: SyncConflict, choice: '采用现场结果' | '保留快照版本'): ConflictResolution {
  if (choice === '保留快照版本') {
    return {
      welds,
      conflict: { ...conflict, resolved: true },
      versionDelta: 0,
      audit: auditEvent('冲突驳回', conflict.weldId,
        `${conflict.batchId} 的${conflict.kind}被驳回，保留锁定快照 v${conflict.lockedVersion}，现场结果不写入`, '质量负责人'),
    }
  }
  return {
    welds: applyFieldRecord(welds, conflict.record),
    conflict: { ...conflict, resolved: true },
    versionDelta: 1,
    audit: auditEvent('冲突采纳', conflict.weldId,
      `负责人采用 ${conflict.batchId} 的${conflict.kind}，从锁定快照 v${conflict.lockedVersion} 派生新修订；检测比例与返修次数暂不更新`, '质量负责人'),
  }
}
