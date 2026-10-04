import { Injectable } from '@angular/core'
import type { Defect, DefectLevel, FieldBatch, FieldItem, MergeConflict, MergeEvalState, Weld, WeldStatus } from '../types'

/** 合并裁决结果：驱动批次状态流转，冲突转审核页，失败保留批次重试 */
export interface MergeOutcome {
  status: '已合并' | '冲突' | '已失效' | '失败'
  conflicts: MergeConflict[]
  failureReason?: string
}

const VALID_STATUSES: WeldStatus[] = ['待检测', '合格', '返修中', '待复检', '已关闭']
const VALID_LEVELS: DefectLevel[] = ['Ⅰ级', 'Ⅱ级', 'Ⅲ级', 'Ⅳ级']

export function nowStamp(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function defectText(item: FieldItem): string {
  const d = item.defect!
  return `${d.type} · ${d.position}% · ${d.length}mm · ${d.level} · ${d.method}`
}

/**
 * 纯函数：评估现场批次能否合并入主台账。
 * - 晚到的旧结果（baseVersion ≤ 已签字版本）→ 已失效，不能覆盖已签字版本
 * - 焊缝已进入锁定快照 → 冲突列审核页，不自动覆盖
 * - 焊缝在台账中不存在 → 失败，整批保留可重试
 * - 未锁定 → 可合并（仅写入缺陷与复检结论）
 */
export function evaluateMerge(state: MergeEvalState, batch: FieldBatch): MergeOutcome {
  if (state.locked && batch.baseVersion <= state.signedVersion) {
    return {
      status: '已失效',
      conflicts: [],
      failureReason: `批次采集于签字版本 v${batch.baseVersion}，台账已签字至 v${state.signedVersion}；晚到的旧结果失效，不能覆盖已签字版本`,
    }
  }
  for (const item of batch.items) {
    const weld = state.welds.find((w) => w.id === item.weldId)
    if (!weld) {
      return {
        status: '失败',
        conflicts: [],
        failureReason: `焊缝 ${item.weldId} 不存在于主台账，整批未写入；现场批次已保留，可重试`,
      }
    }
  }
  if (state.locked) {
    return { status: '冲突', conflicts: batch.items.map((item, i) => buildConflict(batch, item, state.welds, i)) }
  }
  return { status: '已合并', conflicts: [] }
}

function buildConflict(batch: FieldBatch, item: FieldItem, welds: Weld[], index: number): MergeConflict {
  const weld = welds.find((w) => w.id === item.weldId)!
  const isDefect = item.kind === '缺陷'
  return {
    id: `MC-${batch.id}-${index + 1}`,
    batchId: batch.id,
    batchCode: batch.id,
    weldId: weld.id,
    weldComponent: weld.component,
    reason: '锁定快照',
    fieldLabel: isDefect ? '现场缺陷记录' : '现场复检结论',
    fieldValue: isDefect ? defectText(item) : (item.conclusion ?? ''),
    ledgerValue: isDefect
      ? (weld.defects.length ? weld.defects.map((d) => `${d.type}·${d.position}%`).join('；') : '无缺陷')
      : weld.status,
    resolution: '待处理',
    item,
  }
}

/**
 * 纯函数：把现场结果写入焊缝。
 * 仅处理缺陷记录与复检结论 —— 检测比例与返修次数暂不更新。
 */
export function applyItemToWelds(welds: Weld[], item: FieldItem): Weld[] {
  return welds.map((weld) => {
    if (weld.id !== item.weldId) return weld
    if (item.kind === '缺陷' && item.defect) {
      const defect: Defect = {
        id: `D-${weld.id}-${item.defect.position}`,
        position: item.defect.position,
        type: item.defect.type,
        length: item.defect.length,
        level: item.defect.level,
        method: item.defect.method,
        report: item.defect.report,
      }
      const exists = weld.defects.some((d) => d.id === defect.id)
      return { ...weld, defects: exists ? weld.defects.map((d) => (d.id === defect.id ? defect : d)) : [...weld.defects, defect] }
    }
    if (item.kind === '复检结论' && item.conclusion) {
      return { ...weld, status: item.conclusion }
    }
    return weld
  })
}

@Injectable({ providedIn: 'root' })
export class FieldBatchService {
  /** 解析离线设备导出的批次 JSON，校验通过后补全导入元数据 */
  parseImport(raw: string, state: MergeEvalState): { batch: FieldBatch } | { error: string } {
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      return { error: '文件不是有效的 JSON，请检查离线批次导出内容' }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: '批次文件格式不正确，缺少批次对象' }
    const d = data as Record<string, unknown>
    if (typeof d.id !== 'string' || !d.id.trim()) return { error: '缺少批次编号 id' }
    if (!Array.isArray(d.items) || d.items.length === 0) return { error: '批次缺少现场结果 items' }
    const items: FieldItem[] = []
    for (const [i, rawItem] of d.items.entries()) {
      if (!rawItem || typeof rawItem !== 'object') return { error: `第 ${i + 1} 项不是有效结果` }
      const it = rawItem as Record<string, unknown>
      if (typeof it.weldId !== 'string' || !it.weldId.trim()) return { error: `第 ${i + 1} 项缺少焊缝编号 weldId` }
      if (it.kind !== '缺陷' && it.kind !== '复检结论') return { error: `第 ${i + 1} 项类型必须为「缺陷」或「复检结论」` }
      if (it.kind === '缺陷') {
        const df = it.defect as Record<string, unknown> | undefined
        if (!df || typeof df.type !== 'string' || typeof df.report !== 'string') return { error: `第 ${i + 1} 项缺陷信息不完整（需 type/report）` }
        if (typeof df.position !== 'number' || typeof df.length !== 'number') return { error: `第 ${i + 1} 项缺陷位置/长度必须为数字` }
        if (!VALID_LEVELS.includes(df.level as DefectLevel)) return { error: `第 ${i + 1} 项缺陷等级无效` }
      } else if (!VALID_STATUSES.includes(it.conclusion as WeldStatus)) {
        return { error: `第 ${i + 1} 项复检结论无效` }
      }
      items.push({
        id: typeof it.id === 'string' ? it.id : `${String(d.id).trim()}-I${i + 1}`,
        weldId: it.weldId,
        kind: it.kind,
        defect: it.kind === '缺陷' ? (it.defect as FieldItem['defect']) : undefined,
        conclusion: it.kind === '复检结论' ? (it.conclusion as WeldStatus) : undefined,
        note: typeof it.note === 'string' ? it.note : undefined,
      })
    }
    const batch: FieldBatch = {
      id: d.id.trim(),
      source: typeof d.source === 'string' ? d.source : '离线导入 · 工地移动端',
      inspector: typeof d.inspector === 'string' ? d.inspector : '现场检测员',
      capturedAt: typeof d.capturedAt === 'string' ? d.capturedAt : '未知',
      importedAt: nowStamp(),
      baseVersion: typeof d.baseVersion === 'number' ? d.baseVersion : state.version,
      status: '待合并',
      items,
      retryCount: 0,
    }
    return { batch }
  }

  /** 生成演示用模拟批次：online 未锁定可直接合并 / locked 锁定后转冲突 / stale 签字后晚到失效 */
  mockBatch(state: MergeEvalState, scenario: 'online' | 'locked' | 'stale'): FieldBatch {
    const baseVersion = scenario === 'stale' ? Math.max(1, state.signedVersion - 1) : state.version
    const items: FieldItem[] = [
      { id: `I-${Date.now()}-1`, weldId: 'W-104', kind: '复检结论', conclusion: '合格', note: '现场复检合格' },
      {
        id: `I-${Date.now()}-2`, weldId: 'W-107', kind: '缺陷',
        defect: { position: 72, type: '未熔合', length: 16, level: 'Ⅲ级', method: 'MT', report: 'MT-2026-1004-02' },
      },
    ]
    return {
      id: `FB-MOCK-${Date.now().toString().slice(-6)}`,
      source: '模拟现场批次 · 工地移动端',
      inspector: '赵岚',
      capturedAt: nowStamp(),
      importedAt: nowStamp(),
      baseVersion,
      status: '待合并',
      items,
      retryCount: 0,
    }
  }
}
