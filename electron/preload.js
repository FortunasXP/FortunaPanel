const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('fortunaElectron', {
    isElectron: true,
    version: require('../package.json').version,
});
