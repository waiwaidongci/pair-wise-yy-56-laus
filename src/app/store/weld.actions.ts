import { createAction, props } from '@ngrx/store'
import type { FieldBatch, InspectionPlan, Weld, WeldStatus } from '../types'

export const loadWelds = createAction('[Weld] Load')
export const loadWeldsSuccess = createAction('[Weld API] Load Success', props<{ welds: Weld[]; plans: InspectionPlan[] }>())
export const selectWeld = createAction('[Weld] Select', props<{ id: string }>())
export const filterStatus = createAction('[Weld] Filter Status', props<{ status: string }>())
export const advanceWeld = createAction('[Weld] Advance', props<{ id: string; status: WeldStatus }>())
export const createPlan = createAction('[Inspection] Create Plan', props<{ plan: InspectionPlan }>())
export const lockBaseline = createAction('[Approval] Lock Baseline')

/** 断网时把焊缝缺陷 / 复检结论存为现场批次 */
export const queueFieldBatch = createAction('[Field] Queue Batch', props<{ batch: FieldBatch }>())
/** 联网后把指定现场批次合并到主台账；failBatchIds 模拟本次合并失败、保留重试 */
export const syncFieldBatches = createAction(
  '[Field] Sync Batches',
  props<{ batchIds: string[]; failBatchIds?: string[] }>(),
)
/** 负责人在审核页对锁定冲突做出选择 */
export const resolveSyncConflict = createAction(
  '[Approval] Resolve Sync Conflict',
  props<{ conflictId: string; choice: '采用现场结果' | '保留快照版本' }>(),
)
