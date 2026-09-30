class TelaePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.queue = []
    this.offset = 0
    this.channels = 2
    this.port.onmessage = (event) => {
      if (event.data?.type === 'format') this.channels = event.data.channels || 2
      if (event.data?.type === 'chunk') this.queue.push(event.data.samples)
      if (event.data?.type === 'reset') {
        this.queue = []
        this.offset = 0
      }
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output?.length) return true

    const frameCount = output[0].length
    let frame = 0
    while (frame < frameCount && this.queue.length) {
      const samples = this.queue[0]
      const availableFrames = Math.floor((samples.length - this.offset) / this.channels)
      if (availableFrames <= 0) {
        this.queue.shift()
        this.offset = 0
        continue
      }

      const copyFrames = Math.min(frameCount - frame, availableFrames)
      for (let i = 0; i < copyFrames; i++) {
        for (let channel = 0; channel < output.length; channel++) {
          const sourceChannel = Math.min(channel, this.channels - 1)
          output[channel][frame + i] = samples[this.offset + (i * this.channels) + sourceChannel] || 0
        }
      }

      this.offset += copyFrames * this.channels
      frame += copyFrames
      if (this.offset >= samples.length) {
        this.queue.shift()
        this.offset = 0
      }
    }

    return true
  }
}

registerProcessor('telae-pcm-processor', TelaePcmProcessor)
