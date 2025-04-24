/* Node.js library with utilities to handle using the app loader from node.js */
/*global exports,global,__dirname,require,Promise */

let DEVICEID = "BANGLEJS2";
let VERSION = "2v11";
let MINIFY = true; // minify JSON?
let BASE_DIR = __dirname + "/../..";
let APPSDIR = BASE_DIR+"/apps/";

//eval(require("fs").readFileSync(__dirname+"../core/js/utils.js"));
let Espruino = require(__dirname + "/../../core/lib/espruinotools.js");
//eval(require("fs").readFileSync(__dirname + "/../../core/lib/espruinotools.js").toString());
//eval(require("fs").readFileSync(__dirname + "/../../core/js/utils.js").toString());
let AppInfo = require(__dirname+"/../../core/js/appinfo.js");

let SETTINGS = {
  pretokenise : true
};
global.Const = {
  /* Are we only putting a single app on a device? If so
  apps should all be saved as .bootcde and we write info
  about the current app into app.info */
  SINGLE_APP_ONLY : false,
};

let apps = [];
// eslint-disable-next-line no-redeclare
let device = { id : DEVICEID, appsInstalled : [] };
let language; // Object of translations

/* This resets the list of installed apps to an empty list.
  It can be used in case the device behind the apploader has changed
  after init (i.e. emulator factory reset) so the dependency
  resolution does not skip no longer installed apps.
*/
exports.reset = function(){
  device.appsInstalled = [];
}

/* call with {
  DEVICEID:"BANGLEJS/BANGLEJS2"
  VERSION:"2v20"
  language: undefined / "lang/de_DE.json"
} */
exports.init = function(options) {
  if (options.DEVICEID) {
    DEVICEID = options.DEVICEID;
    device.id = options.DEVICEID;
  }
  if (options.VERSION)
    VERSION = options.VERSION;
  if (options.language) {
    language = JSON.parse(require("fs").readFileSync(BASE_DIR+"/"+options.language));
  }
  // Try loading from apps.json
  apps.length=0;
  try {
    let appsStr = require("fs").readFileSync(BASE_DIR+"/apps.json");
    let appList = JSON.parse(appsStr);
    appList.forEach(a => apps.push(a));
  } catch (e) {
    console.log("Couldn't load apps.json", e.toString());
  }
  // Load app metadata from each app
  if (!apps.length) {
    console.log("Loading apps/.../metadata.json");
    let dirs = require("fs").readdirSync(APPSDIR, {withFileTypes: true});
    dirs.forEach(dir => {
      let appsFile;
      if (dir.name.startsWith("_example") || !dir.isDirectory())
        return;
      try {
        appsFile = require("fs").readFileSync(APPSDIR+dir.name+"/metadata.json").toString();
      } catch (e) {
        console.error(dir.name+"/metadata.json does not exist");
        return;
      }
      apps.push(JSON.parse(appsFile));
    });
  }
};

exports.AppInfo = AppInfo;
exports.apps = apps;

// used by getAppFiles
function fileGetter(url) {
  url = BASE_DIR+"/"+url;
  console.log("Loading "+url)
  let data;
  if (MINIFY && url.endsWith(".json")) {
    let f = url.slice(0,-5);
    console.log("MINIFYING JSON "+f);
    let j = eval("("+require("fs").readFileSync(url).toString("binary")+")");
    data = JSON.stringify(j); // FIXME we can do better for Espruino
  } else {
    let blob = require("fs").readFileSync(url);
    if (url.endsWith(".js") || url.endsWith(".json"))
      data = blob.toString(); // allow JS/etc to be written in UTF-8
    else
      data = blob.toString("binary")
  }
  return Promise.resolve(data);
}

exports.getAppFiles = function(app) {
  let allFiles = [];
  let getFileOptions = {
    fileGetter : fileGetter,
    settings : SETTINGS,
    device : { id : DEVICEID, version : VERSION },
    language : language
  };
  let uploadOptions = {
    apps : apps,
    needsApp : app => {
      if (app.provides_modules) {
        if (!app.files) app.files="";
        app.files = app.files.split(",").concat(app.provides_modules).join(",");
      }
      return AppInfo.getFiles(app, getFileOptions).then(files => { allFiles = allFiles.concat(files); return app; });
    },
    showQuery : () => Promise.resolve()
  };
  return AppInfo.checkDependencies(app, device, uploadOptions).
    then(() => AppInfo.getFiles(app, getFileOptions)).
    then(files => {
      allFiles = allFiles.concat(files);
      return allFiles;
    });
};

// Get all the files for this app as a string of Storage.write commands
exports.getAppFilesString = function(app) {
  return exports.getAppFiles(app).then(files => {
    return files.map(f=>f.cmd).join("\n")+"\n"
  })
};
