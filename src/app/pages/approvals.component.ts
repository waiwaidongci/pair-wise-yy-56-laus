import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Store } from '@ngrx/store'
import { ButtonModule } from 'primeng/button'
import { TimelineModule } from 'primeng/timeline'
import { TagModule } from 'primeng/tag'
import { TableModule } from 'primeng/table'
import { WeldState } from '../store/weld.reducer'
import * as A from '../store/weld.actions'

@Component({
  selector:'app-approvals', standalone:true, imports:[CommonModule,ButtonModule,TimelineModule,TagModule,TableModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">签字、版本与追溯</p><h1>逐段确认与锁定</h1><p>审核人按焊缝或检测计划确认、退回或要求复检；锁定后生成只读版本快照。</p></div><p-button [label]="state.locked ? '已锁定' : '签字锁定检测批次'" icon="pi pi-lock" [disabled]="state.locked" (onClick)="lock()" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">待审核焊缝</h2><div class="review" *ngFor="let weld of reviewWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.method}} · {{weld.welder}} · 返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" [severity]="weld.status === '待复检' ? 'warn' : 'danger'" /><p-button label="要求复检" severity="danger" text size="small" /><p-button label="确认合格" size="small" (onClick)="confirm(weld.id)" /></div><p-button label="导出质量追溯包" icon="pi pi-file-export" severity="secondary" styleClass="w-full" /></section>
      <aside class="card"><h2 class="panel-title">完整审计时间线</h2><p-timeline [value]="state.audit" align="left"><ng-template #content let-event><div class="audit"><div><b>{{event.actor}} · {{event.action}}</b><span>{{event.time}}</span></div><p><strong>{{event.target}}</strong> {{event.detail}}</p></div></ng-template></p-timeline></aside></div>

      <section class="card mt-4"><h2 class="panel-title">合并冲突裁决（现场批次 × 锁定快照）</h2><p class="hint">焊缝已进入锁定快照后，现场批次不自动覆盖，冲突逐条列出由负责人裁决：<b>采用现场值</b>或<b>保留台账值</b>。检测比例与返修次数暂不更新。</p>
        <p-table [value]="pendingConflicts" [paginator]="true" [rows]="5"><ng-template #header><tr><th>冲突编号</th><th>批次</th><th>焊缝</th><th>原因</th><th>现场值</th><th>台账值</th><th>操作</th></tr></ng-template><ng-template #body let-c><tr><td>{{c.id}}</td><td>{{c.batchCode}}</td><td><b>{{c.weldId}}</b><small class="block">{{c.weldComponent}}</small></td><td><p-tag [value]="c.reason" severity="warn" /></td><td>{{c.fieldLabel}} · {{c.fieldValue}}</td><td>{{c.ledgerValue}}</td><td class="ops"><p-button label="采用现场值" size="small" (onClick)="resolve(c.id,'采用现场值')" /><p-button label="保留台账值" size="small" severity="secondary" (onClick)="resolve(c.id,'保留台账值')" /></td></tr></ng-template></p-table>
        <p class="muted" *ngIf="!pendingConflicts.length">暂无待裁决冲突。锁定台账后导入的现场批次会在此列出。</p>
        <div class="resolved" *ngIf="resolvedConflicts.length"><h3>已裁决记录</h3><div class="resolved-row" *ngFor="let c of resolvedConflicts"><span><b>{{c.id}}</b> · {{c.weldId}} · {{c.fieldLabel}}</span><p-tag [value]="c.resolution" [severity]="c.resolution === '采用现场值' ? 'success' : 'info'" /><small>{{c.decidedBy}} · {{c.decidedAt}}</small></div></div>
      </section>

      <section class="card mt-4"><h2 class="panel-title">版本快照</h2><div class="snapshot"><div><b>v{{state.version}}</b><small>当前工作版本 · {{state.welds.length}} 条焊缝 · {{state.plans.length}} 个检测计划</small></div><p-tag [value]="state.locked ? '已签字锁定' : '可编辑'" [severity]="state.locked ? 'success' : 'warn'" /><p-button label="查看差异" text /></div><p>版本快照记录焊缝状态、缺陷、返修方案、附件哈希和签字人。任何后续修改必须从当前版本派生新修订，不覆盖原始检测记录。</p></section>
    </main>
  `,
  styles:[`.review{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:12px 0;border-bottom:1px solid #edf0f5}.review b,.review small{display:block}.review small{color:#7a8798;margin-top:4px}.audit{background:#fff;border:1px solid #e1e7ef;border-radius:6px;padding:10px}.audit>div{display:flex;justify-content:space-between}.audit span{color:#7a8798;font-size:12px}.audit p{margin:5px 0 0;font-size:13px}.snapshot{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:12px;background:#f8fafc;border-radius:6px}.snapshot b,.snapshot small{display:block}.snapshot small{color:#7a8798;margin-top:4px}.mt-4{margin-top:16px}.hint{color:#475467;font-size:13px;line-height:1.7;margin:0 0 12px}.hint b{color:#b42318}.block{display:block;color:#7a8798;margin-top:3px}.ops{white-space:nowrap}.ops .p-button{margin-right:4px}.muted{color:#7a8798;font-size:13px;margin:10px 0 0}.resolved{margin-top:14px;border-top:1px dashed #e1e7ef;padding-top:10px}.resolved h3{font-size:14px;margin:0 0 8px;color:#475467}.resolved-row{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:6px 0;font-size:13px}.resolved-row small{color:#7a8798}@media(max-width:760px){.review{grid-template-columns:1fr auto}.review .p-button{width:100%}.resolved-row{grid-template-columns:1fr}}`],
})
export class ApprovalsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get reviewWelds() { return (this.state?.welds ?? []).filter((item) => ['待复检','返修中','待检测'].includes(item.status)) }
  get pendingConflicts() { return (this.state?.conflicts ?? []).filter((c) => c.resolution === '待处理') }
  get resolvedConflicts() { return (this.state?.conflicts ?? []).filter((c) => c.resolution !== '待处理') }
  confirm(id: string) { this.store.dispatch(A.advanceWeld({ id, status:'合格' })) }
  lock() { this.store.dispatch(A.lockBaseline()) }
  resolve(conflictId: string, resolution: '采用现场值' | '保留台账值') {
    this.store.dispatch(A.resolveConflict({ conflictId, resolution, actor: '质量负责人' }))
  }
}
