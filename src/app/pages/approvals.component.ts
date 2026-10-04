import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'
import type { FieldBatch } from '../types'

/** 锁定后才联网到达的晚到批次：基于当前签字版本构造，合并时应挂起为冲突 */
function buildLateLockedBatch(signedVersion: number): FieldBatch {
  return {
    id: 'BATCH-SITE-03', createdAt: '刚刚', inspector: '周磊', online: true,
    records: [
      { id: 'FR-04', weldId: 'W-112', kind: '缺陷', baseVersion: signedVersion, capturedAt: '刚刚', inspector: '周磊', defect: { position: 25, type: '表面裂纹', length: 6, level: 'Ⅱ级', method: 'MT', report: 'MT-SITE-0758；锁定后到达的现场结果。' } },
    ],
  }
}

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>审核人按焊缝或检测计划确认、退回或要求复检；锁定后生成只读版本快照，现场冲突在此仲裁。</p></div><div class="head-actions"><p-button label="模拟锁定后收到批次 03" icon="pi pi-bolt" severity="warn" [disabled]="!state.locked" (onClick)="syncLateBatch()" /><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lock()" /></div></div>

      <section class="card conflict-card"><h2 class="panel-title">合并冲突仲裁（锁定快照）</h2><p class="hint">以下现场结果命中已锁定快照，主台账未被写入，等待质量负责人逐项选择；检测比例与返修次数暂不更新。</p>
        <div class="conflict" *ngFor="let cf of state.syncConflicts"><div class="cf-main"><b>{{cf.weldId}} · {{cf.kind}}</b><small>来源 {{cf.batchId}} · 记录 {{cf.recordId}} · {{cf.record.inspector}} {{cf.raisedAt}} 提交</small><p class="cf-detail" *ngIf="cf.kind === '缺陷' && cf.record.defect">{{cf.record.defect.type}} · 位置 {{cf.record.defect.position}}% · {{cf.record.defect.length}}mm · {{cf.record.defect.level}} · {{cf.record.defect.method}} <span>{{cf.record.defect.report}}</span></p><p class="cf-detail" *ngIf="cf.kind === '复检结论'">现场复检结论：<b>{{cf.record.conclusion}}</b><span *ngIf="cf.record.defect"></span><span> {{cf.record.note || ''}}</span></p></div><div class="cf-side"><p-tag [value]="'锁定 v' + cf.lockedVersion" severity="warn" /><p-tag *ngIf="cf.resolved" value="已裁决" severity="success" /><ng-container *ngIf="!cf.resolved"><p-button label="采用现场结果" icon="pi pi-check" size="small" severity="danger" (onClick)="resolve(cf.id,'采用现场结果')" /><p-button label="保留快照版本" icon="pi pi-lock" size="small" severity="secondary" (onClick)="resolve(cf.id,'保留快照版本')" /></ng-container></div></div>
        <p class="empty" *ngIf="!state.syncConflicts.length">暂无锁定冲突。先“签字锁定”，再用右上角按钮合并晚到批次即可在此挂起。</p>
      </section>

      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside></div>
      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>已签字基线 v{{state.signedVersion}} · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。晚于签字版本录入的旧结果自动失效；锁定后到达的结果必须在此页由负责人选择，采纳时从当前版本派生新修订，不覆盖原始检测记录。</p></section>
    </main>
  `,
  styles:[`.head-actions{display:flex;gap:8px}.conflict-card{margin-bottom:16px;border-left:4px solid #f59e0b}.hint{color:#7a5b12;font-size:13px;margin:4px 0 10px}.conflict{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;padding:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;margin-bottom:10px}.cf-main b,.cf-main small{display:block}.cf-main small{color:#7a8798;margin-top:3px}.cf-detail{margin:8px 0 0;font-size:13px}.cf-detail span{color:#7a8798}.cf-side{display:flex;flex-direction:column;gap:8px;align-items:flex-end}.cf-side .p-button{margin-left:8px}.empty{color:#7a8798;padding:10px 0}.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}.conflict{grid-template-columns:1fr}.cf-side{align-items:flex-start}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格' })) }
  lock() { this.store.dispatch(A.lockBaseline()) }
  resolve(conflictId: string, choice: '采用现场结果' | '保留快照版本') {
    this.store.dispatch(A.resolveSyncConflict({ conflictId, choice }))
  }
  /** 演示：锁定后一条晚到批次联网，其结果不写入主台账而挂起到本页冲突列表 */
  syncLateBatch() {
    const batch = buildLateLockedBatch(this.state.signedVersion)
    this.store.dispatch(A.queueFieldBatch({ batch }))
    this.store.dispatch(A.syncFieldBatches({ batchIds: [batch.id] }))
  }
}
