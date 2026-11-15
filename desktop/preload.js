const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('CAM3D_DESKTOP', { version: '3.0', platform: process.platform });
