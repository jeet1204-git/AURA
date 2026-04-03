// ── Audio Worklet Processor Code ──────────────────────────────────────────────
// This string is compiled into a Blob URL and loaded as an AudioWorklet module.
// It runs in the AudioWorkletGlobalScope — no DOM, no imports allowed there.

const WORKLET_CODE = `
class MicProcessor extends AudioWorkletProcessor {
  constructor() { super(); }
  process(inputs) {
    const ch = inputs[0][0]; if (!ch) return true;
    const inputRate = sampleRate, outputRate = 16000;
    if (inputRate === outputRate) {
      const out = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767)));
      this.port.postMessage(out.buffer, [out.buffer]); return true;
    }
    const ratio = inputRate / outputRate, outputLength = Math.floor(ch.length / ratio);
    const out = new Int16Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const pos = i * ratio, idx = Math.floor(pos), frac = pos - idx;
      const a = ch[idx] || 0, b = ch[Math.min(idx+1, ch.length-1)] || 0;
      out[i] = Math.max(-32768, Math.min(32767, Math.round((a + frac*(b-a)) * 32767)));
    }
    this.port.postMessage(out.buffer, [out.buffer]); return true;
  }
}
registerProcessor('mic-processor', MicProcessor);

class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this._queue=[]; this._offset=0;
    this.port.onmessage = (e) => {
      const int16=new Int16Array(e.data); const float32=new Float32Array(int16.length);
      for(let i=0;i<int16.length;i++) float32[i]=int16[i]/32768.0;
      this._queue.push(float32);
    };
  }
  process(_inputs, outputs) {
    const out=outputs[0][0]; if(!out) return true;
    let written=0;
    while(written<out.length && this._queue.length>0) {
      const chunk=this._queue[0]; const available=chunk.length-this._offset; const needed=out.length-written;
      if(available<=needed){ out.set(chunk.subarray(this._offset),written); written+=available; this._queue.shift(); this._offset=0; }
      else { out.set(chunk.subarray(this._offset,this._offset+needed),written); this._offset+=needed; written=out.length; }
    }
    for(let i=written;i<out.length;i++) out[i]=0; return true;
  }
}
registerProcessor('playback-processor', PlaybackProcessor);
`;

// ── Blob URL cache — kept alive across sessions, never revoked ────────────────
let _workletBlobUrl = null;

export function getWorkletBlobUrl() {
  if (!_workletBlobUrl) {
    _workletBlobUrl = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
  }
  return _workletBlobUrl;
}

// ── Create mic capture worklet node ──────────────────────────────────────────
export async function createWorklet(ctx, stream, { onAudioChunk } = {}) {
  await ctx.audioWorklet.addModule(getWorkletBlobUrl());
  const source = ctx.createMediaStreamSource(stream);
  const node   = new AudioWorkletNode(ctx, 'mic-processor');
  source.connect(node);
  node.connect(ctx.destination);
  node.port.onmessage = (e) => {
    if (onAudioChunk) onAudioChunk(e.data);
  };
  return node;
}

// ── Ensure playback worklet is ready ─────────────────────────────────────────
export async function ensurePlaybackWorklet(audioCtx) {
  await audioCtx.audioWorklet.addModule(getWorkletBlobUrl());
  const node = new AudioWorkletNode(audioCtx, 'playback-processor');
  node.connect(audioCtx.destination);
  return node;
}

// ── Enqueue PCM audio for playback ───────────────────────────────────────────
export function enqueueAudio(playbackNode, pcmB64) {
  if (!playbackNode) return;
  const raw   = Uint8Array.from(atob(pcmB64), c => c.charCodeAt(0));
  const int16 = new Int16Array(raw.buffer);
  playbackNode.port.postMessage(int16.buffer, [int16.buffer]);
}
