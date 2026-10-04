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

/** 检测员在断网工地暂存的单条焊缝结果：缺陷录入或复检结论 */
export interface FieldRecord {
  id: string
  weldId: string
  kind: '缺陷' | '复检结论'
  /** 现场录入时所依据的已签字版本；晚于该版本的签字一旦产生即视为旧结果 */
  baseVersion: number
  capturedAt: string
  inspector: string
  defect?: Omit<Defect, 'id'>
  conclusion?: WeldStatus
  note?: string
}

/** 现场批次：断网累积、联网后整体提交合并 */
export interface FieldBatch {
  id: string
  createdAt: string
  inspector: string
  online: boolean
  records: FieldRecord[]
}

/** 焊缝已进入锁定快照后产生的冲突，挂起等待质量负责人在审核页选择 */
export interface SyncConflict {
  id: string
  batchId: string
  weldId: string
  recordId: string
  kind: FieldRecord['kind']
  /** 冲突时记录快照，用于仲裁展示与应用 */
  record: FieldRecord
  lockedVersion: number
  raisedAt: string
  resolved: boolean
}
