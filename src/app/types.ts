export type WeldStatus = '待检测' | '合格' | '返修中' | '待复检' | '已关闭'
export type DefectLevel = 'Ⅰ级' | 'Ⅱ级' | 'Ⅲ级' | 'Ⅳ级'

export interface Defect {
  id: string
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

export interface Weld {
  id: string
  drawing: string
  component: string
  joint: string
  method: string
  welder: string
  qualification: string
  qualificationValid: boolean
  inspectionRatio: number
  requiredRatio: number
  status: WeldStatus
  x: number
  y: number
  repairs: number
  defects: Defect[]
}

export interface InspectionPlan {
  id: string
  date: string
  method: string
  weldIds: string[]
  inspector: string
  state: '待执行' | '执行中' | '已完成'
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  action: string
  target: string
  detail: string
}

/** 现场离线批次状态：断网暂存 → 联网合并的完整生命周期 */
export type FieldBatchStatus = '待合并' | '合并中' | '已合并' | '冲突' | '已失效' | '失败'
export type FieldItemKind = '缺陷' | '复检结论'

/** 现场录入的缺陷（尚未生成台账缺陷编号） */
export interface FieldDefectInput {
  position: number
  type: string
  length: number
  level: DefectLevel
  method: string
  report: string
}

/** 现场批次中的一条结果项：缺陷记录或复检结论 */
export interface FieldItem {
  id: string
  weldId: string
  kind: FieldItemKind
  defect?: FieldDefectInput
  conclusion?: WeldStatus
  note?: string
}

/**
 * 现场离线批次：检测员在工地断网时暂存缺陷与复检结论，联网后导入主台账。
 * baseVersion 为现场采集时的台账版本，用于判断晚到结果是否已被签字版本超越。
 */
export interface FieldBatch {
  id: string
  source: string
  inspector: string
  capturedAt: string
  importedAt: string
  baseVersion: number
  status: FieldBatchStatus
  items: FieldItem[]
  retryCount: number
  failureReason?: string
  mergedAt?: string
}

export type ConflictReason = '锁定快照' | '版本过期'
export type ConflictResolution = '待处理' | '采用现场值' | '保留台账值'

/**
 * 合并冲突：焊缝已进入锁定快照时，现场批次不自动覆盖，
 * 列在审核页等待负责人选择采用现场值或保留台账值。
 */
export interface MergeConflict {
  id: string
  batchId: string
  batchCode: string
  weldId: string
  weldComponent: string
  reason: ConflictReason
  fieldLabel: string
  fieldValue: string
  ledgerValue: string
  resolution: ConflictResolution
  decidedBy?: string
  decidedAt?: string
  item: FieldItem
}

/** 合并裁决所需的台账结构（结构类型，避免 service 与 store 循环依赖） */
export interface MergeEvalState {
  welds: Weld[]
  locked: boolean
  version: number
  signedVersion: number
}
