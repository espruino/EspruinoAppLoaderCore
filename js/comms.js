//Puck.debug=3;
console.log("================================================")
console.log("Type 'Comms.debug()' to enable Comms debug info")
console.log("================================================")

/// Add progress handler so we get nice upload progress shown
{
  let COMMS = (typeof UART != "undefined")?UART:Puck;
  COMMS.writeProgress = function(charsSent, charsTotal) {
    if (charsSent===undefined || charsTotal<10) {
      Progress.hide();
      return;
    }
    let percent = Math.round(charsSent*100/charsTotal);
    Progress.show({percent: percent});
  };
}

const Comms = {
// ================================================================================
//                                                                 Low Level Comms
  /// enable debug print statements
  debug : () => {
    if (typeof UART !== "undefined")
      UART.debug = 3;
    else
      Puck.debug = 3;
  },

  /** Write the given data, returns a promise containing the data received immediately after sending the command
    options = {
      waitNewLine : bool // wait for a newline (rather than just 300ms of inactivity)
    }
  */
  write : (data, options) => {
    if (data===undefined) throw new Error("Comms.write(undefined) called!")
    options = options||{};
    if (typeof UART !== "undefined") { // New method
      return UART.write(data, undefined, !!options.waitNewLine);
    } else { // Old method
      return new Promise((resolve,reject) =>
        Puck.write(data, result => {
          if (result===null) return reject("");
          resolve(result);
        }, !!options.waitNewLine)
      );
    }
  },
  /// Evaluate the given expression, return the result as a promise
  eval : (expr) => {
    if (expr===undefined) throw new Error("Comms.eval(undefined) called!")
    if (typeof UART !== "undefined") { // New method
      return UART.eval(expr);
    } else { // Old method
      return new Promise((resolve,reject) =>
        Puck.eval(expr, result => {
          if (result===null) return reject("");
          resolve(result);
        })
      );
    }
  },
  /// Return true if we're connected, false if not
  isConnected : () => {
    if (typeof UART !== "undefined") { // New method
      return UART.isConnected();
    } else { // Old method
      return Puck.isConnected();
    }
  },
  /// Get the currently active connection object
  getConnection : () => {
    if (typeof UART !== "undefined") { // New method
      return UART.getConnection();
    } else { // Old method
      return Puck.getConnection();
    }
  },
  supportsPacketUpload : () => (!SETTINGS.noPackets) && Comms.getConnection().espruinoSendFile && !Utils.versionLess(device.version,"2v25"),
  // Faking EventEmitter
  handlers : {},
  on : function(id, callback) { // calling with callback=undefined will disable
    if (id!="data") throw new Error("Only data callback is supported");
    let connection = Comms.getConnection();
    if (!connection) throw new Error("No active connection");
    if ("undefined"!==typeof Puck) {
      /* This is a bit of a mess - the Puck.js lib only supports one callback with `.on`. If you
      do Puck.getConnection().on('data') then it blows away the default one which is used for
      .write/.eval and you can't get it back unless you reconnect. So rather than trying to fix the
      Puck lib we just copy in the default handler here. */
      if (callback===undefined) {
        connection.on("data", function(d) { // the default handler
          connection.received += d;
          connection.hadData = true;
          if (connection.cb)  connection.cb(d);
        });
      } else {
        connection.on("data", function(d) {
          connection.received += d;
          connection.hadData = true;
          if (connection.cb)  connection.cb(d);
          callback(d);
        });
      }
    } else { // UART
      if (callback===undefined) {
        if (Comms.dataCallback) connection.removeListener("data",Comms.dataCallback);
        delete Comms.dataCallback;
      } else {
        Comms.dataCallback = callback;
        connection.on("data",Comms.dataCallback);
      }
    }
  },
  /* when connected, this is the name of the device we're connected to as far as Espruino is concerned
  (eg Bluetooth/USB/Serial1.println("Foo") ) */
  espruinoDevice : undefined,
// ================================================================================
  // Show a message on the screen (if available)
  showMessage : (txt) => {
    console.log(`<COMMS> showMessage ${JSON.stringify(txt)}`);
    if (!Const.HAS_E_SHOWMESSAGE) return Promise.resolve();
    return Comms.write(`\x10E.showMessage(${JSON.stringify(txt)})\n`);
  },
  // When upload is finished, show a message (or reload)
  showUploadFinished : () => {
    if (SETTINGS.autoReload || Const.LOAD_APP_AFTER_UPLOAD || Const.SINGLE_APP_ONLY) return Comms.write("\x10load()\n");
    else return Comms.showMessage(Const.MESSAGE_RELOAD);
  },
  // Gets a text command to append to what's being sent to show progress. If progress==undefined, it's the first command
  getProgressCmd : (progress) => {
    console.log(`<COMMS> getProgressCmd ${progress!==undefined?`${Math.round(progress*100)}%`:"START"}`);
    if (!Const.HAS_E_SHOWMESSAGE) {
      if (progress===undefined) return "p=x=>digitalPulse(LED1,1,10);";
      return "p();";
    } else {
      if (progress===undefined) return Const.CODE_PROGRESSBAR;
      return `p(${Math.round(progress*100)});`
    }
  },
  // Reset the device, if opt=="wipe" erase any saved code
  reset : (opt) => {
    let tries = 8;
    if (Const.NO_RESET) return Promise.resolve();
    console.log("<COMMS> reset");

    function rstHandler(result) {
      console.log("<COMMS> reset: got "+JSON.stringify(result));
      if (result===null) return Promise.reject("Connection failed");
      if (result=="" && (tries-- > 0)) {
        console.log(`<COMMS> reset: no response. waiting ${tries}...`);
        return Comms.write("\x03").then(rstHandler);
      } else if (result.endsWith("debug>")) {
        console.log(`<COMMS> reset: watch in debug mode, interrupting...`);
        return Comms.write("\x03").then(rstHandler);
      } else {
        console.log(`<COMMS> reset: rebooted - sending commands to clear out any boot code`);
        // see https://github.com/espruino/BangleApps/issues/1759
        return Comms.write("\x10clearInterval();clearWatch();global.Bangle&&Bangle.removeAllListeners();E.removeAllListeners();global.NRF&&NRF.removeAllListeners();\n").then(function() {
          console.log(`<COMMS> reset: complete.`);
          return new Promise(resolve => setTimeout(resolve, 250))
        });
      }
    }

    return Comms.write(`\x03\x10reset(${opt=="wipe"?"1":""});\n`).then(rstHandler);
  },
  // Upload a list of newline-separated commands that start with \x10
  // You should call Comms.write("\x10"+Comms.getProgressCmd()+"\n")) first
  uploadCommandList : (cmds, currentBytes, maxBytes) => {
    // Chould check CRC here if needed instead of returning 'OK'...
    // E.CRC32(require("Storage").read(${JSON.stringify(app.name)}))

    /* we can't just split on newline, because some commands (like
    an upload when evaluate:true) may contain newline in the command.
    In the absence of bracket counting/etc we'll just use the \x10
    char we use to signify echo(0) for a line */
    cmds = cmds.split("\x10").filter(l=>l!="").map(l=>"\x10"+l.trim());

    return (Comms.espruinoDevice?Promise.resolve():Comms.getDeviceInfo(true/*noreset*/)) // ensure Comms.espruinoDevice is set
      .then(() => new Promise( (resolve, reject) => {
        // Function to upload a single line and wait for an 'OK' response
        function uploadCmd() {
          if (!cmds.length) return resolve();
          let cmd = cmds.shift();
          Progress.show({
            min:currentBytes / maxBytes,
            max:(currentBytes+cmd.length) / maxBytes});
          currentBytes += cmd.length;
          function responseHandler(result) {
            console.log("<COMMS> Response: ",JSON.stringify(result));
            let ignore = false;
            if (result!==undefined) {
              result=result.trim();
              if (result=="OK") {
                uploadCmd(); // all as expected - send next
                return;
              }

              if (result.startsWith("{") && result.endsWith("}")) {
                console.log("<COMMS> JSON response received (Gadgetbridge?) - ignoring...");
                ignore = true;
              } else if (result=="") {
                console.log("<COMMS> Blank line received - ignoring...");
                ignore = true;
              }
            } else { // result===undefined
              console.log("<COMMS> No response received - ignoring...");
              ignore = true;
            }
            if (ignore) {
              /* Here we have to poke around inside the Comms library internals. Basically
              it just gave us the first line in the input buffer, but there may have been more.
              We take the next line (or undefined) and call ourselves again to handle that.
              Just in case, delay a little to give our previous command time to finish.*/
              setTimeout(function() {
                let connection = Comms.getConnection();
                let newLineIdx = connection.received.indexOf("\n");
                let l = undefined;
                if (newLineIdx>=0) {
                  l = connection.received.substr(0,newLineIdx);
                  connection.received = connection.received.substr(newLineIdx+1);
                }
                responseHandler(l);
              }, 500);
            } else {
              // Not a response we expected and we're not ignoring!
              Progress.hide({sticky:true});
              return reject("Unexpected response "+(result?JSON.stringify(result):"<empty>"));
            }
          }
          // Actually write the command with a 'print OK' at the end, and use responseHandler
          // to deal with the response. If OK we call uploadCmd to upload the next block
          return Comms.write(`${cmd};${Comms.getProgressCmd(currentBytes / maxBytes)}${Comms.espruinoDevice}.println("OK")\n`,{waitNewLine:true}).then(responseHandler);
        }

        uploadCmd()
      }));
  },
  /** Upload an app
     app : an apps.json structure (i.e. with `storage`)
     options : { device : { id : ..., version : ... } info about the currently connected device
                 language : object of translations, eg 'lang/de_DE.json'
                 noReset : if true, don't reset the device before
                 noFinish : if true, showUploadFinished isn't called (displaying the reboot message)
     } */
  uploadApp : (app,options) => {
    options = options||{};
    Progress.show({title:`Uploading ${app.name}`,sticky:true});
    return AppInfo.getFiles(app, {
      fileGetter : httpGet,
      settings : SETTINGS,
      language : options.language,
      device : options.device
    }).then(fileContents => {
      return new Promise((resolve,reject) => {
        console.log("<COMMS> uploadApp:",fileContents.map(f=>f.name).join(", "));
        let maxBytes = fileContents.reduce((b,f)=>b+f.cmd.length, 0)||1;
        let currentBytes = 0;

        let appInfoFileName = AppInfo.getAppInfoFilename(app);
        let appInfoFile = fileContents.find(f=>f.name==appInfoFileName);
        let appInfo = undefined;
        if (appInfoFile)
          appInfo = JSON.parse(appInfoFile.content);
        else if (app.type!="RAM" && app.type!="defaultconfig")
          reject(`${appInfoFileName} not found`);

        // Upload each file one at a time
        function doUploadFiles() {
          // No files left - print 'reboot' message
          if (fileContents.length==0) {
            (options.noFinish ? Promise.resolve() : Comms.showUploadFinished()).then(() => {
              Progress.hide({sticky:true});
              resolve(appInfo);
            }).catch(function() {
              reject("");
            });
            return;
          }
          let f = fileContents.shift();
          // Only upload as a packet if it makes sense for the file, connection supports it, as does device firmware
          let uploadPacket = (!!f.canUploadPacket) && Comms.supportsPacketUpload();

          function startUpload() {
            console.log(`<COMMS> Upload ${f.name} => ${JSON.stringify(f.content.length>50 ? f.content.substr(0,50)+"..." : f.content)} (${f.content.length}b${uploadPacket?", binary":""})`);
            if (uploadPacket) {
              return Comms.getConnection().espruinoSendFile(f.name, f.content, {
                fs: Const.FILES_IN_FS,
                chunkSize: Const.PACKET_UPLOAD_CHUNKSIZE,
                noACK: Const.PACKET_UPLOAD_NOACK
              });
            } else {
              return Comms.uploadCommandList(f.cmd, currentBytes, maxBytes);
            }
          }

          startUpload().then(doUploadFiles, function(err) {
            console.warn("First attempt failed:", err);
            if (Const.PACKET_UPLOAD_CHUNKSIZE > 256) {
              // Espruino 2v25 has a 1 sec packet timeout (which isn't enough for 2kb packets if sending 20b at a time)
              // https://github.com/espruino/BangleApps/issues/3792#issuecomment-2804668109
              console.warn(`Using lower upload chunk size (${Const.PACKET_UPLOAD_CHUNKSIZE} ==> 256)`);
              Const.PACKET_UPLOAD_CHUNKSIZE = 256;
            }
            startUpload().then(doUploadFiles, function(err) {
              console.warn("Second attempt failed - bailing.", err);
              reject(err)
            });
          });

          currentBytes += f.cmd.length;
        }

        // Start the upload
        function doUpload() {
          Comms.showMessage(`Uploading\n${app.id}...`).
            then(() => Comms.write("\x10"+Comms.getProgressCmd()+"\n")).
            then(() => {
              doUploadFiles();
            }).catch(function() {
              Progress.hide({sticky:true});
              return reject("");
            });
        }
        if (options.noReset) {
          doUpload();
        } else {
        // reset to ensure we have enough memory to upload what we need to
          Comms.reset().then(doUpload, reject)
        }
      });
    });
  },
  // Get Device ID, version, storage stats, and a JSON list of installed apps
  getDeviceInfo : (noReset) => {
    Progress.show({title:`Getting device info...`,sticky:true});
    return Comms.write("\x03").then(result => {
      if (result===null) {
        Progress.hide({sticky:true});
        return Promise.reject("No response");
      }

      let interrupts = 0;
      const checkCtrlC = result => {
        if (result.endsWith("debug>")) {
          if (interrupts > 3) {
            console.log("<COMMS> can't interrupt watch out of debug mode, giving up.", result);
            return Promise.reject("Stuck in debug mode");
          }
          console.log("<COMMS> watch was in debug mode, interrupting.", result);
          // we got a debug prompt - we interrupted the watch while JS was executing
          // so we're in debug mode, issue another ctrl-c to bump the watch out of it
          interrupts++;
          return Comms.write("\x03").then(checkCtrlC);
        } else {
          return result;
        }
      };

      return checkCtrlC(result);
    }).
      then((result) => new Promise((resolve, reject) => {
        console.log("<COMMS> Ctrl-C gave",JSON.stringify(result));
        if (result.includes("ERROR") && !noReset) {
          console.log("<COMMS> Got error, resetting to be sure.");
          // If the ctrl-c gave an error, just reset totally and
          // try again (need to display 'BTN3' message)
          Comms.reset().
            then(()=>Comms.showMessage(Const.MESSAGE_RELOAD)).
            then(()=>Comms.getDeviceInfo(true)).
            then(resolve);
          return;
        }

        /* We need to figure out the console device name according to Espruino. For some devices
        it's easy (eg Bangle.js = Bluetooth) and we can hard code with Const.CONNECTION_DEVICE
        but for others we must figure it out */
        let connection = Comms.getConnection();
        if (Comms.espruinoDevice === undefined) {
          if (Const.CONNECTION_DEVICE)
            Comms.espruinoDevice = Const.CONNECTION_DEVICE;
          else {
            Comms.eval("process.env.CONSOLE").then(device => {
              if (("string"==typeof device) && device.length>0)
                Comms.espruinoDevice = device;
              else throw new Error("Unable to find Espruino console device");
              console.log("<COMMS> Set console device to "+device);
            }).then(()=>Comms.getDeviceInfo(true))
              .then(resolve);
            return;
          }
        }
        if (Comms.getConnection().endpoint && Comms.getConnection().endpoint.name == "Web Serial" && Comms.espruinoDevice=="Bluetooth") {
          console.log("<COMMS> Using Web Serial, forcing Comms.espruinoDevice='USB'", result);
          // FIXME: won't work on ESP8266/ESP32!
          Comms.espruinoDevice = "USB";
        }
        if (Comms.getConnection().endpoint && Comms.getConnection().endpoint.name == "Web Bluetooth" && Comms.espruinoDevice!="Bluetooth") {
          console.log("<COMMS> Using Web Bluetooth, forcing Comms.espruinoDevice='Bluetooth'", result);
          Comms.espruinoDevice = "Bluetooth";
        }

        let cmd, finalJS = `JSON.stringify(require("Storage").getStats?require("Storage").getStats():{})+","+E.toJS([process.env.BOARD,process.env.VERSION,process.env.EXPTR,process.env.MODULES,0|getTime(),E.CRC32(getSerial()+(global.NRF?NRF.getAddress():0))]).substr(1)`;
        let device = Comms.espruinoDevice;
        if (Const.SINGLE_APP_ONLY) // only one app on device, info file is in app.info
          cmd = `\x10${device}.println("["+(require("Storage").read("app.info")||"null")+","+${finalJS})\n`;
        else if (Const.FILES_IN_FS) // file in a FAT filesystem
          cmd = `\x10${device}.print("[");let fs=require("fs");if (!fs.statSync("APPINFO"))fs.mkdir("APPINFO");fs.readdirSync("APPINFO").forEach(f=>{if (!fs.statSync("APPINFO/"+f).dir){var j=JSON.parse(fs.readFileSync("APPINFO/"+f))||"{}";${device}.print(JSON.stringify({id:f.slice(0,-5),version:j.version,files:j.files,data:j.data,type:j.type})+",")}});${device}.println(${finalJS})\n`;
        else // the default, files in Storage
          cmd = `\x10${device}.print("[");require("Storage").list(/\\.info$/).forEach(f=>{var j=require("Storage").readJSON(f,1)||{};${device}.print(JSON.stringify({id:f.slice(0,-5),version:j.version,files:j.files,data:j.data,type:j.type})+",")});${device}.println(${finalJS})\n`;
        Comms.write(cmd, {waitNewLine:true}).then(appListStr => {
          Progress.hide({sticky:true});
          if (!appListStr) appListStr="";
          let connection = Comms.getConnection();
          if (connection) {
            appListStr = appListStr+"\n"+connection.received; // add *any* information we have received so far, including what was returned
            connection.received = ""; // clear received data just in case
          }
          // we may have received more than one line - we're looking for an array (starting with '[')
          let lines = appListStr ? appListStr.split("\n").map(l=>l.trim()) : [];
          let appListJSON = lines.find(l => l[0]=="[");
          // check to see if we got our data
          if (!appListJSON) {
            console.log("No JSON, just got: "+JSON.stringify(appListStr));
            return reject("No response from device. Is 'Programmable' set to 'Off'?");
          }
          // now try and parse
          let err, info = {};
          let appList;
          try {
            appList = JSON.parse(appListJSON);
            // unpack the last 6 elements which are board info (See finalJS above)
            info.uid = appList.pop(); // unique ID for watch (hash of internal serial number and MAC)
            info.currentTime = appList.pop()*1000; // time in ms
            info.modules = appList.pop().split(","); // see what modules we have internally so we don't have to upload them if they exist
            info.exptr = appList.pop(); // used for compilation
            info.version = appList.pop();
            info.id = appList.pop();
            info.storageStats = appList.pop(); // how much storage has been used
            if (info.storageStats.totalBytes && (info.storageStats.freeBytes*10<info.storageStats.totalBytes)) {
              let suggest = "";
              if (info.id.startsWith("BANGLEJS") && info.storageStats.trashBytes*10>info.storageStats.totalBytes)
                suggest = "Try running 'Compact Storage' from Bangle.js 'Settings' -> 'Utils'.";
              showToast(`Low Disk Space: ${Math.round(info.storageStats.freeBytes/1000)}k of ${Math.round(info.storageStats.totalBytes/1000)}k remaining on this device.${suggest} See 'More...' -> 'Device Info' for more information.`,"warning");
            }
            // if we just have 'null' then it means we have no apps
            if (appList.length==1 && appList[0]==null)
              appList = [];
          } catch (e) {
            appList = null;
            console.log("<COMMS> ERROR Parsing JSON",e.toString());
            console.log("<COMMS> Actual response: ",JSON.stringify(appListStr));
            err = "Invalid JSON";
          }
          if (appList===null) return reject(err || "");
          info.apps = appList;
          console.log("<COMMS> getDeviceInfo", info);
          resolve(info);
        }, true /* callback on newline */);
      }));
  },
  // Get an app's info file from Bangle.js
  getAppInfo : app => {
    let cmd;

    return (Comms.espruinoDevice?Promise.resolve():Comms.getDeviceInfo(true/*noreset*/)) // ensure Comms.espruinoDevice is set
      .then(() => {
        if (Const.FILES_IN_FS) cmd = `\x10${Comms.espruinoDevice}.println(require("fs").readFileSync(${JSON.stringify(AppInfo.getAppInfoFilename(app))})||"null")\n`;
        else cmd = `\x10${Comms.espruinoDevice}.println(require("Storage").read(${JSON.stringify(AppInfo.getAppInfoFilename(app))})||"null")\n`;
        return Comms.write(cmd).
          then(appJSON=>{
            let app;
            try {
              app = JSON.parse(appJSON);
            } catch (e) {
              app = null;
              console.log("<COMMS> ERROR Parsing JSON",e.toString());
              console.log("<COMMS> Actual response: ",JSON.stringify(appJSON));
              throw new Error("Invalid JSON");
            }
            return app;
          });
      });
  },
  /** Remove an app given an appinfo.id structure as JSON
  expects an appid.info structure with minimum app.id
  if options.containsFileList is true, don't get data from watch
  if options.noReset is true, don't reset the device before
  if options.noFinish is true, showUploadFinished isn't called (displaying the reboot message)   */
  removeApp : (app, options) => {
    options = options||{};
    Progress.show({title:`Removing ${app.id}`,sticky:true});
    /* App Info now doesn't contain .files, so to erase, we need to
    read the info file ourselves. */
    return (options.noReset ? Promise.resolve() : Comms.reset()).
      then(()=>Comms.showMessage(`Erasing\n${app.id}...`)).
      then(()=>options.containsFileList ? app : Comms.getAppInfo(app)).
      then(app=>{
        let cmds = '';
        // remove App files: regular files, exact names only
        if ("string"!=typeof app.files) {
          console.warn("App file "+app.id+".info doesn't have a 'files' field");
          app.files=app.id+".info";
        }
        if (Const.FILES_IN_FS)
          cmds += app.files.split(',').filter(f=>f!="").map(file => `\x10require("fs").unlinkSync(${Utils.toJSString(file)});\n`).join("");
        else
          cmds += app.files.split(',').filter(f=>f!="").map(file => `\x10require("Storage").erase(${Utils.toJSString(file)});\n`).join("");
        // remove app Data: (dataFiles and storageFiles)
        const data = AppInfo.parseDataString(app.data)
        const isGlob = f => /[?*]/.test(f)
        //   regular files, can use wildcards
        cmds += data.dataFiles.map(file => {
          if (!isGlob(file)) return `\x10require("Storage").erase(${Utils.toJSString(file)});\n`;
          const regex = new RegExp(globToRegex(file))
          return `\x10require("Storage").list(${regex}).forEach(f=>require("Storage").erase(f));\n`;
        }).join("");
        //   storageFiles, can use wildcards
        cmds += data.storageFiles.map(file => {
          if (!isGlob(file)) return `\x10require("Storage").open(${Utils.toJSString(file)},'r').erase();\n`;
          // storageFiles have a chunk number appended to their real name
          const regex = globToRegex(file+'\u0001')
          // open() doesn't want the chunk number though
          let cmd = `\x10require("Storage").list(${regex}).forEach(f=>require("Storage").open(f.substring(0,f.length-1),'r').erase());\n`
          // using a literal \u0001 char fails (not sure why), so escape it
          return cmd.replace('\u0001', '\\x01')
        }).join("");
        console.log("<COMMS> removeApp", cmds);
        if (cmds!="") return Comms.write(cmds);
      }).
      then(()=>options.noFinish ? Promise.resolve() : Comms.showUploadFinished()).
      then(()=>Progress.hide({sticky:true})).
      catch(function(reason) {
        Progress.hide({sticky:true});
        return Promise.reject(reason);
      });
  },
  // Remove all apps from the device
  removeAllApps : () => {
    console.log("<COMMS> removeAllApps start");
    Progress.show({title:"Removing all apps",percent:"animate",sticky:true});

    return (Comms.espruinoDevice?Promise.resolve():Comms.getDeviceInfo(true/*noreset*/)) // ensure Comms.espruinoDevice is set
      .then(() => new Promise((resolve,reject) => {
        let timeout = 5;
        function handleResult(result,err) {
          console.log("<COMMS> removeAllApps: received "+JSON.stringify(result));
          if (result=="" && (timeout--)) {
            console.log("<COMMS> removeAllApps: no result - waiting some more ("+timeout+").");
            // send space and delete - so it's something, but it should just cancel out
            Comms.write(" \u0008", {waitNewLine:true}).then(handleResult);
          } else {
            Progress.hide({sticky:true});
            if (!result || result.trim()!="OK") {
              if (!result) result = "No response";
              else result = "Got "+JSON.stringify(result.trim());
              return reject(err || result);
            } else resolve();
          }
        }
        // Use write with newline here so we wait for it to finish
        let cmd = `\x10E.showMessage("Erasing...");require("Storage").eraseAll();${Comms.espruinoDevice}.println("OK");reset()\n`;
        Comms.write(cmd,{waitNewLine:true}).then(handleResult);
      }).then(() => new Promise(resolve => {
        console.log("<COMMS> removeAllApps: Erase complete, waiting 500ms for 'reset()'");
        setTimeout(resolve, 500);
      }))); // now wait a second for the reset to complete
  },
  // Set the time on the device
  setTime : () => {
    /* connect FIRST, then work out the time - otherwise
    we end up with a delay dependent on how long it took
    to open the device chooser. */
    return Comms.write(" \x08").then(() => { // send space+backspace (eg no-op)
      let d = new Date();
      let tz = d.getTimezoneOffset()/-60
      let cmd = '\x10setTime('+(d.getTime()/1000)+');';
      // in 1v93 we have timezones too
      cmd += 'E.setTimeZone('+tz+');';
      cmd += "(s=>s&&(s.timezone="+tz+",require('Storage').write('setting.json',s)))(require('Storage').readJSON('setting.json',1))\n";
      return Comms.write(cmd);
    });
  },
  // Reset the device
  resetDevice : () => {
    let cmd = "load();\n";
    return Comms.write(cmd);
  },
  // Force a disconnect from the device
  disconnectDevice: () => {
    let connection = Comms.getConnection();
    if (!connection) return;
    connection.close();
  },
  // call back when the connection state changes
  watchConnectionChange : cb => {
    let connected = Comms.isConnected();

    //TODO Switch to an event listener when Puck will support it
    let interval = setInterval(() => {
      let newConnected = Comms.isConnected();
      if (connected === newConnected) return;
      connected = newConnected;
      if (!connected)
        Comms.espruinoDevice = undefined;
      cb(connected);
    }, 1000);

    //stop watching
    return () => {
      clearInterval(interval);
    };
  },
  // List all files on the device.
  // options can be undefined, or {sf:true} for only storage files, or  {sf:false} for only normal files
  listFiles : (options) => {
    let args = "";
    if (options && options.sf!==undefined) args=`undefined,{sf:${options.sf}}`;
    //use encodeURIComponent to serialize octal sequence of append files
    return Comms.eval(`require("Storage").list(${args}).map(encodeURIComponent)`, (files,err) => {
      if (files===null) return Promise.reject(err || "");
      files = files.map(decodeURIComponent);
      console.log("<COMMS> listFiles", files);
      return files;
    });
  },
  // Execute some code, and read back the block of text it outputs (first line is the size in bytes for progress)
  readTextBlock : (code) => {
    return new Promise((resolve,reject) => {
      // Use "\xFF" to signal end of file (can't occur in StorageFiles anyway)
      let fileContent = "";
      let fileSize = undefined;
      let connection = Comms.getConnection();
      connection.received = "";
      connection.cb = function(d) {
        let finished = false;
        let eofIndex = d.indexOf("\xFF");
        if (eofIndex>=0) {
          finished = true;
          d = d.substr(0,eofIndex);
        }
        fileContent += d;
        if (fileSize === undefined) {
          let newLineIdx = fileContent.indexOf("\n");
          if (newLineIdx>=0) {
            fileSize = parseInt(fileContent.substr(0,newLineIdx));
            console.log("<COMMS> size is "+fileSize);
            fileContent = fileContent.substr(newLineIdx+1);
          }
        } else {
          Progress.show({percent:100*fileContent.length / (fileSize||1000000)});
        }
        if (finished) {
          Progress.hide();
          connection.received = "";
          connection.cb = undefined;
          resolve(fileContent);
        }
      };
      connection.write(code,() => {
        console.log(`<COMMS> readTextBlock read started...`);
      });
    });
  },
  // Read a non-storagefile file
  readFile : (filename) => {
    Progress.show({title:`Reading ${JSON.stringify(filename)}`,percent:0});
    console.log(`<COMMS> readFile ${JSON.stringify(filename)}`);
    const CHUNKSIZE = 384;
    return (Comms.espruinoDevice?Promise.resolve():Comms.getDeviceInfo(true/*noreset*/)) // ensure Comms.espruinoDevice is set
      .then(() => Comms.readTextBlock(`\x10(function() {
var s = require("Storage").read(${JSON.stringify(filename)});
if (s===undefined) s="";
${Comms.espruinoDevice}.println(((s.length+2)/3)<<2);
for (var i=0;i<s.length;i+=${CHUNKSIZE}) ${Comms.espruinoDevice}.print(btoa(s.substr(i,${CHUNKSIZE})));
${Comms.espruinoDevice}.print("\\xFF");
})()\n`).then(text => {
        return Utils.atobSafe(text);
      }));
  },
  // Read a storagefile
  readStorageFile : (filename) => { // StorageFiles are different to normal storage entries
    Progress.show({title:`Reading ${JSON.stringify(filename)}`,percent:0});
    console.log(`<COMMS> readStorageFile ${JSON.stringify(filename)}`);
    return (Comms.espruinoDevice?Promise.resolve():Comms.getDeviceInfo(true/*noreset*/)) // ensure Comms.espruinoDevice is set
      .then(() => Comms.readTextBlock(`\x10(function() {
      var f = require("Storage").open(${JSON.stringify(filename)},"r");
      ${Comms.espruinoDevice}.println(f.getLength());
      var l = f.readLine();
      while (l!==undefined) { ${Comms.espruinoDevice}.print(l); l = f.readLine(); }
      ${Comms.espruinoDevice}.print("\\xFF");
    })()\n`));
  },
  // Read a non-storagefile file
  writeFile : (filename, data) => {
    console.log(`<COMMS> writeFile ${JSON.stringify(filename)} (${data.length}b)`);
    Progress.show({title:`Writing ${JSON.stringify(filename)}`,percent:0});
    if (Comms.supportsPacketUpload()) {
      return Comms.getConnection().espruinoSendFile(filename, data, {
        chunkSize: Const.PACKET_UPLOAD_CHUNKSIZE,
        noACK: Const.PACKET_UPLOAD_NOACK
      });
    } else {
      let cmds = AppInfo.getFileUploadCommands(filename, data);
      return Comms.write("\x10"+Comms.getProgressCmd()+"\n").then(() =>
        Comms.uploadCommandList(cmds, 0, cmds.length)
      );
    }
  },
};
