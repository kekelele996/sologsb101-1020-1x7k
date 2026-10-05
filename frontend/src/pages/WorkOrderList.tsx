/**
 * /workorders 传拓工单
 * 传拓组开单：哪块碑、哪天、什么拓法、拓了几张；登记拓本时挂上对应工单。
 * 拓本须与工单对账后才算编目完成：相符 → 已对账；不符 → 已挂起写明原因；
 * 传拓组改单后退回待复核。工单与拓本各留各的记录。
 * 消费 WorkOrder、Rubbing、Stele；复用 <FilterBar>、<StatBadge>、<EmptyPanel>。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import FilterBar, { useFilterQuery, type FilterSelectConfig } from '@/components/common/FilterBar';
import StatBadge from '@/components/common/StatBadge';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { selectSteles } from '@/stores/steleSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import {
  createWorkOrder,
  loadWorkOrders,
  reconcileWorkOrder,
  removeWorkOrder,
  resetWorkOrderFilters,
  selectFilteredWorkOrders,
  selectWorkOrders,
  setWorkOrderKeyword,
  setWorkOrderStates,
  setWorkOrderSteleFilter,
  updateWorkOrder,
} from '@/stores/workOrderSlice';
import {
  RUBBING_METHOD_LABEL,
  RUBBING_METHOD_OPTIONS,
  type RubbingMethod,
} from '@/types/rubbing';
import {
  WORK_ORDER_STATE_COLOR,
  WORK_ORDER_STATE_LABEL,
  WORK_ORDER_STATE_OPTIONS,
  createEmptyWorkOrderDraft,
  type WorkOrder,
  type WorkOrderDraft,
  type WorkOrderState,
} from '@/types/workOrder';

const FILTER_KEYS = ['state'] as const;

export default function WorkOrderList() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<WorkOrderDraft>();

  const steles = useAppSelector(selectSteles);
  const rubbings = useAppSelector(selectRubbings);
  const workOrders = useAppSelector(selectWorkOrders);
  const filtered = useAppSelector(selectFilteredWorkOrders);
  const steleFilterId = useAppSelector((state) => state.workOrder.filters.steleId);

  const url = useFilterQuery(FILTER_KEYS);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrder | null>(null);

  useEffect(() => {
    dispatch(setWorkOrderKeyword(url.keyword));
    dispatch(setWorkOrderStates((url.values.state ?? []) as WorkOrderState[]));
  }, [dispatch, url.keyword, url.values]);

  const selects: FilterSelectConfig[] = useMemo(
    () => [
      {
        key: 'state',
        label: '状态',
        options: WORK_ORDER_STATE_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
      },
    ],
    [],
  );

  const stat = useMemo(() => {
    const total = workOrders.length;
    const reconciled = workOrders.filter((order) => order.state === 'reconciled').length;
    const held = workOrders.filter((order) => order.state === 'held').length;
    const review = workOrders.filter((order) => order.state === 'review').length;
    const pending = workOrders.filter((order) => order.state === 'pending').length;
    return { total, reconciled, held, review, pending };
  }, [workOrders]);

  const steleTitle = (steleId: string): string => steles.find((stele) => stele.id === steleId)?.title ?? steleId;

  const attachedCount = (order: WorkOrder): number =>
    rubbings.filter((rubbing) => rubbing.workOrderId === order.id).length;

  const openCreate = (): void => {
    const steleId = steleFilterId ?? steles[0]?.id ?? '';
    if (!steleId) {
      message.warning('请先在碑刻台账中登记碑刻');
      return;
    }
    setEditing(null);
    form.setFieldsValue(createEmptyWorkOrderDraft(steleId));
    setOpen(true);
  };

  const openEdit = (order: WorkOrder): void => {
    setEditing(order);
    form.setFieldsValue({
      steleId: order.steleId,
      date: order.date,
      method: order.method,
      plannedCount: order.plannedCount,
      state: order.state,
      holdReason: order.holdReason,
      operator: order.operator,
      note: order.note,
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    if (editing) {
      await dispatch(updateWorkOrder({ id: editing.id, patch: values })).unwrap();
      message.success(`已更新工单（${editing.id}）`);
    } else {
      await dispatch(createWorkOrder(values)).unwrap();
      message.success('已开传拓工单');
    }
    setOpen(false);
  };

  const handleReconcile = async (order: WorkOrder): Promise<void> => {
    const result = await dispatch(reconcileWorkOrder(order.id)).unwrap();
    if (!result) return;
    if (result.ok) {
      message.success(`对账相符：已对账 ${result.actualCount} 张，拓法一致`);
    } else {
      message.warning(`已挂起：${result.reason}`);
    }
  };

  const columns: ColumnsType<WorkOrder> = [
    {
      title: '工单号',
      dataIndex: 'id',
      width: 150,
      render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
    },
    { title: '碑刻', dataIndex: 'steleId', width: 130, render: (value: string) => steleTitle(value) },
    { title: '传拓日期', dataIndex: 'date', width: 110 },
    {
      title: '拓法',
      dataIndex: 'method',
      width: 90,
      render: (value: RubbingMethod) => RUBBING_METHOD_LABEL[value],
    },
    {
      title: '计划 / 实际',
      key: 'count',
      width: 110,
      render: (_value, record) => {
        const actual = attachedCount(record);
        const mismatch = actual !== record.plannedCount;
        return (
          <Space size={4}>
            <Typography.Text>
              {record.plannedCount} / {actual}
            </Typography.Text>
            {mismatch ? <WarningOutlined style={{ color: '#b03a2e' }} /> : null}
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'state',
      width: 100,
      render: (value: WorkOrderState) => (
        <Tag color={WORK_ORDER_STATE_COLOR[value]}>{WORK_ORDER_STATE_LABEL[value]}</Tag>
      ),
    },
    {
      title: '挂起原因',
      dataIndex: 'holdReason',
      width: 220,
      render: (value: string, record) =>
        record.state === 'held' || record.state === 'review' ? (
          <Typography.Text type={record.state === 'held' ? 'danger' : 'warning'} style={{ fontSize: 12 }}>
            {value || '—'}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
    { title: '开单人', dataIndex: 'operator', width: 110, render: (value: string) => value || '未填' },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_value, record) => (
        <Space size={4} wrap>
          <Button
            size="small"
            type="link"
            icon={<CheckCircleOutlined />}
            onClick={() => void handleReconcile(record)}
          >
            {record.state === 'review' ? '复核' : '对账'}
          </Button>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            改单
          </Button>
          <Popconfirm
            title="删除工单"
            description="仅删除工单记录并解除拓本挂单，不会删除拓本本身。"
            okText="确认"
            cancelText="取消"
            onConfirm={() =>
              void dispatch(removeWorkOrder(record.id))
                .unwrap()
                .then(() => dispatch(loadWorkOrders()))
                .then(() => message.success('已删除工单'))
            }
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>传拓工单</h2>
          <p>
            传拓组开单写明碑刻、日期、拓法与拓数；登记拓本时挂上对应工单，拓本须与工单对账后才算编目完成。
          </p>
        </div>
        <Space wrap>
          <Select
            allowClear
            style={{ minWidth: 200 }}
            placeholder="全部碑刻"
            value={steleFilterId ?? undefined}
            options={steles.map((stele) => ({ value: stele.id, label: stele.title }))}
            onChange={(value: string | undefined) => dispatch(setWorkOrderSteleFilter(value ?? null))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            开工单
          </Button>
        </Space>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="工单总数" value={stat.total} suffix="张" tone="primary" />
        <StatBadge label="已对账" value={stat.reconciled} suffix="张" tone="success" />
        <StatBadge label="已挂起" value={stat.held} suffix="张" tone="danger" />
        <StatBadge label="待复核" value={stat.review} suffix="张" tone="warning" />
        <StatBadge label="待对账" value={stat.pending} suffix="张" tone="info" />
      </div>

      <FilterBar
        keyword={url.keyword}
        onKeywordChange={url.setKeyword}
        selects={selects}
        values={url.values}
        onValuesChange={url.setValues}
        onReset={() => {
          url.reset();
          dispatch(resetWorkOrderFilters());
        }}
        keywordPlaceholder="搜索开单人 / 备注 / 日期…"
        actions={
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void dispatch(loadWorkOrders())}
          >
            刷新
          </Button>
        }
      />

      <Card className="gb-table-card" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
        {filtered.length === 0 ? (
          <EmptyPanel
            title={workOrders.length === 0 ? '还没有传拓工单' : '当前筛选条件下没有工单'}
            description={
              workOrders.length === 0
                ? '传拓组先开一张工单，写明碑刻、日期、拓法与计划拓数；拓本登记时挂上工单即可对账。'
                : '试着调整状态筛选条件。'
            }
            actionText="开工单"
            onAction={openCreate}
            secondaryText="重置筛选"
            onSecondary={() => url.reset()}
            size="small"
          />
        ) : (
          <Table<WorkOrder>
            rowKey="id"
            size="small"
            pagination={{ pageSize: 8 }}
            columns={columns}
            dataSource={filtered}
          />
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `改单 · ${editing.id}` : '开传拓工单'}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="steleId" label="所属碑刻" rules={[{ required: true, message: '请选择碑刻' }]}>
            <Select options={steles.map((stele) => ({ value: stele.id, label: stele.title }))} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="date" label="传拓日期" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="method" label="拓法" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select options={[...RUBBING_METHOD_OPTIONS]} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="plannedCount" label="计划拓数" rules={[{ required: true }]} style={{ flex: 1 }}>
              <InputNumber min={1} max={99} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="operator" label="开单人" style={{ flex: 1 }}>
              <Input placeholder="如：传拓组·老周" />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="传拓安排、纸质墨色等说明" />
          </Form.Item>
          {editing ? (
            <Form.Item name="state" label="工单状态">
              <Select options={[...WORK_ORDER_STATE_OPTIONS]} />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </div>
  );
}
