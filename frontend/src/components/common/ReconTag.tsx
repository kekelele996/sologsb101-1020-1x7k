/**
 * <ReconTag> 工单对账状态标签
 * 待对账 / 已挂起 / 待复核 / 对账相符；挂起与复核时悬浮显示不符原因。
 * 被拓本登记页、传拓工单台、编目卡导出页消费。
 */
import { Tag, Tooltip, Typography } from 'antd';
import { RECON_STATUS_COLOR, RECON_STATUS_LABEL, type ReconStatus } from '@/types/recon';

export interface ReconTagProps {
  status: ReconStatus;
  /** 不符原因（实时核算），存在时以悬浮提示展示 */
  reason?: string;
  /** 工单号（可选，拼进提示） */
  orderNo?: string;
  size?: 'default' | 'small';
}

export function ReconTag({ status, reason, orderNo, size = 'default' }: ReconTagProps) {
  const tag = (
    <Tag color={RECON_STATUS_COLOR[status]} style={{ marginInlineEnd: 4, fontSize: size === 'small' ? 12 : undefined }}>
      {RECON_STATUS_LABEL[status]}
    </Tag>
  );

  const lines: string[] = [];
  if (orderNo) lines.push(`工单 ${orderNo}`);
  if (reason) lines.push(reason);

  if (lines.length === 0) return tag;
  return (
    <Tooltip
      title={
        <div style={{ maxWidth: 320 }}>
          {lines.map((line) => (
            <div key={line}>
              <Typography.Text style={{ color: '#fff', fontSize: 12 }}>{line}</Typography.Text>
            </div>
          ))}
        </div>
      }
    >
      {tag}
    </Tooltip>
  );
}

export default ReconTag;
