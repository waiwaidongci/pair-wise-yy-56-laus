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
import * as A from '../store/weld.actions'
import type { FieldBatch } from '../types'

function timeLabel() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** 与初始演示批次保持一致，用于演示“同一批次重复导入只处理一次” */
const DUPLICATABLE_BATCH: FieldBatch = {
  id: 'BATCH-SITE-01', createdAt: '09:42', inspector: '陈锋', online: true,
  records: [
    { id: 'FR-01', weldId: 'W-109', kind: '缺陷', baseVersion: 11, capturedAt: '09:36', inspector: '陈锋', defect: { position: 42, type: '未熔合', length: 9, level: 'Ⅲ级', method: 'UT', report: 'UT-SITE-0942；断网暂存，NB/T 47013.3 评定。' } },
    { id: 'FR-02', weldId: 'W-104', kind: '复检结论', baseVersion: 11, capturedAt: '09:40', inspector: '陈锋', conclusion: '合格', note: '返修部位 UT 复检合格' },
  ],
}

@Component({
  selector:'app-inspections', standalone:true, imports:[CommonModule,FormsModule,TableModule,TagModule,ButtonModule,DialogModule,InputTextModule,TextareaModule,SelectButtonModule],
  template:`
    <main class="page"><div class="page-head"><div><p class="eyebrow">NDT / 返修闭环</p><h1>检测计划与返修</h1><p>工地断网时缺陷与复检结论先存现场批次，联网后合并主台账；冲突由负责人仲裁。</p></div><p-button label="新增检测结果" icon="pi pi-plus" (onClick)="dialog = true" /></div>

      <section class="card"><div class="sync-head"><div><h2 class="panel-title">现场批次（断网暂存）</h2><p>已签字基线 <b>v{{state.signedVersion}}</b><span class="dot"></span>待合并 <b>{{state.fieldBatches.length}}</b> 批<span class="dot"></span>上次合并 {{state.lastSyncAt || '—'}}</p></div><div class="sync-actions"><p-button label="联网后合并全部" icon="pi pi-wifi" [disabled]="!state.fieldBatches.length" (onClick)="syncAll()" /><p-button label="模拟本次合并失败" icon="pi pi-cloud-slash" severity="warn" [disabled]="!state.fieldBatches.length" (onClick)="syncWithFailure()" /><p-button label="重复导入批次 01" icon="pi pi-copy" severity="secondary" (onClick)="reimportDuplicate()" /></div></div>
        <p-table [value]="state.fieldBatches" [paginator]="true" [rows]="4"><ng-template #header><tr><th>现场批次</th><th>检测员 / 时间</th><th>焊缝结果（依据签字版本）</th><th>网络</th></tr></ng-template><ng-template #body let-batch><tr><td><b>{{batch.id}}</b><small class="block">{{batch.records.length}} 条结果</small></td><td>{{batch.inspector}}<small class="block">{{batch.createdAt}}</small></td><td><span class="rec" *ngFor="let rec of batch.records">{{rec.weldId}} · {{rec.kind}} <em>v{{rec.baseVersion}}</em></span></td><td><p-tag [value]="batch.online ? '已联网' : '断网暂存'" [severity]="batch.online ? 'success' : 'danger'" /></td></tr></ng-template><ng-template #emptymessage><tr><td colspan="4" class="empty">现场队列已清空，所有批次均已处理或挂起审核。</td></tr></ng-template></p-table>
        <p class="rules">合并规则：同一批次只处理一次；晚于记录的签字更新会让旧结果失效且不覆盖；命中锁定快照的冲突列在审核页等待负责人选择；<b>检测比例与返修次数在合并阶段暂不更新</b>。</p>
      </section>

      <div class="grid-2"><section class="card"><h2 class="panel-title">批量检测计划</h2><p-table [value]="state.plans" [paginator]="true" [rows]="6"><ng-template #header><tr><th>计划编号</th><th>日期</th><th>方法</th><th>焊缝</th><th>检测人</th><th>状态</th></tr></ng-template><ng-template #body let-plan><tr><td>{{plan.id}}</td><td>{{plan.date}}</td><td>{{plan.method}}</td><td>{{plan.weldIds.length}} 条</td><td>{{plan.inspector}}</td><td><p-tag [value]="plan.state" [severity]="plan.state === '已完成' ? 'success' : plan.state === '执行中' ? 'info' : 'warn'" /></td></tr></ng-template></p-table><p-button label="开始执行计划" icon="pi pi-play" styleClass="mt-3" /></section>
      <aside class="card"><h2 class="panel-title">返修状态流转</h2><div class="step" *ngFor="let weld of repairWelds"><div><b>{{weld.id}} · {{weld.component}}</b><small>{{weld.defects.length}} 个缺陷 · 已返修 {{weld.repairs}} 次</small></div><p-tag [value]="weld.status" severity="warn" /><p-selectbutton [options]="['返修中','待复检','合格']" [ngModel]="weld.status" (ngModelChange)="advance(weld.id,$event)" /></div><p-button label="提交质量负责人审核" icon="pi pi-send" styleClass="w-full" /></aside></div>
      <section class="card mt-4"><h2 class="panel-title">检测结果与缺陷明细</h2><p-table [value]="defects" [paginator]="true" [rows]="8"><ng-template #header><tr><th>缺陷编号</th><th>焊缝</th><th>位置 / 长度</th><th>类型 / 等级</th><th>检测方法</th><th>报告</th><th>处置</th></tr></ng-template><ng-template #body let-item><tr><td>{{item.defect.id}}</td><td>{{item.weld.id}}</td><td>{{item.defect.position}}% · {{item.defect.length}}mm</td><td>{{item.defect.type}} · {{item.defect.level}}</td><td>{{item.defect.method}}</td><td>{{item.defect.report}}</td><td><p-button label="退回方案" severity="danger" size="small" text /><p-button label="确认复检" size="small" (onClick)="advance(item.weld.id,'合格')" /></td></tr></ng-template></p-table></section>
      <p-dialog header="录入检测结果（断网先存现场批次）" [(visible)]="dialog" [modal]="true" [style]="{width:'620px'}"><div class="form"><label>焊缝编号</label><input pInputText [(ngModel)]="form.weldId" /><label>检测方法</label><select [(ngModel)]="form.method"><option>UT</option><option>MT</option><option>PT</option></select><label>缺陷位置（0–100%）</label><input pInputText type="number" [(ngModel)]="form.position" /><label>缺陷类型与等级</label><input pInputText [(ngModel)]="form.type" placeholder="如：未熔合 / Ⅲ级" /><label>报告编号与说明</label><textarea pTextarea [(ngModel)]="form.report" rows="4"></textarea><p class="muted">结果先写入现场批次并本地留存，基线版本 v{{state.signedVersion}}，联网后在上方统一合并。</p></div><ng-template #footer><p-button label="取消" severity="secondary" (onClick)="dialog=false" /><p-button label="存入现场批次" [disabled]="!form.weldId || !form.report" (onClick)="submit()" /></ng-template></p-dialog>
    </main>
  `,
  styles:[`.sync-head{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.sync-head p{margin:6px 0 0;color:#7a8798;font-size:13px;display:flex;align-items:center}.sync-head b{color:#1e293b}.dot{width:4px;height:4px;border-radius:50%;background:#cbd5e1;margin:0 10px}.sync-actions{display:flex;gap:8px;flex-wrap:wrap}.rec{display:inline-block;background:#f1f5f9;border-radius:4px;padding:2px 8px;margin:0 6px 4px 0;font-size:12px}.rec em{color:#7c3aed;font-style:normal;margin-left:4px}.rules{margin:10px 0 0;padding:10px 12px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px;font-size:13px;color:#7a5b12}.empty{padding:18px 0;color:#7a8798}.step{display:grid;grid-template-columns:1fr auto;gap:9px;padding:12px 0;border-bottom:1px solid #edf0f5}.step>div,.step small{display:block}.step small{color:#7a8798;margin-top:4px}.step p-selectbutton{grid-column:1/-1}.form{display:grid;gap:9px}.form input,.form select,.form textarea{padding:9px;border:1px solid #cbd5e1;border-radius:6px;width:100%}.muted{color:#7a8798;font-size:12px}.mt-3{margin-top:12px}.mt-4{margin-top:16px}`],
})
export class InspectionsComponent {
  private readonly store = inject(Store<{ welds: WeldState }>)
  state!: WeldState
  dialog = false
  form = { weldId:'W-109', method:'UT', position:42, type:'未熔合 / Ⅲ级', report:'UT-2026-0929-08；按 NB/T 47013.3 评定。' }
  constructor() { this.store.select('welds').subscribe((state) => this.state = state) }
  get repairWelds() { return (this.state?.welds ?? []).filter((item) => ['返修中','待复检'].includes(item.status)) }
  get defects() { return (this.state?.welds ?? []).flatMap((weld) => weld.defects.map((defect) => ({ weld, defect }))) }
  advance(id: string, status: string) { this.store.dispatch(A.advanceWeld({ id, status: status as never })) }

  /** 联网后把现场队列中的批次全部合并到主台账 */
  syncAll() {
    const ids = this.state.fieldBatches.map((batch) => batch.id)
    if (ids.length) this.store.dispatch(A.syncFieldBatches({ batchIds: ids }))
  }

  /** 模拟首条批次本次合并失败：批次保留在现场队列，可随后再点“联网后合并全部”重试 */
  syncWithFailure() {
    const first = this.state.fieldBatches[0]
    if (first) this.store.dispatch(A.syncFieldBatches({ batchIds: [first.id], failBatchIds: [first.id] }))
  }

  /** 重复导入同一批次：已处理过则只做幂等跳过，不会二次写入 */
  reimportDuplicate() {
    this.store.dispatch(A.queueFieldBatch({ batch: DUPLICATABLE_BATCH }))
    this.store.dispatch(A.syncFieldBatches({ batchIds: [DUPLICATABLE_BATCH.id] }))
  }

  /** 断网录入：缺陷先存现场批次（本地持久化），不直接写主台账 */
  submit() {
    const [type, level] = this.form.type.split('/').map((part) => part.trim())
    const stamp = Date.now().toString().slice(-5)
    this.store.dispatch(A.queueFieldBatch({
      batch: {
        id: `BATCH-SITE-${stamp}`,
        createdAt: timeLabel(),
        inspector: '陈锋',
        online: false,
        records: [{
          id: `FR-${stamp}`,
          weldId: this.form.weldId,
          kind: '缺陷',
          baseVersion: this.state.signedVersion,
          capturedAt: timeLabel(),
          inspector: '陈锋',
          defect: { position: Number(this.form.position) || 0, type: type || this.form.type, length: 10, level: (level as never) || 'Ⅲ级', method: this.form.method, report: this.form.report },
        }],
      },
    }))
    this.dialog = false
  }
}
