import assert from 'node:assert/strict';
import test from 'node:test';

import { exactRemoteScreenTrackStopped } from './webmeet.mjs';

const reference = {
  participantIdentity: 'participant-a',
  publicationSid: 'TR_screen',
  trackId: 'screen-track',
};

function activeSnapshot() {
  return {
    remotePublications: [{
      participantIdentity: 'participant-a',
      publicationSid: 'TR_screen',
      trackId: 'screen-track',
      trackPresent: true,
      trackState: 'live',
    }],
    receivers: [{ trackId: 'screen-track', trackPresent: true, trackState: 'live' }],
    videos: [{
      participantIdentity: 'participant-a',
      source: 'screen_share',
      trackId: 'screen-track',
      trackPresent: true,
      trackState: 'live',
    }],
  };
}

test('remote screen teardown cannot pass from DOM removal while publication or receiver remains live', () => {
  const snapshot = activeSnapshot();
  snapshot.videos = [];
  assert.equal(exactRemoteScreenTrackStopped(snapshot, reference), false);

  snapshot.remotePublications = [];
  assert.equal(exactRemoteScreenTrackStopped(snapshot, reference), false);
});

test('remote screen teardown accepts exact track absence or explicit ended state', () => {
  assert.equal(exactRemoteScreenTrackStopped({
    remotePublications: [], receivers: [], videos: [],
  }, reference), true);

  const ended = activeSnapshot();
  for (const collection of [ended.remotePublications, ended.receivers, ended.videos]) {
    collection[0].trackState = 'ended';
  }
  assert.equal(exactRemoteScreenTrackStopped(ended, reference), true);
  assert.equal(exactRemoteScreenTrackStopped(ended, { ...reference, trackId: '' }), false);
});
