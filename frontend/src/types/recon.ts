/**
 * 工单对账（Reconciliation）数据模型
 * 一份拓本挂上工单后即有一条对账记录；编目员按工单核对张数与拓法：
 * 相符 → 对账相符（拓本才算编目完成）；不符 → 挂起并写明原因；
 * 传拓组改过工单后，原结论失效，退回待复核。
 */

/** 对账结论：待对账 / 已挂起 / 待复核 / 对账相符 */
export type ReconStatus = 'pending' | 'held' | 'recheck' | 'matched';

export interface Recon {
  id: string;
  /** 对账所依据的工单 id */
  orderId: string;
  /** 挂在该工单上的拓本 id */
  rubbingId: string;
  /** 最近一次人工对账结论（实时状态由对账引擎结合工单再派生） */
  status: Exclude<ReconStatus, 'pending'> | 'pending';
  /** 最近一次对账记录的不符原因（多条以「；」连接），相符时为空串 */
  reason: string;
  /** 最近一次对账时间戳；未对账为 null */
  checkedAt: number | null;
  /** 对账人（编目员） */
  checker: string;
  createdAt: number;
  updatedAt: number;
}

export type ReconDraft = Omit<Recon, 'id' | 'createdAt' | 'updatedAt'>;

export const RECON_STATUS_LABEL: Record<ReconStatus, string> = {
  pending: '待对账',
  held: '已挂起',
  recheck: '待复核',
  matched: '对账相符',
};

export const RECON_STATUS_COLOR: Record<ReconStatus, string> = {
  pending: '#8c8c8c',
  held: '#b03a2e',
  recheck: '#c9963c',
  matched: '#2f6f4f',
};

export const RECON_STATUS_OPTIONS: ReadonlyArray<{ value: ReconStatus; label: string }> = [
  { value: 'pending', label: '待对账' },
  { value: 'held', label: '已挂起' },
  { value: 'recheck', label: '待复核' },
  { value: 'matched', label: '对账相符' },
];

export function createEmptyReconDraft(orderId: string, rubbingId: string): ReconDraft {
  return { orderId, rubbingId, status: 'pending', reason: '', checkedAt: null, checker: '' };
}
