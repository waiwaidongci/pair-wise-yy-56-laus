import { createAction, props } from '@ngrx/store'
import type { ConflictResolution, FieldBatch, InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')

/** 导入现场离线批次（断网暂存 → 联网合并），同批次重复导入只处理一次 */
export const importFieldBatch = createAction('[Field Batch] Import', props<{ batch: FieldBatch }>())
/** 联网后合并现场批次到主台账 */
export const mergeFieldBatch = createAction('[Field Batch] Merge', props<{ id: string }>())
/** 合并失败后保留现场批次并重试 */
export const retryFieldBatch = createAction('[Field Batch] Retry', props<{ id: string }>())
/** 清理已失效 / 已失败的现场批次记录 */
export const dismissFieldBatch = createAction('[Field Batch] Dismiss', props<{ id: string }>())
/** 负责人裁决锁定快照冲突：采用现场值 / 保留台账值 */
export const resolveConflict = createAction('[Conflict] Resolve', props<{ conflictId: string; resolution: Exclude<ConflictResolution, '待处理'>; actor: string }>())
