const Const = {
  /* Are we only putting a single app on a device? If so
  apps should all be saved as .bootcde and we write info
  about the current app into app.info */
  SINGLE_APP_ONLY : false,

  /* Should the app loader call 'load' after apps have
  been uploaded? On Bangle.js we don't do this because we don't
  trust the default clock app not to use too many resources.
  Note: SINGLE_APP_ONLY=true enables LOAD_APP_AFTER_UPLOAD regardless */
  LOAD_APP_AFTER_UPLOAD : false,

  /* Does our device have E.showMessage? */
  HAS_E_SHOWMESSAGE : true,

  /* JSON file containing all app metadata */
  APPS_JSON_FILE: 'apps.json',

  /* base URL, eg https://github.com/${username}/BangleApps/tree/master/apps for
  links when people click on the GitHub link next to an app. undefined = no link*/
  APP_SOURCECODE_URL : undefined,

  /* Message to display when an app has been loaded */
  MESSAGE_RELOAD : 'Hold BTN3\nto reload',

  /* What device are we connecting to Espruino with as far as Espruino is concerned?
  Eg if CONNECTION_DEVICE="Bluetooth" will Bluetooth.println("Hi") send data back to us?
  Leave this as undefined to try and work it out. */
  CONNECTION_DEVICE : undefined,

  /* The code to upload to the device show a progress bar on the screen (should define a fn. called 'p') */
  CODE_PROGRESSBAR : "g.drawRect(10,g.getHeight()-16,g.getWidth()-10,g.getHeight()-8).flip();p=x=>g.fillRect(10,g.getHeight()-16,10+(g.getWidth()-20)*x/100,g.getHeight()-8).flip();",

  /* Maximum number of apps shown in the library, then a 'Show more...' entry is added.. */
  MAX_APPS_SHOWN : 30,

  /* If true, store files using 'fs' module which is a FAT filesystem on SD card, not on internal Storage */
  FILES_IN_FS : false,

  /* How many bytes of code to we attempt to upload in one go? */
  UPLOAD_CHUNKSIZE: 1024,

  /* How many bytes of code to we attempt to upload when uploading via packets? */
  PACKET_UPLOAD_CHUNKSIZE: 2048, // 1024 is the default for UART.js

  /* when uploading by packets should we wait for an ack before sending the next packet? Only works if you're fully confident in flow control. */
  PACKET_UPLOAD_NOACK: false,

  /* Don't try and reset the device when we're connecting/sending apps */
  NO_RESET : false,

  // APP_DATES_CSV   - If set, the URL of a file to get information on the latest apps from
  // APP_USAGE_JSON  - If set, the URL of a file containing the most-used/most-favourited apps
};

let DEVICEINFO = [
  {
    id : "BANGLEJS",
    name : "Bangle.js 1",
    features : ["BLE","BLEHID","GRAPHICS","ACCEL","MAG"],
    g : { width : 240, height : 240, bpp : 16 },
    img : "https://www.espruino.com/img/BANGLEJS_thumb.jpg"
  }, {
    id : "BANGLEJS2",
    name : "Bangle.js 2",
    features : ["BLE","BLEHID","GRAPHICS","ACCEL","MAG","PRESSURE","TOUCH"],
    g : { width : 176, height : 176, bpp : 3 },
    img : "https://www.espruino.com/img/BANGLEJS2_thumb.jpg"
  }, {
    id : "PUCKJS",
    name : "Puck.js",
    features : ["BLE","BLEHID","NFC","GYRO","ACCEL","MAG","RGBLED"],
    img : "https://www.espruino.com/img/PUCKJS_thumb.jpg"
  }, {
    id : "PIXLJS",
    name : "Pixl.js",
    features : ["BLE","BLEHID","NFC","GRAPHICS"],
    g : { width : 128, height : 64, bpp : 1 },
    img : "https://www.espruino.com/img/PIXLJS_thumb.jpg"
  }, {
    id : "JOLTJS",
    name : "Jolt.js",
    features : ["BLE","BLEHID","RGBLED"],
    img : "https://www.espruino.com/img/JOLTJS_thumb.jpg"
  }, {
    id : "MDBT42Q",
    name : "MDBT42Q",
    features : ["BLE","BLEHID"],
    img : "https://www.espruino.com/img/MDBT42Q_thumb.jpg"
  }, {
    id : "PICO_R1_3",
    name : "Espruino Pico",
    features : [],
    img : "https://www.espruino.com/img/PICO_R1_3_thumb.jpg"
  }, {
    id : "ESPRUINOWIFI",
    name : "Espruino Wifi",
    features : ["WIFI"],
    img : "https://www.espruino.com/img/ESPRUINOWIFI_thumb.jpg"
  }, {
    id : "ESPRUINOBOARD",
    name : "Original Espruino",
    features : ["RGBLED"],
    img : "https://www.espruino.com/img/ESPRUINOBOARD_thumb.jpg"
  }, {
    id : "MICROBIT2",
    name : "micro:bit 2",
    features : ["BLE","BLEHID"], // accel/mag/etc don't use an API apps will know
    img : "https://www.espruino.com/img/MICROBIT2_thumb.jpg"
  }, {
    id : "ESP32",
    name : "ESP32",
    features : ["WIFI","BLE"],
    img : "https://www.espruino.com/img/ESP32_thumb.jpg"
  }
];

/* When a char is not in Espruino's iso8859-1 codepage, try and use
these conversions */
const CODEPAGE_CONVERSIONS = {
  // letters
  "ą":"a",
  "ā":"a",
  "č":"c",
  "ć":"c",
  "ě":"e",
  "ę":"e",
  "ē":"e",
  "ģ":"g",
  "ğ":"g",
  "ī":"i",
  "ķ":"k",
  "ļ":"l",
  "ł":"l",
  "ń":"n",
  "ņ":"n",
  "ő":"o",
  "ř":"r",
  "ś":"s",
  "š":"s",
  "ş":"s",
  "ū":"u",
  "ż":"z",
  "ź":"z",
  "ž":"z",
  "Ą":"A",
  "Ā":"A",
  "Č":"C",
  "Ć":"C",
  "Ě":"E",
  "Ę":"E",
  "Ē":"E",
  "Ğ":"G",
  "Ģ":"G",
  "ı":"i",
  "Ķ":"K",
  "Ļ":"L",
  "Ł":"L",
  "Ń":"N",
  "Ņ":"N",
  "Ő":"O",
  "Ř":"R",
  "Ś":"S",
  "Š":"S",
  "Ş":"S",
  "Ū":"U",
  "Ż":"Z",
  "Ź":"Z",
  "Ž":"Z",

  // separators
  " ":" ",
  " ":" ",
};

/// Convert any character that cannot be displayed by Espruino's built in fonts
/// originally https://github.com/espruino/EspruinoAppLoaderCore/pull/11/files
function convertStringToISO8859_1(originalStr) {
  var chars = originalStr.split('');
  for (var i = 0; i < chars.length; i++) {
    var ch = chars[i];
    if (CODEPAGE_CONVERSIONS[ch])
      chars[i] = CODEPAGE_CONVERSIONS[ch];
    else if (chars[i].charCodeAt() > 255) {
      console.log("Skipped conversion of char: '" + chars[i] + "'");
      chars[i] = "?";
    }
  }
  var translatedStr = chars.join('');
  if (translatedStr != originalStr)
    console.log("Remapped text: "+originalStr+" -> "+translatedStr);
  return translatedStr;
}

function escapeHtml(text) {
  let map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}
// simple glob to regex conversion, only supports "*" and "?" wildcards
function globToRegex(pattern) {
  const ESCAPE = '.*+-?^${}()|[]\\';
  const regex = pattern.replace(/./g, c => {
    switch (c) {
      case '?': return '.';
      case '*': return '.*';
      default: return ESCAPE.includes(c) ? ('\\' + c) : c;
    }
  });
  return new RegExp('^'+regex+'$');
}
function htmlToArray(collection) {
  return [].slice.call(collection);
}
function htmlElement(str) {
  let div = document.createElement('div');
  div.innerHTML = str.trim();
  return div.firstChild;
}
function httpGet(url) {
  let textExtensions = [".js", ".json", ".csv", ".txt", ".md"];
  let isBinary = !textExtensions.some(ext => url.endsWith(ext));
  return new Promise((resolve,reject) => {
    let oReq = new XMLHttpRequest();
    oReq.addEventListener("load", () => {
      if (oReq.status!=200) {
        reject(oReq.status+" - "+oReq.statusText)
        return;
      }
      if (!isBinary) {
        resolve(oReq.responseText)
      } else {
        // ensure we actually load the data as a raw 8 bit string (not utf-8/etc)
        let a = new FileReader();
        a.onloadend = function() {
          let bytes = new Uint8Array(a.result);
          let str = "";
          for (let i=0;i<bytes.length;i++)
            str += String.fromCharCode(bytes[i]);
          resolve(str)
        };
        a.readAsArrayBuffer(oReq.response);
      }
    });
    oReq.addEventListener("error", () => reject());
    oReq.addEventListener("abort", () => reject());
    oReq.open("GET", url, true);
    oReq.onerror = function () {
      reject("HTTP Request failed");
    };
    if (isBinary)
      oReq.responseType = 'blob';
    oReq.send();
  });
}
function toJSString(s) {
  if ("string"!=typeof s) throw new Error("Expecting argument to be a String")
  // Could use JSON.stringify, but this doesn't convert char codes that are in UTF8 range
  // This is the same logic that we use in Gadgetbridge
  let json = "\"";
  for (let i=0;i<s.length;i++) {
    let ch = s.charCodeAt(i); // 0..255
    let nextCh = (i+1<s.length ? s.charCodeAt(i+1) : 0); // 0..255
    //rawString = rawString+ch+",";
    if (ch<8) {
      // if the next character is a digit, it'd be interpreted
      // as a 2 digit octal character, so we can't use `\0` to escape it
      if (nextCh>='0' && nextCh<='7') json += "\\x0" + ch;
      else json += "\\" + ch;
    } else if (ch==8) json += "\\b";
    else if (ch==9) json += "\\t";
    else if (ch==10) json += "\\n";
    else if (ch==11) json += "\\v";
    else if (ch==12) json += "\\f";
    else if (ch==34) json += "\\\""; // quote
    else if (ch==92) json += "\\\\"; // slash
    else if (ch<32 || ch==127 || ch==173 ||
              ((ch>=0xC2) && (ch<=0xF4))) // unicode start char range
        json += "\\x"+(ch&255).toString(16).padStart(2,0);
    else if (ch>255)
        json += "\\u"+(ch&65535).toString(16).padStart(4,0);
    else json += s[i];
  }
  return json + "\"";
}
// callback for sorting apps
function appSorter(a,b) {
  if (a.unknown || b.unknown)
    return (a.unknown)? 1 : -1;
  let sa = 0|a.sortorder;
  let sb = 0|b.sortorder;
  if (sa<sb) return -1;
  if (sa>sb) return 1;
  return (a.name==b.name) ? 0 : ((a.name<b.name) ? -1 : 1);
}

// callback for sorting apps (apps which can be updated on top)
function appSorterUpdatesFirst(a,b) {
  if (a.canUpdate || b.canUpdate) {
    return a.canUpdate ? -1 : 1;
  }
  if (a.unknown || b.unknown)
    return (a.unknown)? 1 : -1;
  let sa = 0|a.sortorder;
  let sb = 0|b.sortorder;
  if (sa<sb) return -1;
  if (sa>sb) return 1;
  return (a.name==b.name) ? 0 : ((a.name<b.name) ? -1 : 1);
}

/* This gives us a numeric relevance value based on how well the search string matches,
based on some relatively unscientific heuristics.

searchRelevance("my clock", "lock") == 15
searchRelevance("a lock widget", "lock") == 21

 */
function searchRelevance(value, searchString) {
  value = value.toLowerCase().trim();
  // compare the full string
  let relevance = 0;
  if (value==searchString) // if a complete match, +20
    relevance += 20;
  else {
    if (value.includes(searchString)) // the less of the string matched, lower relevance
      relevance += Math.max(0, 10 - (value.length - searchString.length));
    if (value.startsWith(searchString))  // add a bit if the string starts with it
      relevance += 5;
    if (value.includes("("+searchString+")"))  // add a bit if it's in brackets
      relevance += 5;
  }
  // compare string parts
  var partRelevance = 0;
  var valueParts = value.split(/[\s(),.-]/).filter(p=>p.length);
  searchString.split(/[\s-(),.-]/).forEach(search=>{
    valueParts.forEach(v=>{
      if (v==search)
      partRelevance += 20; // if a complete match, +20
      else {
        if (v.includes(search)) // the less of the string matched, lower relevance
        partRelevance += Math.max(0, 10 - (v.length - search.length));
        if (v.startsWith(search))  // add a bit of the string starts with it
        partRelevance += 10;
      }
    });
  });
  return relevance + 0|(50*partRelevance/valueParts.length);
}

/* Given 2 JSON structures (1st from apps.json, 2nd from an installed app)
work out what to display re: versions and if we can update */
function getVersionInfo(appListing, appInstalled) {
  let versionText = "";
  let canUpdate = false;
  function clicky(v) {
    if (appInstalled)
      return `<a class="c-hand" onclick="showChangeLog('${appListing.id}', '${appInstalled.version}')">${v}</a>`;
    return `<a class="c-hand" onclick="showChangeLog('${appListing.id}')">${v}</a>`;
  }

  if (!appInstalled) {
    if (appListing.version)
      versionText = clicky("v"+appListing.version);
  } else {
    versionText = (appInstalled.version ? (clicky("v"+appInstalled.version)) : "Unknown version");
    if (isAppUpdateable(appInstalled, appListing)) {
      if (appListing.version) {
        versionText += ", latest "+clicky("v"+appListing.version);
        canUpdate = true;
      }
    }
  }
  return {
    text : versionText,
    canUpdate : canUpdate
  }
}

function isAppUpdateable(appInstalled, appListing) {
  return appInstalled.version && appListing.version && versionLess(appInstalled.version, appListing.version);
}

function versionLess(a,b) {
  let v = x => x.split(/[v.]/).reduce((a,b,c)=>a+parseInt(b,10)/Math.pow(1000,c),0);
  return v(a) < v(b);
}

/* Ensure actualFunction is called after delayInMs,
but don't call it more often than needed if 'debounce'
is called multiple times. */
function debounce(actualFunction, delayInMs) {
  let timeout;

  return function debounced(...args) {
    const later = function() {
      clearTimeout(timeout);
      actualFunction(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, delayInMs);
  };
}

// version of 'window.atob' that doesn't fail on 'not correctly encoded' strings
function atobSafe(input) {
  if (input===undefined) return undefined;
  // Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149
  // This code was written by Tyler Akins and has been placed in the
  // public domain.  It would be nice if you left this header intact.
  // Base64 code from Tyler Akins -- http://rumkin.com
  const keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  let output = '';
  let chr1, chr2, chr3;
  let enc1, enc2, enc3, enc4;
  let i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9+/=]/g, '');
  while (i < input.length) {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  }
  return output;
}


// parse relaxed JSON which Espruino's writeJSON uses for settings/etc (returns undefined on failure)
function parseRJSON(str) {
  let lex = Espruino.Core.Utils.getLexer(str);
  let tok = lex.next();
  function match(s) {
    if (tok.str!=s) throw new Error("Expecting "+s+" got "+JSON.stringify(tok.str));
    tok = lex.next();
  }

  function recurse() {
    let final = "";
    while (tok!==undefined) {
      if (tok.type == "NUMBER") {
        let v = parseFloat(tok.str);
        tok = lex.next();
        return v;
      }
      if (tok.str == "-") {
        tok = lex.next();
        let v = -parseFloat(tok.str);
        tok = lex.next();
        return v;
      }
      if (tok.type == "STRING") {
        let v = tok.value;
        tok = lex.next();
        return v;
      }
      if (tok.type == "ID") switch (tok.str) {
        case "true" : tok = lex.next(); return true;
        case "false" : tok = lex.next(); return false;
        case "null" : tok = lex.next(); return null;
      }
      if (tok.str == "[") {
        tok = lex.next();
        let arr = [];
        while (tok.str != ']') {
          arr.push(recurse());
          if (tok.str != ']') match(",");
        }
        match("]");
        return arr;
      }
      if (tok.str == "{") {
        tok = lex.next();
        let obj = {};
        while (tok.str != '}') {
          let key = tok.type=="STRING" ? tok.value : tok.str;
          tok = lex.next();
          match(":");
          obj[key] = recurse();
          if (tok.str != '}') match(",");
        }
        match("}");
        return obj;
      }
      match("EOF");
    }
  }

  let json = undefined;
  try {
    json = recurse();
  } catch (e) {
    console.log("RJSON parse error", e);
  }
  return json;
}

var Utils = {
  Const : Const,
  DEVICEINFO : DEVICEINFO,
  CODEPAGE_CONVERSIONS : CODEPAGE_CONVERSIONS,
  convertStringToISO8859_1 : convertStringToISO8859_1,
  escapeHtml : escapeHtml,
  globToRegex : globToRegex,
  htmlToArray : htmlToArray,
  htmlElement : htmlElement,
  httpGet : httpGet,
  toJSString : toJSString,
  appSorter : appSorter,
  appSorterUpdatesFirst : appSorterUpdatesFirst,
  searchRelevance : searchRelevance,
  getVersionInfo : getVersionInfo,
  isAppUpdateable : isAppUpdateable,
  versionLess : versionLess,
  debounce : debounce,
  atobSafe : atobSafe,    // version of 'window.atob' that doesn't fail on 'not correctly encoded' strings
  parseRJSON : parseRJSON // parse relaxed JSON which Espruino's writeJSON uses for settings/etc (returns undefined on failure)
};

if ("undefined"!=typeof module)
  module.exports = Utils;

