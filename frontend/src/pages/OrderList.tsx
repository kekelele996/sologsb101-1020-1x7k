/**
 * /orders 传拓工单台（碑林传拓组侧）
 * 开工单写明：哪块碑、哪天、什么拓法、拓几张、传拓人。
 * 工单是传拓组自己的台账：可查看挂在单上的拓本及其对账状态，但对账动作在编目室拓本登记页。
 * 传拓组改单后，已对账的拓本自动退回「待复核」，编目室复核通过才重新算编目完成。
 * 消费 WorkOrder、Recon、Rubbing、Stele；复用 <FilterBar>、<StatBadge>、<EmptyPanel>、<ReconTag>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { DeleteOutlined, EditOutlined, PlusOutlined, ProfileOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import ReconTag from '@/components/common/ReconTag';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles, setCurrentStele } from '@/stores/steleSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import {
  checkOrderRecons,
  createOrder,
  removeOrder,
  resetOrderFilters,
  selectFilteredOrders,
  selectOrders,
  selectRecons,
  setOrderKeyword,
  setOrderMethods,
  setOrderSteleFilter,
  summarizeOrderRecons,
  updateOrder,
} from '@/stores/orderSlice';
import { RUBBING_METHOD_LABEL, RUBBING_METHOD_OPTIONS, type Rubbing, type RubbingMethod } from '@/types/rubbing';
import {
  createEmptyWorkOrderDraft,
  nextOrderNo,
  type WorkOrder,
  type WorkOrderDraft,
} from '@/types/workOrder';
import { RECON_STATUS_LABEL, type ReconStatus } from '@/types/recon';
import { buildOrderRecon, buildReconViewMap, type ReconViewMap } from '@/utils/reconcile';

const FILTER_KEYS = ['method'] as const;

interface OrderFormValues extends Omit<WorkOrderDraft, 'rubDate'> {
  rubDate: Dayjs;
}

export default function OrderList() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<OrderFormValues>();

  const steles = useAppSelector(selectSteles);
  const orders = useAppSelector(selectOrders);
  const filtered = useAppSelector(selectFilteredOrders);
  const recons = useAppSelector(selectRecons);
  const rubbings = useAppSelector(selectRubbings);
  const steleFilterId = useAppSelector((state) => state.order.filters.steleId);

  const url = useFilterQuery(FILTER_KEYS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);
  const [detail, setDetail] = useState<WorkOrder | null>(null);

  useEffect(() => {
    dispatch(setOrderKeyword(url.keyword));
    dispatch(setOrderMethods((url.values.method ?? []) as RubbingMethod[]));
  }, [dispatch, url.keyword, url.values]);

  const selects: FilterSelectConfig[] = useMemo(
    () => [
      { key: 'method', label: '拓法', options: RUBBING_METHOD_OPTIONS.map((item) => ({ value: item.value, label: item.label })) },
    ],
    [],
  );

  const reconViewMap = useMemo(
    () => buildReconViewMap(rubbings, orders, recons),
    [orders, recons, rubbings],
  );

  const stat = useMemo(() => {
    const summary = summarizeOrderRecons(orders, rubbings, recons);
    return { orders: orders.length, ...summary };
  }, [orders, recons, rubbings]);

  const steleTitle = (steleId: string): string => steles.find((stele) => stele.id === steleId)?.title ?? steleId;

  /** 一张工单的实时核对结果（张数 + 每份拓本的拓法） */
  const orderSummary = (order: WorkOrder) =>
    buildOrderRecon({ order, rubbings: rubbings.filter((rubbing) => rubbing.steleId === order.steleId) });

  const openCreate = (): void => {
    const steleId = steleFilterId ?? steles[0]?.id ?? '';
    if (!steleId) {
      message.warning('请先在碑刻台账中登记碑刻');
      return;
    }
    setEditing(null);
    const rubDate = createEmptyWorkOrderDraft(steleId).rubDate;
    form.setFieldsValue({
      ...createEmptyWorkOrderDraft(steleId),
      orderNo: nextOrderNo(orders, rubDate),
      rubDate: dayjs(rubDate),
    });
    setOpen(true);
  };

  const openEdit = (order: WorkOrder): void => {
    setEditing(order);
    form.setFieldsValue({
      orderNo: order.orderNo,
      steleId: order.steleId,
      rubDate: dayjs(order.rubDate),
      method: order.method,
      plannedCount: order.plannedCount,
      operator: order.operator,
      note: order.note,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const draft: WorkOrderDraft = {
      orderNo: values.orderNo.trim(),
      steleId: values.steleId,
      rubDate: values.rubDate.format('YYYY-MM-DD'),
      method: values.method,
      plannedCount: values.plannedCount,
      operator: values.operator?.trim() ?? '',
      note: values.note?.trim() ?? '',
    };
    if (editing) {
      await dispatch(updateOrder({ id: editing.id, patch: draft })).unwrap();
      message.success(`工单 ${draft.orderNo} 已修改，相关拓本退回待复核`);
    } else {
      const created = await dispatch(createOrder(draft)).unwrap();
      dispatch(setCurrentStele(draft.steleId));
      message.success(`已开工单 ${created.orderNo}`);
    }
    setOpen(false);
  };

  const handleRemove = async (order: WorkOrder): Promise<void> => {
    const linked = rubbings.filter((rubbing) => rubbing.orderId === order.id).length;
    await dispatch(removeOrder(order.id)).unwrap();
    message.success(linked > 0 ? `已删除工单，${linked} 份拓本已摘单保留` : '已删除工单');
  };

  const handleCheckAll = async (order: WorkOrder): Promise<void> => {
    const result = await dispatch(checkOrderRecons({ orderId: order.id })).unwrap();
    if (result.held > 0) {
      message.warning(`复核完成：相符 ${result.matched} 份，挂起 ${result.held} 份`);
    } else {
      message.success(`整单复核通过，相符 ${result.matched} 份`);
    }
  };

  const detailRows = detail
    ? rubbings
        .filter((rubbing) => rubbing.orderId === detail.id)
        .sort((a, b) => a.versionNo - b.versionNo)
    : [];

  const columns: ColumnsType<WorkOrder> = [
    {
      title: '工单号',
      dataIndex: 'orderNo',
      width: 150,
      render: (value: string, record) => (
        <Button type="link" size="small" style={{ paddingInline: 0 }} onClick={() => setDetail(record)}>
          {value}
        </Button>
      ),
    },
    { title: '碑刻', dataIndex: 'steleId', width: 130, render: (value: string) => steleTitle(value) },
    { title: '传拓日期', dataIndex: 'rubDate', width: 110, sorter: (a, b) => a.rubDate.localeCompare(b.rubDate) },
    { title: '拓法', dataIndex: 'method', width: 90, render: (value: RubbingMethod) => RUBBING_METHOD_LABEL[value] },
    {
      title: '计划/实挂',
      key: 'count',
      width: 100,
      render: (_value, record) => {
        const summary = orderSummary(record);
        return (
          <Tag color={summary.countMatched ? '#2f6f4f' : '#b03a2e'}>
            {record.plannedCount} / {summary.linkedCount} 张
          </Tag>
        );
      },
    },
    { title: '传拓人', dataIndex: 'operator', width: 90, render: (value: string) => value || '未填' },
    {
      title: '对账情况',
      key: 'recon',
      render: (_value, record) => {
        const linked = rubbings
          .filter((rubbing) => rubbing.orderId === record.id)
          .sort((a, b) => a.versionNo - b.versionNo);
        if (linked.length === 0) return <Typography.Text type="secondary">尚无拓本挂单</Typography.Text>;
        const counts: Record<ReconStatus, number> = { pending: 0, held: 0, recheck: 0, matched: 0 };
        linked.forEach((rubbing) => {
          counts[reconViewMap[rubbing.id]?.status ?? 'pending'] += 1;
        });
        return (
          <Space size={4} wrap>
            {(Object.keys(counts) as ReconStatus[])
              .filter((status) => counts[status] > 0)
              .map((status) => (
                <Tag key={status} color={status === 'matched' ? '#2f6f4f' : status === 'held' ? '#b03a2e' : status === 'recheck' ? '#c9963c' : '#8c8c8c'}>
                  {RECON_STATUS_LABEL[status]} {counts[status]}
                </Tag>
              ))}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button size="small" type="link" onClick={() => void handleCheckAll(record)}>
            按单复核对账
          </Button>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            改单
          </Button>
          <Popconfirm
            title="删除工单"
            description="拓本会保留，仅摘掉工单与对账记录。"
            okText="确认"
            cancelText="取消"
            onConfirm={() => void handleRemove(record)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const detailColumns: ColumnsType<Rubbing> = [
    { title: '版本', dataIndex: 'versionNo', width: 80, render: (value: number) => `第 ${value} 版` },
    { title: '收藏号', dataIndex: 'collectionNo', width: 120, render: (value: string) => value || '未编' },
    { title: '拓法', dataIndex: 'method', width: 90, render: (value: RubbingMethod) => RUBBING_METHOD_LABEL[value] },
    {
      title: '对账状态',
      key: 'recon',
      render: (_value, record) => {
        const view: ReconViewMap[string] | undefined = reconViewMap[record.id];
        if (!view) return <Typography.Text type="secondary">—</Typography.Text>;
        const orderNo = detail?.orderNo;
        return <ReconTag status={view.status} reason={view.reason} orderNo={orderNo} size="small" />;
      },
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>传拓工单台</h2>
          <p>传拓组开工单写明哪块碑、哪天、什么拓法、拓几张；编目室登记拓本时挂单对账，改单后自动退回待复核。</p>
        </div>
        <Space wrap>
          <Select
            allowClear
            style={{ minWidth: 200 }}
            placeholder="全部碑刻"
            value={steleFilterId ?? undefined}
            options={steles.map((stele) => ({ value: stele.id, label: stele.title }))}
            onChange={(value: string | undefined) => {
              dispatch(setOrderSteleFilter(value ?? null));
              if (value) dispatch(setCurrentStele(value));
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            开工单
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="工单总数" value={stat.orders} suffix="张" tone="primary" />
        <StatBadge label="实挂拓本" value={stat.linkedCount} suffix="份" tone="info" />
        <StatBadge label="对账相符" value={stat.matchedCount} suffix="份" tone="success" />
        <StatBadge label="已挂起" value={stat.heldCount} suffix="份" tone="danger" />
        <StatBadge label="待复核" value={stat.recheckCount} suffix="份" tone="warning" />
        <StatBadge label="待对账" value={stat.pendingCount} suffix="份" />
      </div>

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={selects}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={() => {
          url.reset();
          dispatch(resetOrderFilters());
        }}
        keywordPlaceholder="搜索工单号 / 传拓人 / 备注…"
        actions={
          <Typography.Text type="secondary">
            共 {filtered.length} / {orders.length} 张工单
          </Typography.Text>
        }
      />

      <Card className="gb-table-card" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        {filtered.length === 0 ? (
          <EmptyPanel
            title={orders.length === 0 ? '还没有传拓工单' : '当前筛选条件下没有工单'}
            description={
              orders.length === 0
                ? '传拓组先开工单：碑刻、传拓日期、拓法与计划张数；拓片送到编目室后凭工单号挂单对账。'
                : '试着调整拓法或碑刻筛选条件。'
            }
            actionText="开工单"
            onAction={openCreate}
            secondaryText="重置筛选"
            onSecondary={() => url.reset()}
            size="small"
          />
        ) : (
          <Table<WorkOrder> rowKey="id" size="small" pagination={{ pageSize: 8 }} columns={columns} dataSource={filtered} />
        )}
      </Card>

      {/* 新建 / 改单 */}
      <Drawer
        open={open}
        title={editing ? `改单 · ${editing.orderNo}` : '新开传拓工单'}
        onClose={() => setOpen(false)}
        width={460}
        extra={
          <Space>
            <Button onClick={() => setOpen(false)}>取消</Button>
            <Button type="primary" onClick={() => void submit()}>
              保存
            </Button>
          </Space>
        }
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="orderNo"
            label="工单号"
            rules={[{ required: true, message: '请填写工单号' }]}
            extra={editing ? '工单号确定后一般不改' : undefined}
          >
            <Input placeholder="如：GD20261005-01" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="steleId" label="所拓碑刻" rules={[{ required: true, message: '请选择碑刻' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={steles.map((stele) => ({ value: stele.id, label: stele.title }))}
            />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="rubDate" label="传拓日期" rules={[{ required: true, message: '请选择日期' }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} allowClear={false} />
            </Form.Item>
            <Form.Item name="method" label="拓法" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...RUBBING_METHOD_OPTIONS]} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="plannedCount" label="计划张数" rules={[{ required: true, message: '请填写张数' }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={999} style={{ width: '100%' }} addonAfter="张" />
            </Form.Item>
            <Form.Item name="operator" label="传拓人" style={{ flex: 1 }}>
              <Input placeholder="如：陈拓" />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} placeholder="用纸、操作要点等" />
          </Form.Item>
          {editing ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              保存后工单更新时间会变化，已对账的拓本将退回「待复核」，由编目室重新核对。
            </Typography.Text>
          ) : null}
        </Form>
      </Drawer>

      {/* 工单详情：两边各留各的，传拓组只看对账结果；改单保存时自动补当天工单号 */}
      <Drawer
        open={!!detail}
        title={detail ? `工单 ${detail.orderNo}` : ''}
        onClose={() => setDetail(null)}
        width={560}
        footer={
          detail ? (
            <Space>
              <Button icon={<EditOutlined />} onClick={() => { const d = detail; setDetail(null); openEdit(d); }}>
                改单
              </Button>
              <Button type="primary" onClick={() => void handleCheckAll(detail)}>
                按单复核对账
              </Button>
            </Space>
          ) : null
        }
      >
        {detail ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card size="small">
              <Space direction="vertical" size={4}>
                <Space wrap>
                  <Tag color="#2f3a34">{steleTitle(detail.steleId)}</Tag>
                  <Tag color="gold">{detail.rubDate}</Tag>
                  <Tag>{RUBBING_METHOD_LABEL[detail.method]}</Tag>
                  <Tag color="#a33a2c">计划 {detail.plannedCount} 张</Tag>
                </Space>
                <Typography.Text type="secondary">传拓人：{detail.operator || '未填'}</Typography.Text>
                {detail.note ? <Typography.Text type="secondary">备注：{detail.note}</Typography.Text> : null}
              </Space>
            </Card>
            <Card size="small" title={`挂单拓本（${detailRows.length} 份）`} styles={{ body: { padding: 0 } }}>
              <Table<Rubbing>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detailRows}
                locale={{ emptyText: '拓片尚未送到编目室登记' }}
                columns={detailColumns}
              />
            </Card>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <ProfileOutlined /> 张数或拓法不符的拓本由编目室挂起并写明原因；本台改单保存后自动退回待复核。
            </Typography.Text>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
