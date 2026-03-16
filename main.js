const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

function getDefaultFfmpeg() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg-static', `ffmpeg${ext}`)
  }
  try {
    const p = require('ffmpeg-static')
    return p
  } catch {
    return null
  }
}

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
    backgroundColor: '#1a1a2e'
  })
  mainWindow.loadFile('renderer/index.html')
  mainWindow.setMenu(null)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-ffmpeg-path', () => {
  const p = getDefaultFfmpeg()
  if (p && fs.existsSync(p)) return p
  return null
})

ipcMain.handle('select-ffmpeg', async () => {
  const isMac = process.platform === 'darwin'
  const result = await dialog.showOpenDialog(mainWindow, {
    title: isMac ? '选择 ffmpeg' : '选择 ffmpeg.exe',
    filters: isMac ? [] : [{ name: 'FFmpeg', extensions: ['exe'] }],
    properties: ['openFile']
  })
  if (result.canceled) return null
  return result.filePaths[0]
})

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要压缩的文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片和视频', extensions: ['jpg','jpeg','png','mp4','mov','avi','mkv','flv','wmv'] },
      { name: '图片', extensions: ['jpg','jpeg','png'] },
      { name: '视频', extensions: ['mp4','mov','avi','mkv','flv','wmv'] }
    ]
  })
  if (result.canceled) return []
  return result.filePaths
})

ipcMain.handle('get-file-size', (_, filePath) => {
  try { return fs.statSync(filePath).size } catch { return 0 }
})

ipcMain.on('compress-pause', () => { isPaused = true })
ipcMain.on('compress-resume', () => { isPaused = false })
ipcMain.on('compress-cancel', () => {
  cancelRequested = true
  if (currentProcess) currentProcess.kill()
})

function compressFile(ffmpegPath, inputPath, outputPath, isImage, imageQuality, videoBitrate, convertToWebP) {
  return new Promise((resolve, reject) => {
    let args
    if (isImage) {
      const isPng = path.extname(inputPath).toLowerCase() === '.png'
      if (isPng && convertToWebP) {
        args = ['-y', '-i', inputPath, '-quality', '85', outputPath]
      } else if (isPng) {
        args = ['-y', '-i', inputPath, '-compression_level', '9', outputPath]
      } else {
        args = ['-y', '-i', inputPath, '-q:v', String(imageQuality), outputPath]
      }
    } else {
      args = ['-y', '-i', inputPath, '-b:v', videoBitrate + 'k', outputPath]
    }

    currentProcess = spawn(ffmpegPath, args)
    let duration = 0
    let stderr = ''

    currentProcess.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text

      const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)/)
      if (durationMatch) {
        duration = parseInt(durationMatch[1]) * 3600 +
                   parseInt(durationMatch[2]) * 60 +
                   parseInt(durationMatch[3])
      }

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

ipcMain.handle('compress-start', async (_, { files, ffmpegPath, imageQuality, videoBitrate, convertToWebP }) => {
  const IMAGE_EXT = new Set(['jpg','jpeg','png'])
  cancelRequested = false
  isPaused = false

  for (let i = 0; i < files.length; i++) {
    if (cancelRequested) break

    while (isPaused && !cancelRequested) {
      await new Promise(r => setTimeout(r, 300))
    }
    if (cancelRequested) break

    const filePath = files[i]
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const isImage = IMAGE_EXT.has(ext)
    const dir = path.dirname(filePath)
    const base = path.basename(filePath, path.extname(filePath))
    const isPng = ext === 'png'
    const outExt = (isPng && convertToWebP) ? '.webp' : path.extname(filePath)
    const outputPath = path.join(dir, base + '_压缩' + outExt)

    mainWindow.webContents.send('compress-file-start', { index: i })

    try {
      await compressFile(ffmpegPath, filePath, outputPath, isImage, imageQuality, videoBitrate, convertToWebP)
      const outSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0
      mainWindow.webContents.send('compress-file-done', { index: i, outputPath, outSize })
    } catch (err) {
      mainWindow.webContents.send('compress-file-error', { index: i, error: err.message })
    }
  }

  mainWindow.webContents.send('compress-all-done')
  return true
})
