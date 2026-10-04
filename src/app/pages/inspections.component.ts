import { Component, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Store } from '@ngrx/store'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TextareaModule } from 'primeng/textarea'
import { SelectButtonModule } from 'primeng/selectbutton'
import { WeldState } from '../store/weld.reducer'
import { FieldBatchService } from '../services/field-batch.service'
import * as A from '../store/weld.actions'
import type { FieldBatchStatus } from '../types'

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与返修</h1><p>检测结果绑定缺陷位置、等级、照片、报告和返修方案；失败与复检不可无痕跳过。</p></div><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="dialog = true" /></div>
      <div class="grid-2"><section class="card"><h2 class="panel-title">批量检测计划</h2><p-table [value]="state.plans" [paginator]="true" [rows]="6"><ng-template #header><tr><th>计划编号</th><th>日期</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th></tr></ng-template><ng-template #body let-plan><tr><td>{{plan.id}}</td><td>{{plan.date}}</td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td>{{plan.inspector}}</td><td><p-tag [value]="plan.state" [severity]="plan.state === '已完成' ? 'success' : plan.state === '执行中' ? 'info' : 'warn'" /></td></tr></ng-template></p-table><p-button label="开始执行计划" icon="pi pi-play" styleClass="mt-3" /></section>
      <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let weld of repairWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" /></div><p-button label="提交质量负责人审核" icon="pi pi-send" styleClass="w-full" /></aside></div>

      <section class="card mt-4"><h2 class="panel-title">现场离线批次（断网暂存 · 联网合并）</h2><p class="hint">工地断网时在移动端暂存缺陷与复检结论，联网后导入合并。<b>合并失败保留批次并重试；同一批次重复导入只处理一次；晚到的旧结果遇签字版本更新即失效；锁定快照内的焊缝冲突转审核页裁决。检测比例与返修次数暂不更新。</b></p>
        <div class="batch-actions"><p-button label="导入现场批次文件" icon="pi pi-upload" (onClick)="openImport()" /><p-button label="模拟可合并批次" icon="pi pi-bolt" severity="secondary" (onClick)="mock('online')" /><p-button label="模拟锁定后批次" icon="pi pi-lock" severity="secondary" (onClick)="mock('locked')" /><p-button label="模拟过期批次" icon="pi pi-history" severity="secondary" (onClick)="mock('stale')" /></div>
        <p-table [value]="state.fieldBatches" [paginator]="true" [rows]="5"><ng-template #header><tr><th>批次编号</th><th>采集人</th><th>采集时间</th><th>台账版本</th><th>项目</th><th>状态</th><th>重试</th><th>操作</th></tr></ng-template><ng-template #body let-batch><tr><td>{{batch.id}}<small class="block">{{batch.source}}</small></td><td>{{batch.inspector}}</td><td>{{batch.capturedAt}}</td><td>v{{batch.baseVersion}}<small class="block" *ngIf="state.locked && batch.baseVersion <= state.signedVersion">签字 v{{state.signedVersion}}</small></td><td>{{batch.items.length}} 项<small class="block">{{itemKinds(batch)}}</small></td><td><p-tag [value]="batch.status" [severity]="batchTag(batch.status)" /></td><td>{{batch.retryCount}} 次<small class="block fail-reason" *ngIf="batch.failureReason" [title]="batch.failureReason">{{batch.failureReason}}</small></td><td class="ops"><p-button *ngIf="batch.status === '待合并'" label="合并" size="small" (onClick)="merge(batch.id)" /><p-button *ngIf="batch.status === '失败'" label="重试" size="small" severity="warn" (onClick)="retry(batch.id)" /><p-button *ngIf="batch.status === '已失效' || batch.status === '失败'" label="移除" size="small" text severity="secondary" (onClick)="dismiss(batch.id)" /></td></tr></ng-template></p-table>
        <p class="muted" *ngIf="!state.fieldBatches.length">暂无现场批次。断网时在移动端暂存，联网后导入合并。</p>
      </section>

      <section class="card mt-4"><h2 class="panel-title">检测结果与缺陷明细</h2><p-table [value]="defects" [paginator]="true" [rows]="8"><ng-template #header><tr><th>缺陷编号</th><th>焊缝</th><th>位置 / 长度</th><th>类型 / 等级</th><th>检测方法</th><th>报告</th><th>处置</th></tr></ng-template><ng-template #body let-item><tr><td>{{item.defect.id}}</td><td>{{item.weld.id}}</td><td>{{item.defect.position}}% · {{item.defect.length}}mm</td><td>{{item.defect.type}} · {{item.defect.level}}</td><td>{{item.defect.method}}</td><td>{{item.defect.report}}</td><td><p-button label="退回方案" severity="danger" size="small" text /><p-button label="确认复检" size="small" (onClick)="advance(item.weld.id,'合格')" /></td></tr></ng-template></p-table></section>
      <p-dialog header="录入检测结果" [(visible)]="dialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>焊缝编号</label><input pInputText [(ngModel)]="form.weldId" /><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option></select><label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="form.position" /><label>缺陷类型与等级</label><input pInputText [(ngModel)]="form.type" placeholder="如：未熔合 / Ⅲ级" /><label>报告编号与说明</label><textarea pTextarea [(ngModel)]="form.report" rows="4"></textarea></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="提交结果" [disabled]="!form.weldId || !form.report" (onClick)="submit()" /></ng-template></p-dialog>
      <p-dialog header="导入现场离线批次" [(visible)]="importDialog" [modal]="true" [style]="{width:'640px'}"><div class="form"><label>批次文件（.json，工地移动端导出）</label><input type="file" accept="application/json,.json" (change)="onFile($event)" /><label>或粘贴批次内容</label><textarea pTextarea [(ngModel)]="importRaw" rows="9" placeholder='{"id":"FB-2026-1004-01","inspector":"赵岚","baseVersion":12,"items":[{"weldId":"W-104","kind":"复检结论","conclusion":"合格"}]}'></textarea><p class="error" *ngIf="importError">{{importError}}</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="importDialog = false" /><p-button label="导入并合并" (onClick)="doImport()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.mt-3{margin-top:12px}.mt-4{margin-top:16px}.hint{color:#475467;font-size:13px;line-height:1.7;margin:0 0 12px}.hint b{color:#b42318}.batch-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.block{display:block;color:#7a8798;margin-top:3px}.fail-reason{color:#b42318;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ops{white-space:nowrap}.ops .p-button{margin-right:4px}.muted{color:#7a8798;font-size:13px;margin:10px 0 0}.error{color:#b42318;font-size:13px;margin:4px 0 0}`],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  private readonly batchService = inject(FieldBatchService)
  state!: WeldState
  dialog = false
  importDialog = false
  importRaw = ''
  importError = ''
  form = { weldId:'W-109', method:'UT', position:42, type:'未熔合 / Ⅲ级', report:'UT-2026-0929-08；按 NB/T 47013.3 评定。' }
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get repairWelds() { return (this.state?.welds ?? []).filter((item) => ['返修中','待复检'].includes(item.status)) }
  get defects() { return (this.state?.welds ?? []).flatMap((weld) => weld.defects.map((defect) => ({ weld, defect }))) }
  advance(id: string, status: string) { this.store.dispatch(A.advanceWeld({ id, status: status as never })) }
  submit() { this.store.dispatch(A.advanceWeld({ id:this.form.weldId, status:'返修中' })); this.dialog = false }

  itemKinds(batch: { items: { kind: string }[] }) { return batch.items.map((i) => i.kind).join(' · ') }
  batchTag(status: FieldBatchStatus) {
    return status === '已合并' ? 'success' : status === '冲突' ? 'warn' : status === '已失效' || status === '失败' ? 'danger' : 'info'
  }
  merge(id: string) { this.store.dispatch(A.mergeFieldBatch({ id })) }
  retry(id: string) { this.store.dispatch(A.retryFieldBatch({ id })) }
  dismiss(id: string) { this.store.dispatch(A.dismissFieldBatch({ id })) }
  mock(scenario: 'online' | 'locked' | 'stale') {
    const batch = this.batchService.mockBatch(this.state, scenario)
    this.store.dispatch(A.importFieldBatch({ batch }))
    this.store.dispatch(A.mergeFieldBatch({ id: batch.id }))
  }
  openImport() { this.importRaw = ''; this.importError = ''; this.importDialog = true }
  onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { this.importRaw = String(reader.result ?? '') }
    reader.readAsText(file)
  }
  doImport() {
    const result = this.batchService.parseImport(this.importRaw, this.state)
    if ('error' in result) { this.importError = result.error; return }
    this.store.dispatch(A.importFieldBatch({ batch: result.batch }))
    this.store.dispatch(A.mergeFieldBatch({ id: result.batch.id }))
    this.importDialog = false
  }
}
