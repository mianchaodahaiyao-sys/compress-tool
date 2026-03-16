const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getFfmpegPath: () => ipcRenderer.invoke('get-ffmpeg-path'),
  selectFfmpeg: () => ipcRenderer.invoke('select-ffmpeg'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  getFileSize: (filePath) => ipcRenderer.invoke('get-file-size', filePath),
  compressStart: (options) => ipcRenderer.invoke('compress-start', options),
  compressPause: () => ipcRenderer.send('compress-pause'),
  compressResume: () => ipcRenderer.send('compress-resume'),
  compressCancel: () => ipcRenderer.send('compress-cancel'),

  onProgress: (cb) => ipcRenderer.on('compress-progress', (_, v) => cb(v)),
  onFileStart: (cb) => ipcRenderer.on('compress-file-start', (_, v) => cb(v)),
  onFileDone: (cb) => ipcRenderer.on('compress-file-done', (_, v) => cb(v)),
  onFileError: (cb) => ipcRenderer.on('compress-file-error', (_, v) => cb(v)),
  onAllDone: (cb) => ipcRenderer.on('compress-all-done', () => cb()),

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('compress-progress')
    ipcRenderer.removeAllListeners('compress-file-start')
    ipcRenderer.removeAllListeners('compress-file-done')
    ipcRenderer.removeAllListeners('compress-file-error')
    ipcRenderer.removeAllListeners('compress-all-done')
  }
})
