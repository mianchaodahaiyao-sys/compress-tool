# 批量压缩工具 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 构建一个 Electron 桌面应用，支持图片和视频混合批量压缩，调用本地 FFmpeg，可设置压缩参数，输出文件加 `_压缩` 后缀。

**Architecture:** Electron 主进程负责调用 FFmpeg 子进程执行压缩，通过 IPC 与渲染进程通信传递进度和状态。渲染进程负责 UI 交互，通过 preload.js 暴露的 API 与主进程通信。

**Tech Stack:** Electron, Node.js (child_process, fs, path), HTML/CSS/JS

---

### Task 1: 初始化项目

**Files:**
- Create: `C:/Users/JD/compress-tool/package.json`

**Step 1: 创建 package.json**

```json
{
  "name": "compress-tool",
  "version": "1.0.0",
  "description": "批量压缩视频和图片工具",
  "main": "main.js",
  "scripts": {
    "start": "electron ."
  },
  "devDependencies": {
    "electron": "^29.0.0"
  }
}
```

**Step 2: 安装依赖**

在 `C:/Users/JD/compress-tool/` 目录下运行：
```bash
cd C:/Users/JD/compress-tool && npm install
```

预期输出：`added N packages` 无报错。

---

### Task 2: 创建主进程 main.js

**Files:**
- Create: `C:/Users/JD/compress-tool/main.js`

**Step 1: 编写 main.js**

```js
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// FFmpeg 默认路径
const DEFAULT_FFMPEG = 'C:\\Users\\JD\\Desktop\\ffmpeg\\bin\\ffmpeg.exe'

let mainWindow
let currentProcess = null
let isPaused = false
let cancelRequested = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 800,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: '批量压缩工具',
    frame: true,
    backgroundColor: '#1a1a2e'
  })
  mainWindow.loadFile('renderer/index.html')
  mainWindow.setMenu(null)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 获取 FFmpeg 路径（检查默认路径是否存在）
ipcMain.handle('get-ffmpeg-path', () => {
  if (fs.existsSync(DEFAULT_FFMPEG)) return DEFAULT_FFMPEG
  return null
})

// 手动选择 FFmpeg 路径
ipcMain.handle('select-ffmpeg', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 ffmpeg.exe',
    filters: [{ name: 'FFmpeg', extensions: ['exe'] }],
    properties: ['openFile']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

// 打开文件选择对话框
ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要压缩的文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片和视频', extensions: ['jpg','jpeg','png','webp','bmp','mp4','mov','avi','mkv','flv','wmv'] },
      { name: '图片', extensions: ['jpg','jpeg','png','webp','bmp'] },
      { name: '视频', extensions: ['mp4','mov','avi','mkv','flv','wmv'] }
    ]
  })
  if (result.canceled) return []
  return result.filePaths
})

// 获取文件大小
ipcMain.handle('get-file-size', (_, filePath) => {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
})

// 控制：暂停、继续、取消
ipcMain.on('compress-pause', () => { isPaused = true })
ipcMain.on('compress-resume', () => { isPaused = false })
ipcMain.on('compress-cancel', () => {
  cancelRequested = true
  if (currentProcess) currentProcess.kill()
})

// 压缩单个文件
function compressFile(ffmpegPath, inputPath, outputPath, isImage, imageQuality, videoBitrate) {
  return new Promise((resolve, reject) => {
    let args
    if (isImage) {
      args = ['-y', '-i', inputPath, '-q:v', String(imageQuality), outputPath]
    } else {
      args = ['-y', '-i', inputPath, '-b:v', videoBitrate + 'k', outputPath]
    }

    currentProcess = spawn(ffmpegPath, args)
    let duration = 0
    let stderr = ''

    currentProcess.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text

      // 解析总时长
      const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)/)
      if (durationMatch) {
        duration = parseInt(durationMatch[1]) * 3600 +
                   parseInt(durationMatch[2]) * 60 +
                   parseInt(durationMatch[3])
      }

      // 解析当前进度
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+)/)
      if (timeMatch && duration > 0) {
        const current = parseInt(timeMatch[1]) * 3600 +
                        parseInt(timeMatch[2]) * 60 +
                        parseInt(timeMatch[3])
        const percent = Math.min(Math.round((current / duration) * 100), 99)
        mainWindow.webContents.send('compress-progress', percent)
      }
    })

    currentProcess.on('close', (code) => {
      currentProcess = null
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-300)))
    })

    currentProcess.on('error', (err) => {
      currentProcess = null
      reject(err)
    })
  })
}

// 开始批量压缩
ipcMain.handle('compress-start', async (_, { files, ffmpegPath, imageQuality, videoBitrate }) => {
  const IMAGE_EXT = new Set(['jpg','jpeg','png','webp','bmp'])
  cancelRequested = false
  isPaused = false

  for (let i = 0; i < files.length; i++) {
    if (cancelRequested) break

    // 等待暂停结束
    while (isPaused && !cancelRequested) {
      await new Promise(r => setTimeout(r, 300))
    }
    if (cancelRequested) break

    const filePath = files[i]
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const isImage = IMAGE_EXT.has(ext)
    const dir = path.dirname(filePath)
    const base = path.basename(filePath, path.extname(filePath))
    const outputPath = path.join(dir, base + '_压缩' + path.extname(filePath))

    mainWindow.webContents.send('compress-file-start', { index: i })

    try {
      await compressFile(ffmpegPath, filePath, outputPath, isImage, imageQuality, videoBitrate)
      const outSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
      mainWindow.webContents.send('compress-file-done', { index: i, outputPath, outSize })
    } catch (err) {
      mainWindow.webContents.send('compress-file-error', { index: i, error: err.message })
    }
  }

  mainWindow.webContents.send('compress-all-done')
  return true
})
```

**Step 2: 验证文件创建成功**

确认文件存在于 `C:/Users/JD/compress-tool/main.js`。

---

### Task 3: 创建 preload.js

**Files:**
- Create: `C:/Users/JD/compress-tool/preload.js`

**Step 1: 编写 preload.js**

```js
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
```

---

### Task 4: 创建 renderer/index.html

**Files:**
- Create: `C:/Users/JD/compress-tool/renderer/index.html`

**Step 1: 编写 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
  <title>批量压缩工具</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <!-- 左侧文件列表 -->
    <div class="left-panel">
      <div id="drop-zone" class="drop-zone">
        <div class="drop-hint">拖拽文件或文件夹到此处</div>
        <div id="file-list" class="file-list"></div>
      </div>
    </div>

    <!-- 右侧控制面板 -->
    <div class="right-panel">
      <!-- FFmpeg 路径 -->
      <div class="section">
        <div class="section-title">FFmpeg 路径</div>
        <div class="ffmpeg-row">
          <span id="ffmpeg-status" class="ffmpeg-status error">未找到</span>
          <button id="btn-select-ffmpeg" class="btn-sm">选择</button>
        </div>
      </div>

      <!-- 图片设置 -->
      <div class="section">
        <div class="section-title">图片设置</div>
        <div class="param-row">
          <label>quality 值 <span class="hint">1=最高质量 / 31=最大压缩</span></label>
          <input id="image-quality" type="number" min="1" max="31" value="12">
        </div>
      </div>

      <!-- 视频设置 -->
      <div class="section">
        <div class="section-title">视频设置</div>
        <div class="param-row">
          <label>目标码率</label>
          <div class="input-unit">
            <input id="video-bitrate" type="number" min="100" value="1024">
            <span>k</span>
          </div>
        </div>
      </div>

      <!-- 文件操作按钮 -->
      <div class="section">
        <div class="btn-group">
          <button id="btn-add" class="btn-secondary">添加文件</button>
          <button id="btn-clear" class="btn-secondary">清空列表</button>
        </div>
      </div>

      <!-- 压缩控制 -->
      <div class="section compress-section">
        <button id="btn-start" class="btn-primary">开始压缩</button>
        <div id="ctrl-group" class="ctrl-group hidden">
          <button id="btn-pause" class="btn-secondary">暂停</button>
          <button id="btn-cancel" class="btn-danger">取消</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 底部进度栏 -->
  <div class="footer">
    <div class="progress-info">
      <span id="progress-text">就绪</span>
      <span id="current-file"></span>
    </div>
    <div class="progress-bar-wrap">
      <div id="progress-bar" class="progress-bar"></div>
    </div>
  </div>

  <script src="app.js"></script>
</body>
</html>
```

---

### Task 5: 创建 renderer/style.css

**Files:**
- Create: `C:/Users/JD/compress-tool/renderer/style.css`

**Step 1: 编写 style.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Microsoft YaHei', sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 13px;
}

.container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧文件列表 */
.left-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2d2d4e;
  overflow: hidden;
}

.drop-zone {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drop-hint {
  text-align: center;
  color: #555580;
  padding: 16px;
  border-bottom: 1px solid #2d2d4e;
  font-size: 12px;
}

.drop-zone.drag-over {
  background: rgba(100, 100, 200, 0.1);
  border: 2px dashed #6666cc;
}

.file-list {
  flex: 1;
  overflow-y: auto;
}

.file-item {
  display: grid;
  grid-template-columns: 1fr 50px 1fr;
  padding: 7px 12px;
  border-bottom: 1px solid #22223a;
  align-items: center;
  gap: 8px;
}

.file-item:hover { background: #22223a; }

.file-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #c8c8e8;
}

.file-type {
  text-align: center;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  background: #2d2d4e;
  color: #8888bb;
}

.file-status {
  font-size: 12px;
  color: #666699;
}

.file-status.done { color: #4caf82; }
.file-status.error { color: #e06060; }
.file-status.running { color: #7eb8f7; }

/* 右侧面板 */
.right-panel {
  width: 240px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.section { display: flex; flex-direction: column; gap: 8px; }

.section-title {
  font-size: 11px;
  color: #7777aa;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding-bottom: 4px;
  border-bottom: 1px solid #2d2d4e;
}

.param-row { display: flex; flex-direction: column; gap: 4px; }

.param-row label { font-size: 12px; color: #aaaacc; }

.hint { font-size: 10px; color: #555580; display: block; }

input[type="number"] {
  background: #12122a;
  border: 1px solid #3d3d60;
  color: #e0e0e0;
  padding: 5px 8px;
  border-radius: 4px;
  width: 100%;
  font-size: 13px;
}

input[type="number"]:focus {
  outline: none;
  border-color: #6666cc;
}

.input-unit {
  display: flex;
  align-items: center;
  gap: 6px;
}

.input-unit input { flex: 1; }
.input-unit span { color: #7777aa; font-size: 12px; }

.ffmpeg-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ffmpeg-status {
  flex: 1;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ffmpeg-status.ok { color: #4caf82; }
.ffmpeg-status.error { color: #e06060; }

/* 按钮 */
.btn-group { display: flex; gap: 6px; }

button {
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  padding: 6px 12px;
  transition: opacity 0.15s;
}

button:hover { opacity: 0.85; }
button:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-primary {
  background: #5555cc;
  color: #fff;
  width: 100%;
  padding: 8px;
  font-size: 13px;
}

.btn-secondary {
  background: #2d2d4e;
  color: #c0c0e0;
  flex: 1;
}

.btn-danger {
  background: #7a2020;
  color: #ffaaaa;
  flex: 1;
}

.btn-sm {
  background: #2d2d4e;
  color: #9999cc;
  padding: 3px 8px;
  font-size: 11px;
}

.compress-section { margin-top: auto; }

.ctrl-group { display: flex; gap: 6px; }

.hidden { display: none !important; }

/* 底部进度 */
.footer {
  height: 36px;
  background: #12122a;
  border-top: 1px solid #2d2d4e;
  padding: 0 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #666699;
}

.progress-bar-wrap {
  height: 3px;
  background: #2d2d4e;
  border-radius: 2px;
}

.progress-bar {
  height: 100%;
  background: #5555cc;
  border-radius: 2px;
  width: 0%;
  transition: width 0.3s;
}
```

---

### Task 6: 创建 renderer/app.js

**Files:**
- Create: `C:/Users/JD/compress-tool/renderer/app.js`

**Step 1: 编写 app.js**

```js
const IMAGE_EXT = new Set(['jpg','jpeg','png','webp','bmp'])
const VIDEO_EXT = new Set(['mp4','mov','avi','mkv','flv','wmv'])

let fileList = []       // { path, name, ext, type, size, status, statusText }
let ffmpegPath = null
let isRunning = false
let paused = false

// DOM
const dropZone = document.getElementById('drop-zone')
const fileListEl = document.getElementById('file-list')
const btnAdd = document.getElementById('btn-add')
const btnClear = document.getElementById('btn-clear')
const btnStart = document.getElementById('btn-start')
const btnPause = document.getElementById('btn-pause')
const btnCancel = document.getElementById('btn-cancel')
const btnSelectFfmpeg = document.getElementById('btn-select-ffmpeg')
const ffmpegStatus = document.getElementById('ffmpeg-status')
const ctrlGroup = document.getElementById('ctrl-group')
const progressText = document.getElementById('progress-text')
const currentFileEl = document.getElementById('current-file')
const progressBar = document.getElementById('progress-bar')
const imageQualityEl = document.getElementById('image-quality')
const videoBitrateEl = document.getElementById('video-bitrate')

// 初始化：检查 FFmpeg
async function init() {
  const p = await window.api.getFfmpegPath()
  if (p) setFfmpegPath(p)
}

function setFfmpegPath(p) {
  ffmpegPath = p
  ffmpegStatus.textContent = 'ffmpeg.exe'
  ffmpegStatus.className = 'ffmpeg-status ok'
  ffmpegStatus.title = p
}

btnSelectFfmpeg.addEventListener('click', async () => {
  const p = await window.api.selectFfmpeg()
  if (p) setFfmpegPath(p)
})

// 添加文件
btnAdd.addEventListener('click', async () => {
  const paths = await window.api.selectFiles()
  await addFiles(paths)
})

async function addFiles(paths) {
  for (const p of paths) {
    const name = p.split(/[\\/]/).pop()
    const ext = name.split('.').pop().toLowerCase()
    let type = null
    if (IMAGE_EXT.has(ext)) type = '图片'
    else if (VIDEO_EXT.has(ext)) type = '视频'
    else continue  // 不支持的格式跳过

    if (fileList.find(f => f.path === p)) continue  // 去重

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
  fileListEl.innerHTML = ''
  if (fileList.length === 0) {
    fileListEl.innerHTML = '<div style="padding:20px;text-align:center;color:#444466;font-size:12px;">列表为空</div>'
    return
  }
  fileList.forEach((f, i) => {
    const div = document.createElement('div')
    div.className = 'file-item'
    div.innerHTML = `
      <div class="file-name" title="${f.path}">${f.name}</div>
      <div class="file-type">${f.type}</div>
      <div class="file-status ${f.status === 'done' ? 'done' : f.status === 'error' ? 'error' : f.status === 'running' ? 'running' : ''}"
           title="${f.statusText}">${f.statusText}</div>
    `
    fileListEl.appendChild(div)
  })
}

// 拖拽
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault()
  dropZone.classList.add('drag-over')
})

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over')
})

dropZone.addEventListener('drop', async (e) => {
  e.preventDefault()
  dropZone.classList.remove('drag-over')
  const paths = Array.from(e.dataTransfer.files).map(f => f.path)
  await addFiles(paths)
})

// 开始压缩
btnStart.addEventListener('click', async () => {
  if (!ffmpegPath) {
    alert('请先选择 ffmpeg.exe 路径')
    return
  }
  if (fileList.length === 0) {
    alert('请先添加文件')
    return
  }

  isRunning = true
  paused = false
  btnStart.classList.add('hidden')
  ctrlGroup.classList.remove('hidden')
  btnAdd.disabled = true
  btnClear.disabled = true

  // 重置所有状态
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
    progressText.textContent = `${completed}/${fileList.length}`
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

  window.api.onFileDone(({ index, outputPath, outSize }) => {
    completed++
    const orig = fileList[index].size
    const saved = orig > 0 ? Math.round((1 - outSize / orig) * 100) : 0
    const origStr = formatSize(orig)
    const outStr = formatSize(outSize)
    fileList[index].status = 'done'
    fileList[index].statusText = `完成 ${origStr}→${outStr} (-${saved}%)`
    progressBar.style.width = (completed / fileList.length * 100) + '%'
    progressText.textContent = `${completed}/${fileList.length}`
    renderFileList()
  })

  window.api.onFileError(({ index, error }) => {
    completed++
    fileList[index].status = 'error'
    fileList[index].statusText = '失败'
    fileList[index].errorMsg = error
    renderFileList()
  })

  window.api.onAllDone(() => {
    isRunning = false
    btnStart.classList.remove('hidden')
    ctrlGroup.classList.add('hidden')
    btnAdd.disabled = false
    btnClear.disabled = false
    currentFileEl.textContent = ''
    progressText.textContent = `完成 ${completed}/${fileList.length}`
    progressBar.style.width = '100%'
  })

  await window.api.compressStart({
    files: fileList.map(f => f.path),
    ffmpegPath,
    imageQuality,
    videoBitrate
  })
})

// 暂停/继续
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
function formatSize(bytes) {
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
```

---

### Task 7: 启动测试

**Step 1: 启动应用**

```bash
cd C:/Users/JD/compress-tool && npm start
```

预期：Electron 窗口打开，标题为"批量压缩工具"，FFmpeg 路径显示绿色"ffmpeg.exe"。

**Step 2: 测试添加文件**

- 点击"添加文件"，选择 1 张图片 + 1 个视频
- 预期：文件列表显示两行，类型分别为"图片"和"视频"

**Step 3: 测试压缩**

- 点击"开始压缩"
- 预期：状态依次变为"压缩中..."→"完成 Xmb→Ymb (-Z%)"
- 预期：原文件目录中出现 `原名_压缩.扩展名` 文件

**Step 4: 测试拖拽**

- 从文件夹拖一批文件到窗口
- 预期：文件正确添加到列表，不重复
