/**
 * 传拓工单 slice（Redux Toolkit）
 * 维护工单集合与筛选条件；工单与拓本各留各的记录，通过 Rubbing.workOrderId 关联。
 * 提供开单、改单、对账（reconcile）与删除：
 *   - 对账相符 → 工单「已对账」，挂单拓本「已编目」
 *   - 对账不符 → 工单「已挂起」并写明原因，挂单拓本「已挂起」
 *   - 传拓组改单后 → 工单退回「待复核」，等待重新对账
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db } from '@/utils/db';
import { reconcileOrder } from '@/utils/reconcile';
import { loadRubbings } from '@/stores/rubbingSlice';
import type { Rubbing } from '@/types/rubbing';
import type { WorkOrder, WorkOrderDraft, WorkOrderState } from '@/types/workOrder';
import type { RootState } from './store';

export interface WorkOrderFilters {
  keyword: string;
  states: WorkOrderState[];
  steleId: string | null;
}

export interface WorkOrderState2 {
  items: WorkOrder[];
  loading: boolean;
  ready: boolean;
  error: string;
  filters: WorkOrderFilters;
}

const initialState: WorkOrderState2 = {
  items: [],
  loading: false,
  ready: false,
  error: '',
  filters: { keyword: '', states: [], steleId: null },
};

export const loadWorkOrders = createAsyncThunk('workOrder/load', async () => {
  const rows = await db.workOrders.toArray();
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.updatedAt - a.updatedAt));
});

export const createWorkOrder = createAsyncThunk('workOrder/create', async (draft: WorkOrderDraft, { dispatch }) => {
  const now = Date.now();
  const row: WorkOrder = { ...draft, id: createId('wo'), createdAt: now, updatedAt: now };
  await db.workOrders.put(row);
  await dispatch(loadWorkOrders());
  return row;
});

export const updateWorkOrder = createAsyncThunk(
  'workOrder/update',
  async (payload: { id: string; patch: Partial<WorkOrder> }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const current = state.workOrder.items.find((item) => item.id === payload.id);
    const patch = { ...payload.patch };
    // 传拓组改单：若改了拓法或计划拓数，且工单已挂起 / 已对账，退回待复核
    if (current && (patch.method !== undefined || patch.plannedCount !== undefined)) {
      if (current.state === 'held' || current.state === 'reconciled') {
        patch.state = 'review';
      }
    }
    await db.workOrders.update(payload.id, { ...patch, updatedAt: Date.now() } as never);
    await dispatch(loadWorkOrders());
  },
);

export const removeWorkOrder = createAsyncThunk('workOrder/remove', async (id: string, { dispatch }) => {
  // 工单与拓本各留各的：删单不删拓本，仅解除挂单并把挂起拓本退回待编目
  const now = Date.now();
  const attached = await db.rubbings.where('workOrderId').equals(id).toArray();
  if (attached.length > 0) {
    const unlinked: Rubbing[] = attached.map((rubbing) => ({
      ...rubbing,
      workOrderId: null,
      holdReason: '',
      state: rubbing.state === 'held' ? 'toCatalog' : rubbing.state,
      updatedAt: now,
    }));
    await db.rubbings.bulkPut(unlinked);
  }
  await db.workOrders.delete(id);
  await Promise.all([dispatch(loadWorkOrders()), dispatch(loadRubbings())]);
});

/**
 * 对账：核对工单下挂单拓本的拓法与张数。
 * 相符 → 工单已对账 + 挂单拓本已编目；不符 → 工单已挂起写明原因 + 挂单拓本已挂起。
 */
export const reconcileWorkOrder = createAsyncThunk(
  'workOrder/reconcile',
  async (id: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    const order = state.workOrder.items.find((item) => item.id === id);
    if (!order) return null;
    const result = reconcileOrder(order, state.rubbing.items);
    const now = Date.now();

    const nextOrderState: WorkOrderState = result.ok ? 'reconciled' : 'held';
    await db.workOrders.update(
      id,
      { state: nextOrderState, holdReason: result.ok ? '' : result.reason, updatedAt: now } as never,
    );

    // 同步挂单拓本状态：已对账 → 已编目；已挂起 → 已挂起并写明原因
    const attached = state.rubbing.items.filter((rubbing) => rubbing.workOrderId === id);
    if (attached.length > 0) {
      const nextRubbings: Rubbing[] = attached.map((rubbing) => ({
        ...rubbing,
        state: result.ok ? 'cataloged' : 'held',
        holdReason: result.ok ? '' : result.reason,
        updatedAt: now,
      }));
      await db.rubbings.bulkPut(nextRubbings);
    }

    await Promise.all([dispatch(loadWorkOrders()), dispatch(loadRubbings())]);
    return result;
  },
);

const workOrderSlice = createSlice({
  name: 'workOrder',
  initialState,
  reducers: {
    setWorkOrderKeyword(state, action: PayloadAction<string>) {
      state.filters.keyword = action.payload;
    },
    setWorkOrderStates(state, action: PayloadAction<WorkOrderState[]>) {
      state.filters.states = action.payload;
    },
    setWorkOrderSteleFilter(state, action: PayloadAction<string | null>) {
      state.filters.steleId = action.payload;
    },
    resetWorkOrderFilters(state) {
      state.filters = { keyword: '', states: [], steleId: null };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadWorkOrders.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadWorkOrders.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loading = false;
        state.ready = true;
        state.error = '';
      })
      .addCase(loadWorkOrders.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '传拓工单读取失败';
      });
  },
});

export const { setWorkOrderKeyword, setWorkOrderStates, setWorkOrderSteleFilter, resetWorkOrderFilters } =
  workOrderSlice.actions;

export const selectWorkOrderState = (state: RootState): WorkOrderState2 => state.workOrder;
export const selectWorkOrders = (state: RootState): WorkOrder[] => state.workOrder.items;

/** 派生选择器：关键字 + 状态 + 碑刻过滤 */
export function selectFilteredWorkOrders(state: RootState): WorkOrder[] {
  const { items, filters } = state.workOrder;
  const keyword = filters.keyword.trim();
  return items.filter((order) => {
    if (filters.steleId !== null && order.steleId !== filters.steleId) return false;
    if (keyword.length > 0) {
      const haystack = `${order.operator}${order.note}${order.date}`;
      if (!haystack.includes(keyword)) return false;
    }
    if (filters.states.length > 0 && !filters.states.includes(order.state)) return false;
    return true;
  });
}

export default workOrderSlice.reducer;
