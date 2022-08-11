// Node.js
if ("undefined"!=typeof module) {
  Espruino = require("../lib/espruinotools.js");
  heatshrink = require("../lib/heatshrink.js");
}

// How many bytes of code to we attempt to upload in one go?
const CHUNKSIZE = 1024;

// Converts a string into most efficient way to send to Espruino (either json, base64, or compressed base64)
function toJS(txt, options) {
  /* options = {
    noHeatshrink : bool // don't allow heatshrink - this ensures the result will always be a String (Heatshrink makes an ArrayBuffer)
  }*/
  options = options||{};
  let isBinary = false;
  for (let i=0;i<txt.length;i++) {
    let ch = txt.charCodeAt(i);
    if (ch==0 || ch>127) isBinary=true;
  }
  let json = JSON.stringify(txt);
  let b64 = "atob("+JSON.stringify(Espruino.Core.Utils.btoa(txt))+")";
  let js = (isBinary || (b64.length < json.length)) ? b64 : json;
  if (txt.length>64 && typeof heatshrink !== "undefined" && !options.noHeatshrink) {
    let ua = new Uint8Array(txt.length);
    for (let i=0;i<txt.length;i++)  ua[i] = txt.charCodeAt(i);
    let c = heatshrink.compress(ua);
    if (c.length) {
      // FIXME - why can heatshrink fail? Assert at heatshrink_wrapper.c:42 / heatshrink_wrapper.c:36
      let cs = "";
      for (let i=0;i<c.length;i++)
        cs += String.fromCharCode(c[i]);
      cs = 'require("heatshrink").decompress(atob("'+Espruino.Core.Utils.btoa(cs)+'"))';
      // if it's more than a little smaller, use compressed version
      if (cs.length*4 < js.length*3)
        js = cs;
    }
  }

  return js;
}

// Translate any strings in the app that are prefixed with /*LANG*/
// see https://github.com/espruino/BangleApps/issues/136
function translateJS(options, app, code) {
  let lex = Espruino.Core.Utils.getLexer(code);
  let outjs = "";
  let lastIdx = 0;
  let tok = lex.next();
  while (tok!==undefined) {
    let previousString = code.substring(lastIdx, tok.startIdx);
    let tokenString = code.substring(tok.startIdx, tok.endIdx);
    if (tok.type=="STRING" && previousString.includes("/*LANG*/")) {
      previousString=previousString.replace("/*LANG*/","");
      let language = options.language;
      // strip out formatting at beginning/end
      let match = tok.value.match(/^([.<>\- /\n/]*)([^<>!?]*?)([.<>!?\- /\n/]*)$/);
      let textToTranslate = match ? match[2] : tok.value;
      // now translate
      if (language[app.id] && language[app.id][textToTranslate]) {
        tokenString = JSON.stringify(match[1]+language[app.id][textToTranslate]+match[3]);
      } else if (language.GLOBAL[textToTranslate]) {
        tokenString = JSON.stringify(match[1]+language.GLOBAL[textToTranslate]+match[3]);
      } else {
        // Unhandled translation...
        //console.log("Untranslated ",tokenString);
      }
      // remap any chars that we don't think we can display in Espruino's
      // built in fonts.
      tokenString = convertStringToISOLatin(tokenString);
    }
    outjs += previousString+tokenString;
    lastIdx = tok.endIdx;
    tok = lex.next();
  }

  /*console.log("==================== IN");
  console.log(code);
  console.log("==================== OUT");
  console.log(outjs);*/
  return outjs;
}

// Run JS through EspruinoTools to pull in modules/etc
function parseJS(storageFile, options, app) {
  if (storageFile.url && storageFile.url.endsWith(".js") && !storageFile.url.endsWith(".min.js")) {
    // if original file ends in '.js'...
    let js = storageFile.content;
    // check for language translations
    if (options.language)
      js = translateJS(options, app, js);
    // handle modules
    let localModulesURL = "modules";
    if (typeof window!=="undefined")
      localModulesURL = window.location.origin + window.location.pathname.replace(/[^/]*$/,"") + "modules";
    let builtinModules = ["Flash","Storage","heatshrink","tensorflow","locale","notify"];
    if (options && options.device && options.device.id=="BANGLEJS2")
      builtinModules.push("crypto");
    // add any modules that were defined for this app (no need to search for them!)
    builtinModules = builtinModules.concat(app.storage.map(f=>f.name).filter(name => name && !name.includes(".")));
    // TODO: we could look at installed app files and add any modules defined in those?
    return Espruino.transform(js, {
      SET_TIME_ON_WRITE : false,
      PRETOKENISE : options.settings.pretokenise,
      MODULE_URL : localModulesURL+"|https://www.espruino.com/modules",
      //MINIFICATION_LEVEL : "ESPRIMA", // disable due to https://github.com/espruino/BangleApps/pull/355#issuecomment-620124162
      builtinModules : builtinModules.join(",")
    }).then(content => {
      storageFile.content = content;
      return storageFile;
    });
  } else
    return Promise.resolve(storageFile);
}

var AppInfo = {
  /* Get a list of commands needed to upload the file */
  getFileUploadCommands : (filename, data) => {
    var cmd = "";
    // write code in chunks, in case it is too big to fit in RAM (fix #157)
    var cmd = `\x10require('Storage').write(${JSON.stringify(filename)},${toJS(data.substr(0,CHUNKSIZE))},0,${data.length});`;
    for (let i=CHUNKSIZE;i<data.length;i+=CHUNKSIZE)
      cmd += `\n\x10require('Storage').write(${JSON.stringify(filename)},${toJS(data.substr(i,CHUNKSIZE))},${i});`;
    return cmd;
  },
  /* Get a list of commands needed to upload a storage file */
  getStorageFileUploadCommands : (filename, data) => {
    var cmd = "";
    // write code in chunks, in case it is too big to fit in RAM (fix #157)
    function getWriteData(offset) {
      return toJS(data.substr(offset,CHUNKSIZE), {noHeatshrink:true});
      // noHeatshrink:true fixes https://github.com/espruino/BangleApps/issues/2068
      // If we give f.write `[65,66,67]` it writes it as `65,66,67` rather than `"ABC"`
      // so we must ensure we always return a String
      // We could use E.toString but https://github.com/espruino/BangleApps/issues/2068#issuecomment-1211717749
    }
    var cmd = `\x10f=require('Storage').open(${JSON.stringify(filename)},'w');f.write(${getWriteData(0)});`;
    for (let i=CHUNKSIZE;i<data.length;i+=CHUNKSIZE)
      cmd += `\n\x10f.write(${getWriteData(i)});`;
    return cmd;
  },
  /* Get files needed for app.
     options = {
        fileGetter : callback for getting URL,
        settings : global settings object
        device : { id : ..., version : ... } info about the currently connected device
        language : object of translations, eg 'lang/de_DE.json'
      }
      */
  getFiles : (app,options) => {
    options = options||{};
    return new Promise((resolve,reject) => {
      // Load all files
      let appFiles = [].concat(
        app.storage,
        app.data&&app.data.filter(f=>f.url||f.content).map(f=>(f.noOverwrite=true,f.dataFile=true,f))||[]);
      //console.log(appFiles)
      // does the app's file list have a 'supports' entry?
      if (appFiles.some(file=>file.supports)) {
        if (!options.device || !options.device.id)
          return reject("App storage contains a 'supports' field, but no device ID found");
        appFiles = appFiles.filter(file=>{
          if (!file.supports) return true;
          return file.supports.includes(options.device.id);
        });
      }

      Promise.all(appFiles.map(storageFile => {
        if (storageFile.content!==undefined)
          return Promise.resolve(storageFile).then(storageFile => parseJS(storageFile,options,app));
        else if (storageFile.url)
          return options.fileGetter(`apps/${app.id}/${storageFile.url}`).then(content => {
            return {
              name : storageFile.name,
              url : storageFile.url,
              content : content,
              evaluate : storageFile.evaluate,
              noOverwrite : storageFile.noOverwrite,
              dataFile : !!storageFile.dataFile
            }}).then(storageFile => parseJS(storageFile,options,app));
        else return Promise.resolve();
      })).then(fileContents => { // now we just have a list of files + contents...
        // filter out empty files
        fileContents = fileContents.filter(x=>x!==undefined);
        // if it's a 'ram' app, don't add any app JSON file
        if (app.type=="RAM") return fileContents;
        // Add app's info JSON
        return AppInfo.createAppJSON(app, fileContents);
      }).then(fileContents => {
        // then map each file to a command to load into storage
        fileContents.forEach(storageFile => {
          // format ready for Espruino
          if (storageFile.name=="RAM") {
            storageFile.cmd = "\x10"+storageFile.content.trim();
          } else if (storageFile.evaluate) {
            let js = storageFile.content.trim();
            if (js.endsWith(";"))
              js = js.slice(0,-1);
            storageFile.cmd = `\x10require('Storage').write(${JSON.stringify(storageFile.name)},${js});`;
          } else {
            storageFile.cmd = AppInfo.getFileUploadCommands(storageFile.name, storageFile.content);
          }
          // if we're not supposed to overwrite this file... this gets set
          // automatically for data files that are loaded
          if (storageFile.noOverwrite) {
            storageFile.cmd = `\x10var _e = require('Storage').read(${JSON.stringify(storageFile.name)})===undefined;\n` +
                              storageFile.cmd.replace(/\x10/g,"\x10if(_e)") + "delete _e;";
          }
        });
        resolve(fileContents);
      }).catch(err => reject(err));
    });
  },
  getAppInfoFilename : (app) => {
    if (Const.SINGLE_APP_ONLY) // only one app on device, info file is in app.info
      return "app.info";
    else
      return app.id+".info";
  },
  createAppJSON : (app, fileContents) => {
    return new Promise((resolve,reject) => {
      let appInfoFileName = AppInfo.getAppInfoFilename(app);
      // Check we don't already have a JSON file!
      let appJSONFile = fileContents.find(f=>f.name==appInfoFileName);
      if (appJSONFile) reject("App JSON file explicitly specified!");
      // Now actually create the app JSON
      let json = {
        id : app.id
      };
      if (app.shortName) json.name = app.shortName;
      else json.name = app.name;
      if (app.type && app.type!="app") json.type = app.type;
      if (fileContents.find(f=>f.name==app.id+".app.js"))
        json.src = app.id+".app.js";
      if (fileContents.find(f=>f.name==app.id+".img"))
        json.icon = app.id+".img";
      if (app.sortorder) json.sortorder = app.sortorder;
      if (app.version) json.version = app.version;
      if (app.tags) json.tags = app.tags;
      let fileList = fileContents.filter(storageFile=>!storageFile.dataFile).map(storageFile=>storageFile.name).filter(n=>n!="RAM");
      fileList.unshift(appInfoFileName); // do we want this? makes life easier!
      json.files = fileList.join(",");
      if ('data' in app) {
        let data = {dataFiles: [], storageFiles: []};
        // add "data" files to appropriate list
        app.data.forEach(d=>{
          if (d.storageFile) data.storageFiles.push(d.name||d.wildcard)
          else data.dataFiles.push(d.name||d.wildcard)
        })
        const dataString = AppInfo.makeDataString(data)
        if (dataString) json.data = dataString
      }
      fileContents.push({
        name : appInfoFileName,
        content : JSON.stringify(json)
      });
      resolve(fileContents);
    });
  },
  // (<appid>.info).data holds filenames of data: both regular and storageFiles
  // These are stored as:  (note comma vs semicolons)
  //   "fil1,file2", "file1,file2;storageFileA,storageFileB" or ";storageFileA"
  /**
   * Convert appid.info "data" to object with file names/patterns
   * Passing in undefined works
   * @param data "data" as stored in appid.info
   * @returns {{storageFiles:[], dataFiles:[]}}
   */
  parseDataString(data) {
    data = data || '';
    let [files = [], storage = []] = data.split(';').map(d => d.split(','));
    if (files.length==1 && files[0]=="") files = []; // hack for above code
    return {dataFiles: files, storageFiles: storage}
  },
  /**
   * Convert object with file names/patterns to appid.info "data" string
   * Passing in an incomplete object will not work
   * @param data {{storageFiles:[], dataFiles:[]}}
   * @returns {string} "data" to store in appid.info
   */
  makeDataString(data) {
    if (!data.dataFiles.length && !data.storageFiles.length) { return '' }
    if (!data.storageFiles.length) { return data.dataFiles.join(',') }
    return [data.dataFiles.join(','),data.storageFiles.join(',')].join(';')
  },
};

if ("undefined"!=typeof module)
  module.exports = AppInfo;
