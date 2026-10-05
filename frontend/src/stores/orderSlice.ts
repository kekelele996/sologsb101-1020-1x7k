/**
 * 传拓工单 slice（Redux Toolkit）
 * 维护传拓工单与对账记录集合及工单筛选；工单为传拓组侧台账，
 * 编目员在拓本登记页挂工单、执行对账；改单后相关对账自动退回待复核。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db, removeOrderCascade } from '@/utils/db';
import type { WorkOrder, WorkOrderDraft } from '@/types/workOrder';
import type { Recon } from '@/types/recon';
import type { Rubbing, RubbingMethod } from '@/types/rubbing';
import { buildOrderRecon } from '@/utils/reconcile';
import { loadRubbings } from './rubbingSlice';
import type { RootState } from './store';

export interface OrderFilters {
  keyword: string;
  methods: RubbingMethod[];
  steleId: string | null;
}

export interface OrderState {
  items: WorkOrder[];
  recons: Recon[];
  loading: boolean;
  ready: boolean;
  error: string;
  currentOrderId: string | null;
  filters: OrderFilters;
}

const initialState: OrderState = {
  items: [],
  recons: [],
  loading: false,
  ready: false,
  error: '',
  currentOrderId: null,
  filters: { keyword: '', methods: [], steleId: null },
};

export const loadOrders = createAsyncThunk('order/load', async () => {
  const [orders, recons] = await Promise.all([db.orders.toArray(), db.recons.toArray()]);
  orders.sort((a, b) => (a.rubDate === b.rubDate ? a.orderNo.localeCompare(b.orderNo) : a.rubDate < b.rubDate ? 1 : -1));
  recons.sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
  return { orders, recons };
});

export const createOrder = createAsyncThunk('order/create', async (draft: WorkOrderDraft, { dispatch }) => {
  const now = Date.now();
  const row: WorkOrder = { ...draft, id: createId('order'), createdAt: now, updatedAt: now };
  await db.orders.put(row);
  await dispatch(loadOrders());
  return row;
});

export const updateOrder = createAsyncThunk(
  'order/update',
  async (payload: { id: string; patch: Partial<WorkOrder> }, { dispatch }) => {
    // 工单改动后，已对账记录由对账引擎依据 updatedAt 自动退回待复核；
    // 已编目 / 待比对的拓本同步退回待编目，重新对账相符后才算编目完成。
    const now = Date.now();
    await db.transaction('rw', [db.orders, db.rubbings], async () => {
      await db.orders.update(payload.id, { ...payload.patch, updatedAt: now } as never);
      const linked = await db.rubbings.where('orderId').equals(payload.id).toArray();
      const downgraded = linked
        .filter((rubbing) => rubbing.state !== 'toCatalog')
        .map((rubbing) => ({ ...rubbing, state: 'toCatalog' as const, updatedAt: now }));
      if (downgraded.length > 0) await db.rubbings.bulkPut(downgraded);
    });
    await dispatch(loadOrders());
    await dispatch(loadRubbings());
  },
);

export const removeOrder = createAsyncThunk('order/remove', async (id: string, { dispatch }) => {
  await removeOrderCascade(id);
  await dispatch(loadOrders());
  await dispatch(loadRubbings());
});

export interface CheckResult {
  matched: boolean;
  reason: string;
}

/** 对一份拓本按工单核对张数与拓法，写入对账结论；相符才允许拓本编目完成 */
export const checkRecon = createAsyncThunk(
  'order/check',
  async (payload: { rubbingId: string; checker?: string }, { dispatch, getState }): Promise<CheckResult> => {
    const root = getState() as RootState;
    const rubbing = root.rubbing.items.find((item) => item.id === payload.rubbingId);
    if (!rubbing || !rubbing.orderId) throw new Error('该拓本未挂工单，无法对账');
    const order = root.order.items.find((item) => item.id === rubbing.orderId);
    if (!order) throw new Error('所挂工单已不存在，请重新挂单');
    const sameStele = root.rubbing.items.filter((item) => item.steleId === rubbing.steleId);
    const summary = buildOrderRecon({ order, rubbings: sameStele });
    const row = summary.rows.find((item) => item.rubbingId === rubbing.id);
    const reasons = row?.mismatchReasons ?? ['张数不符：该拓本未挂在工单下'];
    const matched = reasons.length === 0;
    const now = Date.now();
    const existing = root.order.recons.find((item) => item.rubbingId === rubbing.id);
    const record: Recon = {
      id: existing?.id ?? createId('recon'),
      orderId: order.id,
      rubbingId: rubbing.id,
      status: matched ? 'matched' : 'held',
      reason: reasons.join('；'),
      checkedAt: now,
      checker: payload.checker?.trim() || existing?.checker || '编目员',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await db.transaction('rw', [db.recons, db.rubbings], async () => {
      await db.recons.put(record);
      // 对账相符才算编目完成；不符的一律退回待编目挂起
      await db.rubbings.update(rubbing.id, { state: matched ? 'cataloged' : 'toCatalog', updatedAt: now } as never);
    });
    await Promise.all([dispatch(loadOrders()), dispatch(loadRubbings())]);
    return { matched, reason: record.reason };
  },
);

/** 按整单对账：把工单下所有拓本逐一核对一遍（传拓组改单后编目室批量复核用） */
export const checkOrderRecons = createAsyncThunk(
  'order/check-all',
  async (payload: { orderId: string; checker?: string }, { dispatch, getState }): Promise<{ matched: number; held: number }> => {
    const root = getState() as RootState;
    const order = root.order.items.find((item) => item.id === payload.orderId);
    if (!order) throw new Error('工单不存在');
    const linked = root.rubbing.items.filter((item) => item.orderId === order.id);
    let matched = 0;
    let held = 0;
    for (const rubbing of linked) {
      const result = await dispatch(checkRecon({ rubbingId: rubbing.id, checker: payload.checker })).unwrap();
      if (result.matched) matched += 1;
      else held += 1;
    }
    return { matched, held };
  },
);

const orderSlice = createSlice({
  name: 'order',
  initialState,
  reducers: {
    setCurrentOrder(state, action: PayloadAction<string | null>) {
      state.currentOrderId = action.payload;
    },
    setOrderKeyword(state, action: PayloadAction<string>) {
      state.filters.keyword = action.payload;
    },
    setOrderMethods(state, action: PayloadAction<RubbingMethod[]>) {
      state.filters.methods = action.payload;
    },
    setOrderSteleFilter(state, action: PayloadAction<string | null>) {
      state.filters.steleId = action.payload;
    },
    resetOrderFilters(state) {
      state.filters = { keyword: '', methods: [], steleId: null };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadOrders.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadOrders.fulfilled, (state, action) => {
        state.items = action.payload.orders;
        state.recons = action.payload.recons;
        state.loading = false;
        state.ready = true;
        state.error = '';
        const exists = state.currentOrderId !== null && action.payload.orders.some((row) => row.id === state.currentOrderId);
        if (!exists) state.currentOrderId = action.payload.orders[0]?.id ?? null;
      })
      .addCase(loadOrders.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '传拓工单读取失败';
      });
  },
});

export const { setCurrentOrder, setOrderKeyword, setOrderMethods, setOrderSteleFilter, resetOrderFilters } =
  orderSlice.actions;

export const selectOrders = (state: RootState): WorkOrder[] => state.order.items;
export const selectRecons = (state: RootState): Recon[] => state.order.recons;

/** 派生选择器：关键字 + 拓法 + 碑刻过滤 */
export function selectFilteredOrders(state: RootState): WorkOrder[] {
  const { items, filters } = state.order;
  const keyword = filters.keyword.trim();
  return items.filter((order) => {
    if (filters.steleId !== null && order.steleId !== filters.steleId) return false;
    if (keyword.length > 0) {
      const haystack = `${order.orderNo}${order.operator}${order.note}`;
      if (!haystack.includes(keyword)) return false;
    }
    if (filters.methods.length > 0 && !filters.methods.includes(order.method)) return false;
    return true;
  });
}

/** 工单维度的对账汇总（供工单台直接展示张数与拓法核对结果） */
export interface OrderReconStat {
  linkedCount: number;
  matchedCount: number;
  heldCount: number;
  recheckCount: number;
  pendingCount: number;
}

export function summarizeOrderRecons(orders: WorkOrder[], rubbings: Rubbing[], recons: Recon[]): OrderReconStat {
  // 按工单聚合每份拓本的实时对账状态（待对账 / 已挂起 / 待复核 / 对账相符）
  const stat: OrderReconStat = { linkedCount: 0, matchedCount: 0, heldCount: 0, recheckCount: 0, pendingCount: 0 };
  const reconsByRubbing = new Map(recons.map((recon) => [recon.rubbingId, recon]));
  orders.forEach((order) => {
    const linked = rubbings.filter((rubbing) => rubbing.orderId === order.id);
    stat.linkedCount += linked.length;
    linked.forEach((rubbing) => {
      const recon = reconsByRubbing.get(rubbing.id);
      if (!recon || recon.checkedAt === null) {
        stat.pendingCount += 1;
        return;
      }
      if (order.updatedAt > recon.checkedAt) {
        stat.recheckCount += 1;
        return;
      }
      if (recon.status === 'matched') stat.matchedCount += 1;
      else stat.heldCount += 1;
    });
  });
  return stat;
}

export default orderSlice.reducer;
