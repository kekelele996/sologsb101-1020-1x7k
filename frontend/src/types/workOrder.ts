/**
 * 传拓工单（WorkOrder）数据模型
 * 传拓组开单：写明哪块碑、哪天、什么拓法、拓了几张。
 * 工单与拓本各留各的记录，通过 Rubbing.workOrderId 关联；
 * 拓本登记后须与工单对账，相符才算编目完成，不符则挂起写明原因，
 * 传拓组改单后退回待复核。
 */
import type { RubbingMethod } from './rubbing';

/** 工单状态：待对账 / 已挂起 / 待复核 / 已对账 */
export type WorkOrderState = 'pending' | 'held' | 'review' | 'reconciled';

export interface WorkOrder {
  id: string;
  /** 所属碑刻 id */
  steleId: string;
  /** 传拓日期 yyyy-MM-dd */
  date: string;
  /** 拓法（工单登记的拓法，对账时与拓本实际拓法比对） */
  method: RubbingMethod;
  /** 计划拓数（对账时与实际挂单拓本数比对） */
  plannedCount: number;
  /** 工单状态 */
  state: WorkOrderState;
  /** 挂起原因（张数或拓法不符时填写，待复核时保留作参考） */
  holdReason: string;
  /** 开单人 / 传拓组 */
  operator: string;
  /** 备注 */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export type WorkOrderDraft = Omit<WorkOrder, 'id' | 'createdAt' | 'updatedAt'>;

export const WORK_ORDER_STATE_LABEL: Record<WorkOrderState, string> = {
  pending: '待对账',
  held: '已挂起',
  review: '待复核',
  reconciled: '已对账',
};

export const WORK_ORDER_STATE_COLOR: Record<WorkOrderState, string> = {
  pending: '#8c8c8c',
  held: '#b03a2e',
  review: '#c9963c',
  reconciled: '#2f6f4f',
};

export const WORK_ORDER_STATE_OPTIONS: ReadonlyArray<{ value: WorkOrderState; label: string }> = [
  { value: 'pending', label: '待对账' },
  { value: 'held', label: '已挂起' },
  { value: 'review', label: '待复核' },
  { value: 'reconciled', label: '已对账' },
];

export function createEmptyWorkOrderDraft(steleId: string): WorkOrderDraft {
  return {
    steleId,
    date: new Date().toISOString().slice(0, 10),
    method: 'rub',
    plannedCount: 1,
    state: 'pending',
    holdReason: '',
    operator: '',
    note: '',
  };
}
