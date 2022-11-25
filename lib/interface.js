/* Library for 'interface' HTML files that are to
be used from within BangleApps

See: README.md / `apps.json`: `interface` element

This exposes a 'Puck' object (a simple version of
https://github.com/espruino/EspruinoWebTools/blob/master/puck.js)
and calls `onInit` when it's ready. `Puck` can be used for
sending/receiving data to the correctly connected
device with Puck.eval/write.

Puck.write(data,callback)
Puck.eval(data,callback)

There is also:

Util.readStorageFile(filename,callback)
Util.eraseStorageFile(filename,callback)
Util.showModal(title)
Util.hideModal()
*/
let __id = 0, __idlookup = [];
const Puck = {
  eval : function(data,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"eval",data:data,id:__id});
  },write : function(data,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"write",data:data,id:__id});
  }
};

const Util = {
  close : function() { // request a close of this window
    __id++;
    window.postMessage({type:"close",id:__id});
  },
  readStorageFile : function(filename,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"readstoragefile",filename:filename,id:__id});
  },
  readStorage : function(filename,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"readstorage",filename:filename,id:__id});
  },
  writeStorage : function(filename,data,callback) {
    __id++;
    __idlookup[__id] = callback;
    window.postMessage({type:"writestorage",filename:filename,data:data,id:__id});
  },
  eraseStorageFile : function(filename,callback) {
    Puck.write(`\x10require("Storage").open(${JSON.stringify(filename)},"r").erase()\n`,callback);
  },
  eraseStorage : function(filename,callback) {
    Puck.write(`\x10require("Storage").erase(${JSON.stringify(filename)})\n`,callback);
  },
  showModal : function(title) {
    if (!Util.domModal) {
      Util.domModal = document.createElement('div');
      Util.domModal.id = "status-modal";
      Util.domModal.classList.add("modal");
      Util.domModal.classList.add("active");
      Util.domModal.innerHTML = `<div class="modal-overlay"></div>
      <div class="modal-container">
        <div class="modal-header">
          <div class="modal-title h5">Please wait</div>
        </div>
        <div class="modal-body">
          <div class="content">
            Loading...
          </div>
        </div>
      </div>`;
      document.body.appendChild(Util.domModal);
    }
    Util.domModal.querySelector(".content").innerHTML = title;
    Util.domModal.classList.add("active");
  },
  hideModal : function() {
    if (!Util.domModal) return;
    Util.domModal.classList.remove("active");
  },
  saveCSV : function(filename, csvData) {
    let a = document.createElement("a"),
      file = new Blob([csvData], {type: "Comma-separated value file"});
    let url = URL.createObjectURL(file);
    a.href = url;
    a.download = filename+".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 0);
  }
};
window.addEventListener("message", function(event) {
  let msg = event.data;
  if (msg.type=="init") {
    console.log("<INTERFACE> init message received", msg.data);
    if (msg.expectedInterface != "interface.js")
      console.error("<INTERFACE> WRONG FILE IS INCLUDED, use "+msg.expectedInterface+" instead");
    if ("undefined"!==typeof onInit)
      onInit(msg.data);
  } else if (msg.type=="evalrsp" ||
             msg.type=="writersp" ||
             msg.type=="readstoragefilersp" ||
             msg.type=="readstoragersp" ||
             msg.type=="writestoragersp") {
    let cb = __idlookup[msg.id];
    delete __idlookup[msg.id];
    if (cb) cb(msg.data);
  }
}, false);

// version of 'window.atob' that doesn't fail on 'not correctly encoded' strings
function atobSafe(input) {
  // Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149
  // This code was written by Tyler Akins and has been placed in the
  // public domain.  It would be nice if you left this header intact.
  // Base64 code from Tyler Akins -- http://rumkin.com
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9+/=]/g, '');
  do {
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
  } while (i < input.length);
  return output;
}
