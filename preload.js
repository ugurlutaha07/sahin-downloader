const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const inv = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  init: inv('init'), updateYtdlp: inv('update-ytdlp'),
  pickFolder: inv('pick-folder'), pickFiles: inv('pick-files'), pickAudio: inv('pick-audio'),
  pickImage: inv('pick-image'), pickCookieFile: inv('pick-cookie-file'),
  defaultFolder: inv('default-folder'), openFolder: inv('open-folder'), showFile: inv('show-file'), openFile: inv('open-file'),
  fetchInfo: inv('fetch-info'), startDownload: inv('start-download'), startConvert: inv('start-convert'),
  cancel: inv('cancel'),
  getSettings: inv('get-settings'), setSettings: inv('set-settings'), resetSettings: inv('reset-settings'),
  setChrome: inv('set-chrome'),
  historyList: inv('history-list'), historyRemove: inv('history-remove'), historyClear: inv('history-clear'),
  imageSearch: inv('image-search'),
  queuePause: inv('queue-pause'), queueConc: inv('queue-conc'), queueReorder: inv('queue-reorder'),
  itemRemove: inv('item-remove'), itemPause: inv('item-pause'), itemResume: inv('item-resume'),
  renameFiles: inv('rename-files'), pickRenameFiles: inv('pick-rename-files'), tagsBulk: inv('tags-bulk'), buildName: inv('buildname'),
  openExternal: inv('open-external'), presetExport: inv('preset-export'), presetImport: inv('preset-import'), engineInfo: inv('engine-info'),
  tagsRead: inv('tags-read'), tagsWrite: inv('tags-write'),
  followList: inv('follow-list'), followAdd: inv('follow-add'), followRemove: inv('follow-remove'),
  followMode: inv('follow-mode'), followCheck: inv('follow-check'),
  shutdownStart: inv('shutdown-start'), shutdownAbort: inv('shutdown-abort'),
  pathOf: file => webUtils.getPathForFile(file),
  setZoom: f => webFrame.setZoomFactor(+f || 1),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, d) => fn(d))
});
