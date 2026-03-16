const IMAGE_EXT = new Set(['jpg','jpeg','png','webp','bmp'])
const VIDEO_EXT = new Set(['mp4','mov','avi','mkv','flv','wmv'])

let fileList = []
let ffmpegPath = null
let isRunning = false
let paused = false

// DOM 元素
const dropZone      = document.getElementById('drop-zone')
const fileListEl    = document.getElementById('file-list')
const btnAdd        = document.getElementById('btn-add')
const btnClear      = document.getElementById('btn-clear')
const btnStart      = document.getElementById('btn-start')
const btnPause      = document.getElementById('btn-pause')
const btnCancel     = document.getElementById('btn-cancel')
const btnSelFfmpeg  = document.getElementById('btn-select-ffmpeg')
const ffmpegStatus  = document.getElementById('ffmpeg-status')
const ctrlGroup     = document.getElementById('ctrl-group')
const progressText  = document.getElementById('progress-text')
const currentFileEl = document.getElementById('current-file')
const progressBar   = document.getElementById('progress-bar')
const imageQualityEl= document.getElementById('image-quality')
const videoBitrateEl= document.getElementById('video-bitrate')

// 初始化：检测 FFmpeg
async function init() {
  const p = await window.api.getFfmpegPath()
  if (p) setFfmpegOk(p)
}

function setFfmpegOk(p) {
  ffmpegPath = p
  ffmpegStatus.textContent = 'ffmpeg.exe ✓'
  ffmpegStatus.className = 'ffmpeg-status ok'
  ffmpegStatus.title = p
}

btnSelFfmpeg.addEventListener('click', async () => {
  const p = await window.api.selectFfmpeg()
  if (p) setFfmpegOk(p)
})

// 添加文件
btnAdd.addEventListener('click', async () => {
  const paths = await window.api.selectFiles()
  await addFiles(paths)
})

async function addFiles(paths) {
  for (const p of paths) {
    const name = p.replace(/\\/g, '/').split('/').pop()
    const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
    let type = null
    if (IMAGE_EXT.has(ext)) type = '图片'
    else if (VIDEO_EXT.has(ext)) type = '视频'
    else continue

    if (fileList.find(f => f.path === p)) continue // 去重

    const size = await window.api.getFileSize(p)
    fileList.push({ path: p, name, ext, type, size, status: 'waiting', statusText: '等待中' })
  }
  renderFileList()
}

// 清空列表
btnClear.addEventListener('click', () => {
  if (isRunning) return
  fileList = []
  renderFileList()
  resetProgress()
})

// 渲染文件列表
function renderFileList() {
  if (fileList.length === 0) {
    fileListEl.innerHTML = '<div class="empty-tip">列表为空，请添加文件</div>'
    return
  }
  fileListEl.innerHTML = ''
  fileList.forEach((f) => {
    const div = document.createElement('div')
    div.className = 'file-item'
    const statusClass = f.status === 'done' ? 'done'
                      : f.status === 'error' ? 'error'
                      : f.status === 'running' ? 'running' : ''
    div.innerHTML = `
      <div class="file-name" title="${f.path}">${f.name}</div>
      <div class="file-type">${f.type}</div>
      <div class="file-status ${statusClass}" title="${f.statusText}">${f.statusText}</div>
    `
    fileListEl.appendChild(div)
  })
  // 滚动到最新处理的文件
  const running = fileList.findIndex(f => f.status === 'running')
  if (running >= 0) {
    const items = fileListEl.querySelectorAll('.file-item')
    if (items[running]) items[running].scrollIntoView({ block: 'nearest' })
  }
}

// 拖拽支持
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  if (!isRunning) dropZone.classList.add('drag-over')
})

dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over')
})

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  if (isRunning) return
  const paths = Array.from(e.dataTransfer.files).map(f => f.path)
  await addFiles(paths)
})

// 开始压缩
btnStart.addEventListener('click', async () => {
  if (!ffmpegPath) { alert('请先选择 ffmpeg.exe 路径'); return }
  if (fileList.length === 0) { alert('请先添加文件'); return }

  isRunning = true
  paused = false
  btnStart.classList.add('hidden')
  ctrlGroup.classList.remove('hidden')
  btnAdd.disabled = true
  btnClear.disabled = true
  btnPause.textContent = '暂停'

  fileList.forEach(f => { f.status = 'waiting'; f.statusText = '等待中' })
  renderFileList()

  const imageQuality = parseInt(imageQualityEl.value) || 12
  const videoBitrate = parseInt(videoBitrateEl.value) || 1024
  let completed = 0

  window.api.removeAllListeners()

  window.api.onFileStart(({ index }) => {
    fileList[index].status = 'running'
    fileList[index].statusText = '压缩中...'
    currentFileEl.textContent = fileList[index].name
    progressText.textContent = `${completed} / ${fileList.length}`
    progressBar.style.width = (completed / fileList.length * 100) + '%'
    renderFileList()
  })

  window.api.onProgress((percent) => {
    const idx = fileList.findIndex(f => f.status === 'running')
    if (idx >= 0) {
      fileList[idx].statusText = `压缩中 ${percent}%`
      renderFileList()
    }
  })

  window.api.onFileDone(({ index, outSize }) => {
    completed++
    const orig = fileList[index].size
    const pct = orig > 0 ? Math.round((1 - outSize / orig) * 100) : 0
    const origStr = fmtSize(orig)
    const outStr  = fmtSize(outSize)
    fileList[index].status = 'done'
    fileList[index].statusText = `${origStr} → ${outStr} (-${pct}%)`
    progressBar.style.width = (completed / fileList.length * 100) + '%'
    progressText.textContent = `${completed} / ${fileList.length}`
    renderFileList()
  })

  window.api.onFileError(({ index, error }) => {
    completed++
    fileList[index].status = 'error'
    fileList[index].statusText = '失败'
    fileList[index]._error = error
    renderFileList()
  })

  window.api.onAllDone(() => {
    isRunning = false
    btnStart.classList.remove('hidden')
    ctrlGroup.classList.add('hidden')
    btnAdd.disabled = false
    btnClear.disabled = false
    currentFileEl.textContent = ''
    progressText.textContent = `完成 ${completed} / ${fileList.length}`
    progressBar.style.width = '100%'
  })

  await window.api.compressStart({
    files: fileList.map(f => f.path),
    ffmpegPath,
    imageQuality,
    videoBitrate
  })
})

// 暂停 / 继续
btnPause.addEventListener('click', () => {
  if (!paused) {
    paused = true
    btnPause.textContent = '继续'
    window.api.compressPause()
  } else {
    paused = false
    btnPause.textContent = '暂停'
    window.api.compressResume()
  }
})

// 取消
btnCancel.addEventListener('click', () => {
  window.api.compressCancel()
})

// 工具函数
function fmtSize(bytes) {
  if (!bytes) return '0B'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

function resetProgress() {
  progressBar.style.width = '0%'
  progressText.textContent = '就绪'
  currentFileEl.textContent = ''
}

init()
