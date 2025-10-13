const { app, BrowserWindow } = require('electron');
const path = require('path');


function createWindow() {
  const win = new BrowserWindow({
    fullscreen: true,
    icon: path.join(__dirname, 'Image', 'Screenshot 2025-03-11 173318.jpg'),
    webPreferences: {
      nodeIntegration: true,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);