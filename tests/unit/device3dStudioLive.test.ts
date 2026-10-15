import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  endStudioLive,
  publishStudioLive,
  studioLiveState,
  subscribeStudioLive,
  updateStudioLive,
  type StudioLiveEnd,
  type StudioLiveState,
} from '@/lib/device3dStudioLive';

test('cancelled studio previews tell renderers to restore the committed values', () => {
  const events: Array<{ state: StudioLiveState | null; reason?: StudioLiveEnd }> = [];
  const unsubscribe = subscribeStudioLive('cancelled-phone', (state, reason) => events.push({ state, reason }));
  const draft = { orientation: { yaw: 45, pitch: 10, roll: 0 } };
  publishStudioLive('cancelled-phone', draft);
  endStudioLive('cancelled-phone', 'cancel');
  assert.deepEqual(events, [{ state: draft, reason: undefined }, { state: null, reason: 'cancel' }]);
  assert.equal(studioLiveState('cancelled-phone'), undefined);
  unsubscribe();
});

test('studio previews replayed from a panel end once with the commit reason', () => {
  const events: Array<{ state: StudioLiveState | null; reason?: StudioLiveEnd }> = [];
  const unsubscribe = subscribeStudioLive('panel-phone', (state, reason) => events.push({ state, reason }));
  const draft = { glare: 0.4 };
  updateStudioLive('panel-phone', draft);
  assert.deepEqual(studioLiveState('panel-phone'), draft);
  updateStudioLive('panel-phone', null, 'commit');
  updateStudioLive('panel-phone', null, 'cancel');
  assert.deepEqual(events, [{ state: draft, reason: undefined }, { state: null, reason: 'commit' }]);
  unsubscribe();
});

test('cancelling one studio layer leaves other previews alone', () => {
  updateStudioLive('first-phone', { lens: 40 });
  updateStudioLive('second-phone', { lens: 15 });
  updateStudioLive('first-phone', null, 'cancel');
  assert.equal(studioLiveState('first-phone'), undefined);
  assert.deepEqual(studioLiveState('second-phone'), { lens: 15 });
  updateStudioLive('second-phone', null);
});
