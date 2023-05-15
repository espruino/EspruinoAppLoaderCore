//Puck.debug=3;
console.log("=============================================")
console.log("Type 'Puck.debug=3' for full BLE debug info")
console.log("=============================================")

// TODO: Add Comms.write/eval which return promises, and move over to using those
// FIXME: use UART lib so that we handle errors properly
const Comms = {
  // Write the given data, returns a promise
  write : (data) => new Promise((resolve,reject) => {
    return Puck.write(data,function(result) {
      if (result===null) return reject("");
      resolve(result);
    });
  }),
  // Show a message on the screen (if available)
  showMessage : (txt) => {
    console.log(`<COMMS> showMessage ${JSON.stringify(txt)}`);
    if (!Const.HAS_E_SHOWMESSAGE) return Promise.resolve();
    return Comms.write(`\x10E.showMessage(${JSON.stringify(txt)})\n`);
  },
  // When upload is finished, show a message (or reload)
  showUploadFinished : () => {
    if (Const.LOAD_APP_AFTER_UPLOAD || Const.SINGLE_APP_ONLY) return Comms.write("\x10load()\n");
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
  reset : (opt) => new Promise((resolve,reject) => {
    let tries = 8;
    console.log("<COMMS> reset");
    Puck.write(`\x03\x10reset(${opt=="wipe"?"1":""});\n`,function rstHandler(result) {
      console.log("<COMMS> reset: got "+JSON.stringify(result));
      if (result===null) return reject("Connection failed");
      if (result=="" && (tries-- > 0)) {
        console.log(`<COMMS> reset: no response. waiting ${tries}...`);
        Puck.write("\x03",rstHandler);
      } else if (result.endsWith("debug>")) {
        console.log(`<COMMS> reset: watch in debug mode, interrupting...`);
        Puck.write("\x03",rstHandler);
      } else {
        console.log(`<COMMS> reset: rebooted - sending commands to clear out any boot code`);
        // see https://github.com/espruino/BangleApps/issues/1759
        Puck.write("\x10clearInterval();clearWatch();global.Bangle&&Bangle.removeAllListeners();E.removeAllListeners();NRF.removeAllListeners();\n",function() {
          console.log(`<COMMS> reset: complete.`);
          setTimeout(resolve,250);
        });
      }
    });
  }),
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

    return new Promise( (resolve, reject) => {
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
          var ignore = false;
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
            /* Here we have to poke around inside the Puck.js library internals. Basically
            it just gave us the first line in the input buffer, but there may have been more.
            We take the next line (or undefined) and call ourselves again to handle that.
            Just in case, delay a little to give our previous command time to finish.*/

            setTimeout(function() {
              let connection = Puck.getConnection();
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
        Puck.write(`${cmd};${Comms.getProgressCmd(currentBytes / maxBytes)}Bluetooth.println("OK")\n`,responseHandler, true /* wait for a newline*/);
      }

      uploadCmd()
    });
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
        else if (app.type!="RAM")
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
          console.log(`<COMMS> Upload ${f.name} => ${JSON.stringify(f.content)}`);
          Comms.uploadCommandList(f.cmd, currentBytes, maxBytes).then(() => doUploadFiles());
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
  // Get Device ID and version, plus a JSON list of installed apps
  getDeviceInfo : (noReset) => {
    Progress.show({title:`Getting app list...`,sticky:true});
    return new Promise((resolve,reject) => {
      Puck.write("\x03",(result) => {
        if (result===null) {
          Progress.hide({sticky:true});
          return reject("");
        }

        let interrupts = 0;
        const checkCtrlC = result => {
          if (result.endsWith("debug>")) {
            if (interrupts > 3) {
              console.log("<COMMS> can't interrupt watch out of debug mode, giving up.", result);
              reject("");
              return;
            }
            console.log("<COMMS> watch was in debug mode, interrupting.", result);
            // we got a debug prompt - we interrupted the watch while JS was executing
            // so we're in debug mode, issue another ctrl-c to bump the watch out of it
            Puck.write("\x03", checkCtrlC);
            interrupts++;
          } else {
            resolve(result);
          }
        };

        checkCtrlC(result);
      });
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

        let cmd, finalJS = `E.toJS([process.env.BOARD,process.env.VERSION,0|getTime(),E.CRC32(getSerial()+NRF.getAddress())]).substr(1)`;
        if (Const.SINGLE_APP_ONLY) // only one app on device, info file is in app.info
          cmd = `\x10Bluetooth.println("["+(require("Storage").read("app.info")||"null")+","+${finalJS})\n`;
        else
          cmd = `\x10Bluetooth.print("[");require("Storage").list(/\\.info$/).forEach(f=>{var j=require("Storage").readJSON(f,1)||{};Bluetooth.print(JSON.stringify({id:f.slice(0,-5),version:j.version,files:j.files,data:j.data,type:j.type})+",")});Bluetooth.println(${finalJS})\n`;
        Puck.write(cmd, (appListStr,err) => {
          Progress.hide({sticky:true});
          // we may have received more than one line - we're looking for an array (starting with '[')
          var lines = appListStr ? appListStr.split("\n").map(l=>l.trim()) : [];
          var appListJSON = lines.find(l => l[0]=="[");
          // check to see if we got our data
          if (!appListJSON) {
            return reject("No response from device. Is 'Programmable' set to 'Off'?");
          }
          // now try and parse
          let info = {};
          let appList;
          try {
            appList = JSON.parse(appListJSON);
            // unpack the last 4 elements which are board info (See finalJS above)
            info.uid = appList.pop(); // unique ID for watch (hash of internal serial number and MAC)
            info.currentTime = appList.pop()*1000; // time in ms
            info.version = appList.pop();
            info.id = appList.pop();
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
    return Comms.write(`\x10Bluetooth.println(require("Storage").read(${JSON.stringify(AppInfo.getAppInfoFilename(app))})||"null")\n`).
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
        cmds += app.files.split(',').filter(f=>f!="").map(file => `\x10require("Storage").erase(${toJS(file)});\n`).join("");
        // remove app Data: (dataFiles and storageFiles)
        const data = AppInfo.parseDataString(app.data)
        const isGlob = f => /[?*]/.test(f)
        //   regular files, can use wildcards
        cmds += data.dataFiles.map(file => {
          if (!isGlob(file)) return `\x10require("Storage").erase(${toJS(file)});\n`;
          const regex = new RegExp(globToRegex(file))
          return `\x10require("Storage").list(${regex}).forEach(f=>require("Storage").erase(f));\n`;
        }).join("");
        //   storageFiles, can use wildcards
        cmds += data.storageFiles.map(file => {
          if (!isGlob(file)) return `\x10require("Storage").open(${toJS(file)},'r').erase();\n`;
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
    return new Promise((resolve,reject) => {
      let timeout = 5;
      function handleResult(result,err) {
        console.log("<COMMS> removeAllApps: received "+JSON.stringify(result));
        if (result=="" && (timeout--)) {
          console.log("<COMMS> removeAllApps: no result - waiting some more ("+timeout+").");
          // send space and delete - so it's something, but it should just cancel out
          Puck.write(" \u0008", handleResult, true /* wait for newline */);
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
      let cmd = '\x10E.showMessage("Erasing...");require("Storage").eraseAll();Bluetooth.println("OK");reset()\n';
      Puck.write(cmd, handleResult, true /* wait for newline */);
    }).then(() => new Promise(resolve => {
      console.log("<COMMS> removeAllApps: Erase complete, waiting 500ms for 'reset()'");
      setTimeout(resolve, 500);
    })); // now wait a second for the reset to complete
  },
  // Set the time on the device
  setTime : () => {
    /* connect FIRST, then work out the time - otherwise
    we end up with a delay dependent on how long it took
    to open the device chooser. */
    return Comms.write("\x03").then(() => {
      let d = new Date();
      let tz = d.getTimezoneOffset()/-60
      let cmd = '\x10setTime('+(d.getTime()/1000)+');';
      // in 1v93 we have timezones too
      cmd += 'E.setTimeZone('+tz+');';
      cmd += "(s=>s&&(s.timezone="+tz+",require('Storage').write('setting.json',s)))(require('Storage').readJSON('setting.json',1))\n";
      Comms.write(cmd);
    });
  },
  // Reset the device
  resetDevice : () => {
    let cmd = "reset();load()\n";
    return Comms.write(cmd);
  },
  // Force a disconnect from the device
  disconnectDevice: () => {
    let connection = Puck.getConnection();
    if (!connection) return;
    connection.close();
  },
  // call back when the connection state changes
  watchConnectionChange : cb => {
    let connected = Puck.isConnected();

    //TODO Switch to an event listener when Puck will support it
    let interval = setInterval(() => {
      if (connected === Puck.isConnected()) return;

      connected = Puck.isConnected();
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
    return new Promise((resolve,reject) => {
      Puck.write("\x03",(result) => {
        if (result===null) return reject("");
        let args = "";
        if (options && options.sf!==undefined) args=`undefined,{sf:${options.sf}}`;
        //use encodeURIComponent to serialize octal sequence of append files
        Puck.eval(`require("Storage").list(${args}).map(encodeURIComponent)`, (files,err) => {
          if (files===null) return reject(err || "");
          files = files.map(decodeURIComponent);
          console.log("<COMMS> listFiles", files);
          resolve(files);
        });
      });
    });
  },
  // Execute some code, and read back the block of text it outputs (first line is the size in bytes for progress)
  readTextBlock : (code) => {
    return new Promise((resolve,reject) => {
      // Use "\xFF" to signal end of file (can't occur in StorageFiles anyway)
      let fileContent = "";
      let fileSize = undefined;
      let connection = Puck.getConnection();
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
    return Comms.readTextBlock(`\x03\x10(function() {
var s = require("Storage").read(${JSON.stringify(filename)});
Bluetooth.println(((s.length+2)/3)<<2); // estimate file size
for (var i=0;i<s.length;i+=${CHUNKSIZE}) Bluetooth.print(btoa(s.substr(i,${CHUNKSIZE})));
Bluetooth.print("\xFF");
})()\n`).then(text => {
      return atobSafe(text);
    });
  },
  // Read a storagefile
  readStorageFile : (filename) => { // StorageFiles are different to normal storage entries
    Progress.show({title:`Reading ${JSON.stringify(filename)}`,percent:0});
    console.log(`<COMMS> readStorageFile ${JSON.stringify(filename)}`);
    return Comms.readTextBlock(`\x03\x10(function() {
      var f = require("Storage").open(${JSON.stringify(filename)},"r");
      Bluetooth.println(f.getLength());
      var l = f.readLine();
      while (l!==undefined) { Bluetooth.print(l); l = f.readLine(); }
      Bluetooth.print("\xFF");
    })()\n`);
  },
  // Read a non-storagefile file
  writeFile : (filename, data) => {
    console.log(`<COMMS> writeFile ${JSON.stringify(filename)}`);
    var cmds = AppInfo.getFileUploadCommands(filename, data);
    Progress.show({title:`Writing ${JSON.stringify(filename)}`,percent:0});
    return Comms.write("\x10"+Comms.getProgressCmd()+"\n").then(() =>
      Comms.uploadCommandList(cmds, 0, cmds.length)
    );
  }
};
