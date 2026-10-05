/**
 * 工单对账引擎（纯函数）
 * 核对维度只有工单上的两项：张数、拓法。
 * - 张数不符：工单计划 N 张，但同碑挂在该工单上的拓本不是 N 份 → 工单下每份拓本都记此原因
 * - 拓法不符：拓本所记拓法与工单拓法不一致 → 只记到该份拓本
 * 工单在最近一次对账之后被改过（updatedAt > checkedAt）→ 原结论失效，退回待复核。
 */
import type { Recon, ReconStatus } from '@/types/recon';
import type { Rubbing } from '@/types/rubbing';
import type { WorkOrder } from '@/types/workOrder';
import { RUBBING_METHOD_LABEL } from '@/types/rubbing';

/** 对账引擎输入：一条工单 + 同碑挂在它上面的全部拓本 */
export interface OrderReconInput {
  order: WorkOrder;
  rubbings: Rubbing[];
}

/** 拓本维度的一条对账结果行 */
export interface OrderReconRow {
  orderId: string;
  rubbingId: string;
  /** 张数与拓法核对后的不符原因（去重），空数组表示相符 */
  mismatchReasons: string[];
  matched: boolean;
}

export interface OrderReconSummary {
  orderId: string;
  rows: OrderReconRow[];
  /** 张数是否相符 */
  countMatched: boolean;
  /** 整单是否全部相符 */
  allMatched: boolean;
  linkedCount: number;
  plannedCount: number;
}

/**
 * 计算一张工单下每份拓本的不符原因。
 * 张数按「同碑拓本挂此工单」的总数核对；拓法逐份核对。
 */
export function buildOrderRecon(input: OrderReconInput): OrderReconSummary {
  const { order, rubbings } = input;
  const linked = rubbings.filter((rubbing) => rubbing.orderId === order.id);
  const countMatched = linked.length === order.plannedCount;
  const countReason = countMatched
    ? ''
    : `张数不符：工单计划 ${order.plannedCount} 张，实际挂 ${linked.length} 张`;

  const rows: OrderReconRow[] = linked.map((rubbing) => {
    const reasons: string[] = [];
    if (countReason) reasons.push(countReason);
    if (rubbing.method !== order.method) {
      reasons.push(
        `拓法不符：工单为${RUBBING_METHOD_LABEL[order.method]}，拓本登记为${RUBBING_METHOD_LABEL[rubbing.method]}`,
      );
    }
    return {
      orderId: order.id,
      rubbingId: rubbing.id,
      mismatchReasons: reasons,
      matched: reasons.length === 0,
    };
  });

  return {
    orderId: order.id,
    rows,
    countMatched,
    allMatched: countMatched && rows.every((row) => row.matched),
    linkedCount: linked.length,
    plannedCount: order.plannedCount,
  };
}

/**
 * 实时对账状态：
 * - 无对账记录或还没对过 → pending 待对账
 * - 工单在最近一次对账后被改过 → recheck 待复核
 * - 其余沿用对账结论（matched / held）
 */
export function effectiveReconStatus(recon: Recon | undefined, order: WorkOrder | undefined): ReconStatus {
  if (!recon || recon.checkedAt === null) return 'pending';
  if (order && order.updatedAt > recon.checkedAt) return 'recheck';
  return recon.status === 'matched' ? 'matched' : 'held';
}

/** 实时展示的原因：已挂起时写明原因；待复核优先展示重新核算的不符项 */
export function effectiveReconReasons(
  recon: Recon | undefined,
  order: WorkOrder | undefined,
  rubbing: Rubbing | undefined,
  linkedRubbings: Rubbing[],
): string[] {
  if (!recon || !order || !rubbing) return [];
  const status = effectiveReconStatus(recon, order);
  if (status === 'matched' || status === 'pending') return [];
  const summary = buildOrderRecon({ order, rubbings: linkedRubbings });
  const row = summary.rows.find((item) => item.rubbingId === rubbing.id);
  if (row && row.mismatchReasons.length > 0) return row.mismatchReasons;
  // 已挂起且当前核算未发现不符（如拓本被删挂）时，保留人工对账时的原始原因；
  // 改单后的待复核若已无不符项则不再提示旧原因，等编目员点复核确认。
  if (status === 'held') {
    return recon.reason ? recon.reason.split('；').filter((item) => item.length > 0) : [];
  }
  return [];
}

/** 拓本侧的对账视图：拓本 id → 状态与原因 */
export interface ReconView {
  status: ReconStatus;
  reason: string;
  orderId: string | null;
  checkedAt: number | null;
}

export type ReconViewMap = Record<string, ReconView>;

/**
 * 由拓本 / 工单 / 对账记录三集合一次性构建拓本维度视图。
 * 未挂工单的拓本没有对账视图；挂了工单但记录缺失时按待对账处理。
 */
export function buildReconViewMap(
  rubbings: Rubbing[],
  orders: WorkOrder[],
  recons: Recon[],
): ReconViewMap {
  const reconByRubbing = new Map(recons.map((recon) => [recon.rubbingId, recon]));
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const linkedByOrder = new Map<string, Rubbing[]>();
  rubbings.forEach((rubbing) => {
    if (!rubbing.orderId) return;
    linkedByOrder.set(rubbing.orderId, [...(linkedByOrder.get(rubbing.orderId) ?? []), rubbing]);
  });

  const map: ReconViewMap = {};
  rubbings.forEach((rubbing) => {
    if (!rubbing.orderId) return;
    const recon = reconByRubbing.get(rubbing.id);
    const order = ordersById.get(rubbing.orderId);
    const status = effectiveReconStatus(recon, order);
    const reasons = effectiveReconReasons(recon, order, rubbing, linkedByOrder.get(rubbing.orderId) ?? []);
    map[rubbing.id] = {
      status,
      reason: reasons.join('；'),
      orderId: rubbing.orderId,
      checkedAt: recon?.checkedAt ?? null,
    };
  });
  return map;
}

/**
 * 是否允许计入「已编目」：必须挂上工单且实时对账相符。
 * 编目台据此把关，未对账 / 挂起 / 待复核的拓本一律不能算编目完成。
 */
export function isReconMatched(view: ReconView | undefined): boolean {
  return view?.status === 'matched';
}
