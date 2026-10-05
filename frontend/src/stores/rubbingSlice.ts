/**
 * 拓本 slice（Redux Toolkit）
 * 维护拓本与钤印集合及筛选条件；同一碑刻下自动生成版本序号。
 */
import { createAsyncThunk, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { createId, db, removeRubbingCascade, renumberRubbings } from '@/utils/db';
import {
  nextRubbingState,
  type Rubbing,
  type RubbingDraft,
  type RubbingMethod,
  type RubbingState,
} from '@/types/rubbing';
import type { Seal, SealDraft, SealType } from '@/types/seal';
import type { RootState } from './store';

/**
 * 编目完成把关：拓本只有挂上工单且实时对账相符，才允许进入「已编目」。
 * 未挂工单 / 待对账 / 已挂起 / 待复核的拓本不能算编目完成。
 */
async function assertCanCatalog(rubbingId: string): Promise<void> {
  const rubbing = await db.rubbings.get(rubbingId);
  if (!rubbing) throw new Error('拓本不存在');
  if (!rubbing.orderId) throw new Error('该拓本还没挂传拓工单，不能标记已编目');
  const [order, reconRows] = await Promise.all([
    db.orders.get(rubbing.orderId),
    db.recons.where('rubbingId').equals(rubbingId).toArray(),
  ]);
  const recon = reconRows[0];
  if (!order) throw new Error('所挂工单已不存在，请重新挂单');
  if (!recon || recon.checkedAt === null || recon.status !== 'matched' || order.updatedAt > recon.checkedAt) {
    throw new Error('须与传拓工单对账相符后，拓本才算编目完成');
  }
}

export interface RubbingFilters {
  keyword: string;
  methods: RubbingMethod[];
  states: RubbingState[];
  steleId: string | null;
}

export interface RubbingState2 {
  items: Rubbing[];
  seals: Seal[];
  loading: boolean;
  ready: boolean;
  error: string;
  currentRubbingId: string | null;
  filters: RubbingFilters;
}

const initialState: RubbingState2 = {
  items: [],
  seals: [],
  loading: false,
  ready: false,
  error: '',
  currentRubbingId: null,
  filters: { keyword: '', methods: [], states: [], steleId: null },
};

export const loadRubbings = createAsyncThunk('rubbing/load', async () => {
  const [rubbings, seals] = await Promise.all([db.rubbings.toArray(), db.seals.toArray()]);
  rubbings.sort((a, b) => (a.steleId === b.steleId ? a.versionNo - b.versionNo : a.steleId.localeCompare(b.steleId)));
  seals.sort((a, b) => a.rubbingId.localeCompare(b.rubbingId));
  return { rubbings, seals };
});

export const createRubbing = createAsyncThunk('rubbing/create', async (draft: RubbingDraft, { dispatch }) => {
  const now = Date.now();
  const row: Rubbing = { ...draft, id: createId('rub'), createdAt: now, updatedAt: now };
  await db.transaction('rw', [db.rubbings, db.recons], async () => {
    await db.rubbings.put(row);
    // 登记时即挂工单的，建一条待对账记录
    if (row.orderId) {
      await db.recons.put({
        id: createId('recon'),
        orderId: row.orderId,
        rubbingId: row.id,
        status: 'pending',
        reason: '',
        checkedAt: null,
        checker: '',
        createdAt: now,
        updatedAt: now,
      });
    }
    await renumberRubbings(row.steleId);
  });
  await dispatch(loadRubbings());
  return row;
});

export const updateRubbing = createAsyncThunk(
  'rubbing/update',
  async (payload: { id: string; patch: Partial<Rubbing> }, { dispatch }) => {
    const current = await db.rubbings.get(payload.id);
    const orderIdChanged =
      Object.prototype.hasOwnProperty.call(payload.patch, 'orderId') && current?.orderId !== payload.patch.orderId;
    // 改挂/摘掉工单或改动拓法，都会影响对账结论：重置为待对账（摘单则删除对账记录）
    const methodChanged =
      current && Object.prototype.hasOwnProperty.call(payload.patch, 'method') && payload.patch.method !== current.method;
    const nextOrderId = Object.prototype.hasOwnProperty.call(payload.patch, 'orderId')
      ? (payload.patch.orderId ?? null)
      : (current?.orderId ?? null);
    const invalidateRecon = orderIdChanged || (methodChanged && nextOrderId !== null);

    await db.transaction('rw', [db.rubbings, db.recons], async () => {
      await db.rubbings.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
      if (invalidateRecon) {
        await db.recons.where('rubbingId').equals(payload.id).delete();
        if (nextOrderId) {
          const now = Date.now();
          await db.recons.put({
            id: createId('recon'),
            orderId: nextOrderId,
            rubbingId: payload.id,
            status: 'pending',
            reason: '',
            checkedAt: null,
            checker: '',
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    });
    await dispatch(loadRubbings());
  },
);

export const advanceRubbingState = createAsyncThunk(
  'rubbing/advance',
  async (id: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    const row = state.rubbing.items.find((item) => item.id === id);
    if (!row) return;
    const next = nextRubbingState(row.state);
    if (next === row.state) return;
    // 推进到「已编目」前必须通过工单对账
    if (next === 'cataloged') await assertCanCatalog(id);
    await db.rubbings.update(id, { state: next, updatedAt: Date.now() } as never);
    await dispatch(loadRubbings());
  },
);

export const batchUpdateRubbings = createAsyncThunk(
  'rubbing/batch',
  async (payload: { ids: string[]; patch: Partial<Rubbing> }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const now = Date.now();
    // 批量改「已编目」时逐份把关，不满足的整批拒绝并提示第一份的原因
    if (payload.patch.state === 'cataloged') {
      for (const id of payload.ids) {
        await assertCanCatalog(id);
      }
    }
    const rows = state.rubbing.items
      .filter((item) => payload.ids.includes(item.id))
      .map((item) => ({ ...item, ...payload.patch, updatedAt: now }));
    if (rows.length > 0) await db.rubbings.bulkPut(rows);
    await dispatch(loadRubbings());
  },
);

export const removeRubbing = createAsyncThunk('rubbing/remove', async (id: string, { dispatch, getState }) => {
  const state = getState() as RootState;
  const row = state.rubbing.items.find((item) => item.id === id);
  await removeRubbingCascade(id);
  if (row) await renumberRubbings(row.steleId);
  await dispatch(loadRubbings());
});

/* ------------------------------ 钤印 ------------------------------ */

export const createSeal = createAsyncThunk('seal/create', async (draft: SealDraft, { dispatch }) => {
  const now = Date.now();
  await db.seals.put({ ...draft, id: createId('seal'), createdAt: now, updatedAt: now });
  await dispatch(loadRubbings());
});

export const updateSeal = createAsyncThunk(
  'seal/update',
  async (payload: { id: string; patch: Partial<Seal> }, { dispatch }) => {
    await db.seals.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    await dispatch(loadRubbings());
  },
);

export const batchUpdateSeals = createAsyncThunk(
  'seal/batch',
  async (payload: { ids: string[]; sealType: SealType }, { dispatch, getState }) => {
    const state = getState() as RootState;
    const now = Date.now();
    const rows = state.rubbing.seals
      .filter((item) => payload.ids.includes(item.id))
      .map((item) => ({ ...item, sealType: payload.sealType, updatedAt: now }));
    if (rows.length > 0) await db.seals.bulkPut(rows);
    await dispatch(loadRubbings());
  },
);

export const removeSeal = createAsyncThunk('seal/remove', async (id: string, { dispatch }) => {
  await db.seals.delete(id);
  await dispatch(loadRubbings());
});

const rubbingSlice = createSlice({
  name: 'rubbing',
  initialState,
  reducers: {
    setCurrentRubbing(state, action: PayloadAction<string | null>) {
      state.currentRubbingId = action.payload;
    },
    setRubbingKeyword(state, action: PayloadAction<string>) {
      state.filters.keyword = action.payload;
    },
    setRubbingMethods(state, action: PayloadAction<RubbingMethod[]>) {
      state.filters.methods = action.payload;
    },
    setRubbingStates(state, action: PayloadAction<RubbingState[]>) {
      state.filters.states = action.payload;
    },
    setRubbingSteleFilter(state, action: PayloadAction<string | null>) {
      state.filters.steleId = action.payload;
    },
    resetRubbingFilters(state) {
      state.filters = { keyword: '', methods: [], states: [], steleId: null };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadRubbings.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadRubbings.fulfilled, (state, action) => {
        state.items = action.payload.rubbings;
        state.seals = action.payload.seals;
        state.loading = false;
        state.ready = true;
        state.error = '';
        const exists =
          state.currentRubbingId !== null && action.payload.rubbings.some((row) => row.id === state.currentRubbingId);
        if (!exists) state.currentRubbingId = action.payload.rubbings[0]?.id ?? null;
      })
      .addCase(loadRubbings.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '拓本读取失败';
      });
  },
});

export const {
  setCurrentRubbing,
  setRubbingKeyword,
  setRubbingMethods,
  setRubbingStates,
  setRubbingSteleFilter,
  resetRubbingFilters,
} = rubbingSlice.actions;

export const selectRubbingState = (state: RootState): RubbingState2 => state.rubbing;
export const selectRubbings = (state: RootState): Rubbing[] => state.rubbing.items;
export const selectSeals = (state: RootState): Seal[] => state.rubbing.seals;
export const selectCurrentRubbingId = (state: RootState): string | null => state.rubbing.currentRubbingId;

/** 派生选择器：关键字 + 拓法 + 状态 + 碑刻过滤 */
export function selectFilteredRubbings(state: RootState): Rubbing[] {
  const { items, filters } = state.rubbing;
  const keyword = filters.keyword.trim();
  return items.filter((rubbing) => {
    if (filters.steleId !== null && rubbing.steleId !== filters.steleId) return false;
    if (keyword.length > 0) {
      const haystack = `${rubbing.collectionNo}${rubbing.paperType}${rubbing.dateGuess}${rubbing.sizeCm}`;
      if (!haystack.includes(keyword)) return false;
    }
    if (filters.methods.length > 0 && !filters.methods.includes(rubbing.method)) return false;
    if (filters.states.length > 0 && !filters.states.includes(rubbing.state)) return false;
    return true;
  });
}

export default rubbingSlice.reducer;
