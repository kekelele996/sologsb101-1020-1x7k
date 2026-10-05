/**
 * 传拓工单（WorkOrder）数据模型
 * 碑林传拓组开工时填写：哪块碑、哪天、什么拓法、计划拓几张、传拓人。
 * 拓片送到编目室后，编目员登记拓本时把拓本挂到对应工单上做对账。
 */
import type { RubbingMethod } from './rubbing';

export interface WorkOrder {
  id: string;
  /** 工单号，如 GD20261005-01 */
  orderNo: string;
  /** 所拓碑刻 id */
  steleId: string;
  /** 传拓日期 yyyy-MM-dd */
  rubDate: string;
  /** 工单所载拓法：擦拓 / 扑拓 / 蝉翼拓 */
  method: RubbingMethod;
  /** 计划传拓张数 */
  plannedCount: number;
  /** 传拓人（传拓组） */
  operator: string;
  /** 备注（用纸、操作要点等） */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export type WorkOrderDraft = Omit<WorkOrder, 'id' | 'createdAt' | 'updatedAt'>;

/** 按日期生成工单号：GD + yyyyMMdd + 当日序号，如 GD20261005-01 */
export function nextOrderNo(existing: ReadonlyArray<Pick<WorkOrder, 'orderNo'>>, date: string): string {
  const dayPart = date.replace(/-/g, '');
  const prefix = `GD${dayPart}-`;
  const seq =
    existing.reduce((max, order) => {
      if (!order.orderNo.startsWith(prefix)) return max;
      const tail = Number.parseInt(order.orderNo.slice(prefix.length), 10);
      return Number.isFinite(tail) ? Math.max(max, tail) : max;
    }, 0) + 1;
  return `${prefix}${String(seq).padStart(2, '0')}`;
}

export function todayText(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createEmptyWorkOrderDraft(steleId: string): WorkOrderDraft {
  return {
    orderNo: '',
    steleId,
    rubDate: todayText(),
    method: 'rub',
    plannedCount: 1,
    operator: '',
    note: '',
  };
}
