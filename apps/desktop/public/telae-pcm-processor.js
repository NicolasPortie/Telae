class TelaePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.maxFrames = Math.max(1, Math.floor(sampleRate * 0.12))
    this.meterInterval = Math.max(1, Math.floor(sampleRate * 0.25))
    this.channels = 2
    this.buffer = new Float32Array(this.maxFrames * this.channels)
    this.reset()
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'format' && Number.isInteger(data.channels) && data.channels > 0 && data.channels <= 32) {
        this.channels = data.channels
        this.buffer = new Float32Array(this.maxFrames * this.channels)
        this.reset()
      } else if (data?.type === 'chunk' && data.samples instanceof Float32Array) {
        this.enqueue(data.samples)
      } else if (data?.type === 'reset') {
        this.reset()
        this.report()
      }
    }
  }

  reset() {
    this.readFrame = 0
    this.queuedFrames = 0
    this.droppedFrames = 0
    this.underrunFrames = 0
    this.meterFrames = 0
  }

  report() {
    this.port.postMessage({
      type: 'diagnostics',
      sampleRate,
      maxQueueFrames: this.maxFrames,
      queuedFrames: this.queuedFrames,
      droppedFrames: this.droppedFrames,
      underrunFrames: this.underrunFrames,
    })
  }

  enqueue(samples) {
    const incomingFrames = Math.floor(samples.length / this.channels)
    const overflow = Math.max(0, this.queuedFrames + incomingFrames - this.maxFrames)
    const discardQueued = Math.min(overflow, this.queuedFrames)
    this.readFrame = (this.readFrame + discardQueued) % this.maxFrames
    this.queuedFrames -= discardQueued
    this.droppedFrames += overflow
    // Copy only the newest complete frames; never retain the transferred chunk.
    const skipIncoming = overflow - discardQueued
    for (let frame = skipIncoming; frame < incomingFrames; frame++) {
      const writeFrame = (this.readFrame + this.queuedFrames) % this.maxFrames
      for (let channel = 0; channel < this.channels; channel++) {
        this.buffer[writeFrame * this.channels + channel] = samples[frame * this.channels + channel]
      }
      this.queuedFrames++
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output?.length) return true
    const frameCount = output[0].length
    const copyFrames = Math.min(frameCount, this.queuedFrames)
    for (let channel = 0; channel < output.length; channel++) {
      output[channel].fill(0)
      const sourceChannel = Math.min(channel, this.channels - 1)
      for (let frame = 0; frame < copyFrames; frame++) {
        const sourceFrame = (this.readFrame + frame) % this.maxFrames
        output[channel][frame] = this.buffer[sourceFrame * this.channels + sourceChannel]
      }
    }
    this.readFrame = (this.readFrame + copyFrames) % this.maxFrames
    this.queuedFrames -= copyFrames
    this.underrunFrames += frameCount - copyFrames
    this.meterFrames += frameCount
    if (this.meterFrames >= this.meterInterval) {
      this.meterFrames %= this.meterInterval
      this.report()
    }
    return true
  }
}

registerProcessor('telae-pcm-processor', TelaePcmProcessor)
