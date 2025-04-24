/* Node.js library with utilities to handle using the emulator from node.js */
/*global exports,__dirname,Promise,require,Uint8Array,Uint32Array */
/*global jsRXCallback:writable,jsUpdateGfx:writable,jsTransmitString,jsInit,jsIdle,jsStopIdle,jsGetGfxContents,flashMemory */
/*global FLASH_SIZE,GFX_WIDTH,GFX_HEIGHT */

let EMULATOR = "banglejs2";
let DEVICEID = "BANGLEJS2";

let BASE_DIR = __dirname + "/../..";
let DIR_IDE =  BASE_DIR + "/../EspruinoWebIDE";

/* we factory reset ONCE, get this, then we can use it to reset
state quickly for each new app */
let factoryFlashMemory;

// Log of messages from app
let appLog = "";
let lastOutputLine = "";
let consoleOutputCallback;

function onConsoleOutput(txt) {
  appLog += txt + "\n";
  lastOutputLine = txt;
  if (consoleOutputCallback)
    consoleOutputCallback(txt);
  else
    console.log("EMSCRIPTEN:", txt);
}

/* Initialise the emulator,

options = {
  EMULATOR : "banglejs"/"banglejs2"
  DEVICEID : "BANGLEJS"/"BANGLEJS2"
  rxCallback : function(int) - called every time a character received
  consoleOutputCallback : function(str) - called when a while line is received
}
*/
exports.init = function(options) {
  if (options.EMULATOR)
    EMULATOR = options.EMULATOR;
  if (options.DEVICEID)
    DEVICEID = options.DEVICEID;

  eval(require("fs").readFileSync(DIR_IDE + "/emu/emulator_"+EMULATOR+".js").toString());
  eval(require("fs").readFileSync(DIR_IDE + "/emu/emu_"+EMULATOR+".js").toString());
  eval(require("fs").readFileSync(DIR_IDE + "/emu/common.js").toString()/*.replace('console.log("EMSCRIPTEN:"', '//console.log("EMSCRIPTEN:"')*/);

  jsRXCallback = options.rxCallback ? options.rxCallback : function() {};
  jsUpdateGfx = function() {};
  if (options.consoleOutputCallback)
    consoleOutputCallback = options.consoleOutputCallback;

  factoryFlashMemory = new Uint8Array(FLASH_SIZE);
  factoryFlashMemory.fill(255);

  exports.flashMemory = flashMemory;
  exports.GFX_WIDTH = GFX_WIDTH;
  exports.GFX_HEIGHT = GFX_HEIGHT;
  exports.tx = jsTransmitString;
  exports.idle = jsIdle;
  exports.stopIdle = jsStopIdle;
  exports.getGfxContents = jsGetGfxContents;

  return new Promise(resolve => {
    setTimeout(function() {
      console.log("Emulator Loaded...");
      jsInit();
      jsIdle();
      console.log("Emulator Factory reset");
      exports.tx("Bangle.factoryReset()\n");
      factoryFlashMemory.set(flashMemory);
      console.log("Emulator Ready!");

      resolve();
    },0);
  });
};

// Factory reset
exports.factoryReset = function() {
  exports.flashMemory.set(factoryFlashMemory);
  exports.tx("reset()\n");
  appLog="";
};

// Transmit a string
exports.tx = function() {}; // placeholder
exports.idle = function() {}; // placeholder
exports.stopIdle = function() {}; // placeholder
exports.getGfxContents = function() {}; // placeholder

exports.flashMemory = undefined; // placeholder
exports.GFX_WIDTH = undefined; // placeholder
exports.GFX_HEIGHT = undefined; // placeholder

// Get last line sent to console
exports.getLastLine = function() {
  return lastOutputLine;
};

// Gets the screenshot as RGBA Uint32Array
exports.getScreenshot = function() {
  let rgba = new Uint8Array(exports.GFX_WIDTH*exports.GFX_HEIGHT*4);
  exports.getGfxContents(rgba);
  let rgba32 = new Uint32Array(rgba.buffer);
  return rgba32;
}

// Write the screenshot to a file options={errorIfBlank}
exports.writeScreenshot = function(imageFn, options) {
  options = options||{};
  return new Promise((resolve,reject) => {
    let rgba32 = exports.getScreenshot();

    if (options.errorIfBlank) {
      let firstPixel = rgba32[0];
      let blankImage = rgba32.every(col=>col==firstPixel);
      if (blankImage) reject("Image is blank");
    }

    let Jimp = require("jimp");
    let image = new Jimp(exports.GFX_WIDTH, exports.GFX_HEIGHT, function (err, image) {
      if (err) throw err;
      let buffer = image.bitmap.data;
      buffer.set(new Uint8Array(rgba32.buffer));
      image.write(imageFn, (err) => {
        if (err) return reject(err);
        console.log("Image written as "+imageFn);
        resolve();
      });
    });
  });
}
