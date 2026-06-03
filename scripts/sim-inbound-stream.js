// Simulate a Plivo inbound media stream against /plivo/audio.
// Connects exactly like Plivo's <Stream> does (same query params), sends a
// `start` event, then listens for the agent's greeting `playAudio` frames.
// Proves the inbound streaming pipeline (agent load -> greeting -> TTS ->
// stream back) works without a live PSTN call. Usage:
//   node scripts/sim-inbound-stream.js <agentId> <tenantId> <from> <to>
const WebSocket = require('ws');

const [agentId, tenantId, from, to] = process.argv.slice(2);
const callSid = 'sim-inbound-' + from;
const qs = new URLSearchParams({ agentId, tenantId, from, to, callSid, direction: 'inbound' });
const url = `ws://localhost:3002/plivo/audio?${qs.toString()}`;

console.log('connecting:', url);
const ws = new WebSocket(url);

let playFrames = 0, playBytes = 0, firstAudioMs = null;
const t0 = Date.now();

ws.on('open', () => {
  console.log(`[${Date.now() - t0}ms] WS open -> sending start`);
  ws.send(JSON.stringify({
    event: 'start',
    start: { streamId: 'sim-stream-1', callId: callSid, from, to },
  }));
});

ws.on('message', (data) => {
  let m;
  try { m = JSON.parse(data.toString()); } catch { return; }
  if (m.event === 'playAudio') {
    if (firstAudioMs === null) {
      firstAudioMs = Date.now() - t0;
      console.log(`[${firstAudioMs}ms] FIRST greeting audio frame received`);
    }
    playFrames++;
    playBytes += Buffer.from(m.media.payload, 'base64').length;
  } else if (m.event === 'clearAudio') {
    console.log(`[${Date.now() - t0}ms] clearAudio`);
  } else {
    console.log(`[${Date.now() - t0}ms] event:`, m.event);
  }
});

ws.on('error', (e) => console.error('WS error:', e.message));
ws.on('close', (c) => console.log(`[${Date.now() - t0}ms] WS closed (${c})`));

// Let the greeting play out, then report and exit.
setTimeout(() => {
  const secs = (playBytes / 8000).toFixed(2); // mulaw 8kHz = 8000 bytes/sec
  console.log('\n==== RESULT ====');
  console.log(`greeting audio frames : ${playFrames}`);
  console.log(`greeting audio bytes  : ${playBytes}  (~${secs}s of speech)`);
  console.log(`first-audio latency   : ${firstAudioMs === null ? 'NONE' : firstAudioMs + 'ms'}`);
  console.log(playFrames > 0
    ? 'PASS — inbound streaming pipeline produced agent speech.'
    : 'FAIL — no audio streamed back.');
  try { ws.send(JSON.stringify({ event: 'stop' })); } catch {}
  ws.close();
  setTimeout(() => process.exit(playFrames > 0 ? 0 : 1), 300);
}, 15000);
