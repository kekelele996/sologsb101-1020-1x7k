/**
 * 传拓工单对账逻辑（纯函数）
 * 工单与拓本各留各的记录，通过 Rubbing.workOrderId 关联。
 * 对账核对两件事：
 *   1. 拓法是否一致（工单拓法 vs 挂单拓本的实际拓法）
 *   2. 张数是否一致（计划拓数 vs 实际挂单拓本数）
 * 相符 → 已对账；不符 → 已挂起并写明原因。
 */
import type { Rubbing } from '@/types/rubbing';
import { RUBBING_METHOD_LABEL } from '@/types/rubbing';
import type { WorkOrder } from '@/types/workOrder';

export interface ReconcileResult {
  /** 是否全部相符 */
  ok: boolean;
  /** 拓法不符的拓本（实际拓法 ≠ 工单拓法） */
  methodMismatches: Rubbing[];
  /** 张数是否不符 */
  countMismatch: boolean;
  /** 实际挂单拓本数 */
  actualCount: number;
  /** 计划拓数 */
  plannedCount: number;
  /** 挂起原因（相符时为空串） */
  reason: string;
}

/** 取某工单下挂单的拓本 */
export function rubbingsOfOrder(order: WorkOrder, rubbings: Rubbing[]): Rubbing[] {
  return rubbings.filter((rubbing) => rubbing.workOrderId === order.id);
}

/** 对账：核对拓法与张数，返回明细与原因 */
export function reconcileOrder(order: WorkOrder, rubbings: Rubbing[]): ReconcileResult {
  const attached = rubbingsOfOrder(order, rubbings);
  const methodMismatches = attached.filter((rubbing) => rubbing.method !== order.method);
  const actualCount = attached.length;
  const countMismatch = actualCount !== order.plannedCount;
  const ok = methodMismatches.length === 0 && !countMismatch;

  const reasons: string[] = [];
  if (countMismatch) {
    reasons.push(`计划拓数 ${order.plannedCount} 张，实际到拓 ${actualCount} 张`);
  }
  if (methodMismatches.length > 0) {
    const detail = methodMismatches
      .map((rubbing) => `第 ${rubbing.versionNo} 版为${RUBBING_METHOD_LABEL[rubbing.method]}`)
      .join('、');
    reasons.push(`工单拓法为${RUBBING_METHOD_LABEL[order.method]}，${detail}`);
  }

  return {
    ok,
    methodMismatches,
    countMismatch,
    actualCount,
    plannedCount: order.plannedCount,
    reason: ok ? '' : reasons.join('；'),
  };
}
